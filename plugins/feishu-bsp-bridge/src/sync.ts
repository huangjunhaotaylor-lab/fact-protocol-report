/**
 * feishu-bsp-bridge — 定时增量同步（Sync）
 *
 * 策略（与 BSP 协议一致）：
 * - Evidence 不可变 → 同一来源内容变化时**追加新 Evidence**（version+1, chain_id 串链），绝不覆盖
 * - 幂等：按 (source, source_id) 与 BSP 已有 Evidence 去重；按内容 SHA-256 检测变更
 * - 游标：状态文件记录每个来源的 lastCursor / checksum / version，只处理增量
 *
 * 各来源策略：
 * - doc      按 checksum 检测；变更 → 新 Evidence（version+1, chain_id 指向旧 Evidence）
 * - chat     按天分桶（Evidence.source_id = chat:{ref}:{YYYY-MM-DD}）；已有桶跳过；游标推进到最后一条消息时间
 * - task     按 guid 逐条 checksum 检测；变更 → 新 Evidence（version+1）
 * - minutes  按 checksum 检测；不变跳过
 *
 * 用法：npm run cli -- sync --config examples/sync-config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fetchSource } from './sources';
import { ingestContent, IngestCoreOptions } from './ingest';
import { createBspClient } from './bsp';

/* ---------------- 配置与状态 ---------------- */

export interface SyncSourceConfig {
  /** doc | chat | minutes | task | mail | sheet | bitable | approval */
  type: string;
  /** 来源引用：doc token / chat_id / minute_token；task 用空串表示"我的任务" */
  ref: string;
  /** 锚定/创建的 Object 名称（可选，默认来源标题） */
  objectName?: string;
  /** Signal body（可选；默认第一个 Fragment） */
  signalBody?: string;
  /** chat 抓取条数上限 */
  limit?: number;
}

export interface SyncConfig {
  /** 状态文件路径（游标/checksum 持久化） */
  stateFile: string;
  sources: SyncSourceConfig[];
}

export interface SourceState {
  /** key = `${type}:${ref}` */
  [key: string]: {
    lastCursor?: string;
    checksum?: string;
    version?: number;
    lastEvidenceId?: string;
  };
}

export interface SyncPerSource {
  label: string;
  action: 'created' | 'skipped' | 'error';
  evidenceId?: string;
  reason?: string;
}

export interface SyncRunResult {
  stateFile: string;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  perSource: SyncPerSource[];
}

/* ---------------- 工具 ---------------- */

/** SHA-256，与 BSP 服务端 computeChecksum 一致 */
export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** chat 消息按天分桶（纯函数，可单测） */
export function bucketByDay(
  items: Array<{ create_time?: string }>,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const m of items) {
    if (!m.create_time) continue;
    const t = /^\d{13}$/.test(m.create_time) ? new Date(Number(m.create_time)) : new Date(m.create_time);
    if (Number.isNaN(t.getTime())) continue;
    const day = t.toISOString().slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return buckets;
}

/** 读取状态文件（不存在返回空） */
export function loadState(stateFile: string): SourceState {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(stateFile), 'utf-8')) as SourceState;
  } catch {
    return {};
  }
}

/** 写状态文件（原子落盘） */
export function saveState(stateFile: string, state: SourceState): void {
  fs.mkdirSync(path.dirname(path.resolve(stateFile)), { recursive: true });
  const tmp = `${path.resolve(stateFile)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, path.resolve(stateFile));
}

/* ---------------- 同步 ---------------- */

export async function runSync(
  config: SyncConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyncRunResult> {
  const state = loadState(config.stateFile);
  const bsp = createBspClient(env);

  // 现有 Evidence（source_id → 最新一条），用于全局幂等
  let existingBySourceId = new Map<string, { id: string; checksum: string }>();
  try {
    const evidences = await bsp.listEvidences();
    existingBySourceId = new Map(
      (evidences as Array<{ id: string; source_id?: string; checksum: string }>)
        .filter((e) => e.source_id)
        .map((e) => [e.source_id!, { id: e.id, checksum: e.checksum }]),
    );
  } catch {
    // 列表失败不阻塞：仍按 state 幂等
  }

  const perSource: SyncPerSource[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const src of config.sources) {
    const key = `${src.type}:${src.ref || '<mine>'}`;
    const label = `${src.type}:${src.ref || 'mine'}`;
    try {
      const outcome = await syncOne(src, state, key, existingBySourceId, bsp);
      if (outcome.action === 'created') {
        created += 1;
        perSource.push({ label, action: 'created', evidenceId: outcome.evidenceId });
      } else {
        skipped += 1;
        perSource.push({ label, action: 'skipped', reason: outcome.reason });
      }
    } catch (e) {
      failed += 1;
      perSource.push({ label, action: 'error', reason: (e as Error).message });
    }
  }

  saveState(config.stateFile, state);
  return { stateFile: config.stateFile, total: config.sources.length, created, skipped, failed, perSource };
}

async function syncOne(
  src: SyncSourceConfig,
  state: SourceState,
  key: string,
  existingBySourceId: Map<string, { id: string; checksum: string }>,
  bsp: ReturnType<typeof createBspClient>,
): Promise<{ action: 'created' | 'skipped'; evidenceId?: string; reason?: string }> {
  const st: SourceState[string] = state[key] ?? {};
  const core: IngestCoreOptions = {
    objectName: src.objectName,
    signalBody: src.signalBody,
    dryRun: false,
  };

  if (src.type === 'doc') {
    // 变更检测：checksum 对比
    const content = await fetchSource('doc', src.ref, {});
    const sum = sha256(content.content);
    const existing = existingBySourceId.get(content.ref);
    // 首次运行时若已人工录入过，采纳现有 checksum，避免重复
    if (st.checksum === undefined && existing) {
      st.checksum = existing.checksum;
      st.lastEvidenceId = existing.id;
    }
    if (st.checksum === sum && st.lastEvidenceId) {
      state[key] = st;
      return { action: 'skipped', reason: '内容未变更（checksum 一致）' };
    }
    const version = (st.version ?? 0) + 1;
    const result = await ingestContent(
      {
        ...content,
        metadata: {
          ...content.metadata,
          version,
          ...(st.lastEvidenceId ? { chain_id: st.lastEvidenceId } : {}),
        },
      },
      core,
    );
    st.checksum = sum;
    st.version = version;
    st.lastEvidenceId = result.evidence.id;
    state[key] = st;
    return { action: 'created', evidenceId: result.evidence.id };
  }

  if (src.type === 'chat') {
    // 按天分桶；已有桶跳过；游标推进到最后消息时间
    const items = await fetchChatRaw(src);
    if (items.length === 0) {
      state[key] = st;
      return { action: 'skipped', reason: '无新消息' };
    }

    // 游标过滤：只处理 lastCursor 之后的消息
    const fresh = st.lastCursor
      ? items.filter((m: any) => {
          const t = normalizeTs(m.create_time);
          return !t || t > st.lastCursor!;
        })
      : items;
    if (fresh.length === 0) {
      state[key] = st;
      return { action: 'skipped', reason: '无新增消息' };
    }

    const buckets = bucketByDay(fresh);
    let ingested = 0;
    for (const [day] of buckets) {
      const sourceId = `chat:${src.ref}:${day}`;
      if (existingBySourceId.has(sourceId)) continue; // 该天已入库
      const content = await fetchSource('chat', src.ref, {
        limit: src.limit,
        start: `${day}T00:00:00+08:00`,
        end: `${day}T23:59:59+08:00`,
      });
      const result = await ingestContent(
        { ...content, ref: sourceId, metadata: { ...content.metadata, chat_date: day } },
        core,
      );
      existingBySourceId.set(sourceId, { id: result.evidence.id, checksum: '' });
      ingested += 1;
    }
    // 推进游标到最新一条消息时间
    const lastTs = fresh
      .map((m: any) => normalizeTs(m.create_time))
      .filter(Boolean)
      .sort()
      .pop();
    if (lastTs) st.lastCursor = lastTs;
    state[key] = st;
    return ingested > 0
      ? { action: 'created', evidenceId: `chat:${src.ref}:${[...buckets.keys()].join(',')}` }
      : { action: 'skipped', reason: '该时间段消息已入库' };
  }

  if (src.type === 'task') {
    // 我的任务：逐条 checksum 检测变更
    const { listCandidates } = await import('./sources');
    const tasks = await listCandidates('task', {});
    let ingested = 0;
    for (const t of tasks) {
      const tkey = `task:${t.ref}`;
      const tst: SourceState[string] = state[tkey] ?? {};
      const content = await fetchSource('task', t.ref, {});
      const sum = sha256(content.content);
      if (tst.checksum === sum && tst.lastEvidenceId) continue;
      const version = (tst.version ?? 0) + 1;
      const result = await ingestContent(
        {
          ...content,
          metadata: {
            ...content.metadata,
            version,
            ...(tst.lastEvidenceId ? { chain_id: tst.lastEvidenceId } : {}),
          },
        },
        { ...core, objectName: src.objectName ?? content.title },
      );
      tst.checksum = sum;
      tst.version = version;
      tst.lastEvidenceId = result.evidence.id;
      state[tkey] = tst;
      ingested += 1;
    }
    state[key] = st;
    return ingested > 0
      ? { action: 'created', evidenceId: `task 批次（${ingested} 条变更）` }
      : { action: 'skipped', reason: '任务无变更' };
  }

  // 其余来源（minutes/mail/sheet/bitable/approval）：按 checksum 检测变更
  const content = await fetchSource(src.type, src.ref, {});
  const sum = sha256(content.content);
  const existing = existingBySourceId.get(content.ref);
  if (st.checksum === undefined && existing) {
    st.checksum = existing.checksum;
    st.lastEvidenceId = existing.id;
  }
  if (st.checksum === sum && st.lastEvidenceId) {
    state[key] = st;
    return { action: 'skipped', reason: '内容未变更（checksum 一致）' };
  }
  const version = (st.version ?? 0) + 1;
  const result = await ingestContent(
    {
      ...content,
      metadata: {
        ...content.metadata,
        version,
        ...(st.lastEvidenceId ? { chain_id: st.lastEvidenceId } : {}),
      },
    },
    core,
  );
  st.checksum = sum;
  st.version = version;
  st.lastEvidenceId = result.evidence.id;
  state[key] = st;
  return { action: 'created', evidenceId: result.evidence.id };
}

/** 拉取 chat 原始消息列表（供游标/分桶用） */
async function fetchChatRaw(src: SyncSourceConfig): Promise<any[]> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { larkBin } = await import('./feishu');
  const execFileAsync = promisify(execFile);
  const args = ['im', '+chat-messages-list', '--chat-id', src.ref, '--page-all', '--json'];
  const { stdout } = await execFileAsync(larkBin(), args, { maxBuffer: 128 * 1024 * 1024 });
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith('{'));
  if (start < 0) throw new Error(`lark-cli 输出非 JSON：${stdout.slice(0, 200)}`);
  const res = JSON.parse(lines.slice(start).join('\n'));
  if (!res?.ok) throw new Error(`聊天消息失败：${JSON.stringify(res?.error)}`);
  return res.data?.messages ?? res.data?.items ?? [];
}

function normalizeTs(t?: string): string | undefined {
  if (!t) return undefined;
  if (/^\d{13}$/.test(t)) return new Date(Number(t)).toISOString();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 加载配置文件 */
export function loadSyncConfig(configPath: string): SyncConfig {
  const cfg = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf-8')) as SyncConfig;
  if (!Array.isArray(cfg.sources)) throw new Error('sync 配置必须包含 sources 数组');
  if (!cfg.stateFile) throw new Error('sync 配置必须指定 stateFile');
  return cfg;
}
