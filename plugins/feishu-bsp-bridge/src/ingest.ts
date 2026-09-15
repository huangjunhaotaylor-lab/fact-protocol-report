/**
 * feishu-bsp-bridge — 核心编排：飞书任意信息源 → BSP Reality Layer
 *
 * 链路（来源无关）：
 *   飞书信息源（文档 / 群聊消息 / 妙记 / 任务 / 邮件 / 表格 ...）
 *     → SourceContent（归一化：纯文本 content + bspSource + metadata）
 *     → Evidence（content=原文，checksum 由 BSP 计算）
 *     → Fragment × N（按句切分，逐字来自原文 —— BSP 强制 includes 校验）
 *     → Signal（body 必须是事实观察，锚定 Object —— BSP 强制 AC-006/007/008）
 *     → Object（按 --object-name 查找或创建）
 *
 * 协议约束由 BSP 服务端强制执行；本插件只负责"忠实搬运原文 + 合理切分"。
 */

import { readDocument, FeishuDocument, checkAuth } from './feishu';
import { fetchSource, SourceContent } from './sources';
import { createBspClient, BspClient, bspBase } from './bsp';

export interface IngestCoreOptions {
  /** 锚定已有 Object 的 ID */
  objectId?: string;
  /** 按名称查找或创建 Object（默认用来源标题） */
  objectName?: string;
  /** 直接指定 Signal 的锚定 Object ID 列表（覆盖 objectId/objectName 的单一锚点） */
  anchors?: string[];
  /** Signal body；默认取第一个 Fragment（可能被 AC-008 拒绝，需人工指定） */
  signalBody?: string;
  /** Signal 类型：observation | event | change | status | action */
  signalType?: string;
  /** 抽取置信度（0-1，表示抽取置信度，不表示业务重要性） */
  confidence?: number;
  /** Fragment 最小长度（字符），默认 4 */
  fragmentMinLen?: number;
  /** 仅打印计划，不写入 BSP */
  dryRun?: boolean;
}

export interface IngestOptions extends IngestCoreOptions {
  /** 飞书文档 token 或 URL（doc 来源） */
  doc: string;
}

export interface IngestSourceOptions extends IngestCoreOptions {
  /** 信息源类型：doc | chat | minutes | task | mail | sheet | bitable | approval */
  type: string;
  /** 来源引用（token / chat_id / guid / message_id） */
  ref: string;
  /** 传给适配器的额外选项（如 chat 的 limit/start/end） */
  sourceOpts?: Record<string, unknown>;
}

export interface IngestResult {
  /** 归一化的来源内容 */
  source: SourceContent;
  object: { id: string; name: string };
  evidence: { id: string };
  fragments: Array<{ id: string; content: string }>;
  signal: { id: string; body: string; state: string; domains?: string[]; primary_domain?: string | null };
  skipped: Array<{ reason: string; content: string }>;
  dryRun: boolean;
}

/**
 * 将原文按句切分为候选 Fragment。
 * 保证每个片段都是原文的连续子串（满足 BSP Fragment 的 includes 约束）。
 * 切分策略：先按换行，再按句读符号（。！？!?；;）切长句，保留符号。
 */
export function splitContent(content: string, minLen = 4): string[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const line of lines) {
    const sentences = line.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
    for (const s of sentences) {
      if (s.length >= minLen) pieces.push(s);
    }
  }
  return pieces;
}

/** 在 BSP 中按名称查找或创建 Object */
async function findOrCreateObject(
  bsp: BspClient,
  name: string,
): Promise<{ id: string; name: string }> {
  const existing = await bsp.listObjects();
  const hit = existing.find((o) => o.name === name);
  if (hit) return { id: hit.id, name: hit.name };
  const created = await bsp.createObject({ type: 'Document', name });
  return { id: created.id, name: created.name };
}

/** 来源无关落库管线：SourceContent → Evidence → Fragment → Signal → Object */
export async function ingestContent(
  content: SourceContent,
  opts: IngestCoreOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<IngestResult> {
  const bsp = createBspClient(env);
  const minLen = opts.fragmentMinLen ?? 4;

  // 1. 确定 Object（显式指定 anchors 时跳过对象创建）
  const objectName = opts.objectName || content.title || '飞书信息';
  const hasExplicitAnchors = Boolean(opts.anchors && opts.anchors.length > 0);
  let object: { id: string; name: string };
  if (opts.objectId) {
    object = { id: opts.objectId, name: objectName };
  } else if (hasExplicitAnchors) {
    object = { id: opts.anchors![0], name: objectName };
  } else if (opts.dryRun) {
    object = { id: '(dry-run 不创建)', name: objectName };
  } else {
    object = await findOrCreateObject(bsp, objectName);
  }

  // 2. 切分片段
  const candidates = splitContent(content.content, minLen);
  if (candidates.length === 0) {
    throw new Error(`来源无可切分的正文内容：${content.ref}`);
  }

  if (opts.dryRun) {
    return {
      source: content,
      object,
      evidence: { id: '(dry-run)' },
      fragments: candidates.map((c) => ({ id: '(dry-run)', content: c })),
      signal: { id: '(dry-run)', body: opts.signalBody ?? candidates[0], state: 'Captured' },
      skipped: [],
      dryRun: true,
    };
  }

  // 3. Evidence（原文保存，不可变）
  const evidence = await bsp.createEvidence({
    source: content.bspSource,
    content: content.content,
    source_id: content.ref,
    creator: 'feishu-bsp-bridge',
    metadata: {
      ...content.metadata,
      title: content.title,
      bridge: 'feishu-bsp-bridge',
    },
  });

  // 4. Fragment（逐字来自原文）
  const fragments: Array<{ id: string; content: string }> = [];
  const skipped: IngestResult['skipped'] = [];
  for (const fragmentContent of candidates) {
    try {
      const frag = await bsp.createFragment({
        evidence_id: evidence.id,
        type: 'Text',
        content: fragmentContent,
        section: content.title,
        metadata: { source_ref: content.ref },
      });
      fragments.push({ id: frag.id, content: fragmentContent });
    } catch (e) {
      skipped.push({ reason: (e as Error).message, content: fragmentContent });
    }
  }

  if (fragments.length === 0) {
    throw new Error('未能从来源创建任何 Fragment（全部被 BSP 拒绝）');
  }

  // 5. Signal（事实观察，锚定 Object）
  const body = opts.signalBody ?? fragments[0].content;
  const anchorIds = opts.anchors && opts.anchors.length > 0 ? opts.anchors : [object.id];
  const signal = await bsp.createSignal({
    type: opts.signalType ?? 'observation',
    body,
    fragments: fragments.map((f) => f.id),
    anchors: anchorIds,
    context: {
      channel: content.bspSource === 'meeting' ? 'meeting' : 'feishu',
      source: content.bspSource,
      document: content.title,
    },
    confidence: opts.confidence ?? 0.9,
  });

  return { source: content, object, evidence, fragments, signal, skipped, dryRun: false };
}

/** 兼容入口：飞书文档（docx / wiki）→ BSP */
export async function ingestDocument(opts: IngestOptions, env: NodeJS.ProcessEnv = process.env): Promise<IngestResult> {
  const document: FeishuDocument = await readDocument(opts.doc, env);
  const { doc: _doc, ...core } = opts;
  return ingestContent(
    {
      ref: document.token,
      title: document.title,
      content: document.content,
      url: document.url,
      bspSource: 'feishu',
      metadata: { source_type: 'doc', feishu_token: document.token, url: document.url },
    },
    core,
    env,
  );
}

/** 通用入口：任意飞书信息源 → BSP */
export async function ingestSource(opts: IngestSourceOptions, env: NodeJS.ProcessEnv = process.env): Promise<IngestResult> {
  const content = await fetchSource(opts.type, opts.ref, opts.sourceOpts as never);
  const { type: _type, ref: _ref, sourceOpts: _sourceOpts, ...core } = opts;
  return ingestContent(content, core, env);
}

/* ---------------- attachSignal：在已有 Evidence 上追加观察 ---------------- */

export interface AttachSignalOptions {
  /** 已有 Evidence 的 ID */
  evidenceId: string;
  /** Signal body（事实观察，需通过 AC-008） */
  body: string;
  /** 锚定的 Object ID 列表（与 objectName 二选一） */
  anchors?: string[];
  /** 按名称查找/创建 Object 作为唯一锚点 */
  objectName?: string;
  type?: string;
  confidence?: number;
  actors?: string[];
  context?: Record<string, unknown>;
}

export interface AttachSignalResult {
  signal: { id: string; body: string; state: string };
  evidence: { id: string; content: string };
  fragments: Array<{ id: string; content: string }>;
  anchors: string[];
}

/**
 * 在已有 Evidence 上追加 Signal：复用其全部 Fragment。
 * 场景：同一份原始证据（飞书文档）包含多个对象的观察时，
 * 分别锚定不同 Object，从而让 gen-relations 能发现对象间共现关系。
 */
export async function attachSignal(
  opts: AttachSignalOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AttachSignalResult> {
  const bsp = createBspClient(env);

  const evidence = await bsp.getEvidence(opts.evidenceId);
  const fragments = await bsp.listFragmentsByEvidence(opts.evidenceId);
  if (fragments.length === 0) {
    throw new Error(`Evidence ${opts.evidenceId} 没有任何 Fragment，无法创建 Signal`);
  }

  let anchors = opts.anchors;
  if ((!anchors || anchors.length === 0) && opts.objectName) {
    anchors = [(await findOrCreateObject(bsp, opts.objectName)).id];
  }
  if (!anchors || anchors.length === 0) {
    throw new Error('--anchors 或 --object-name 至少提供一个锚定 Object');
  }

  const signal = await bsp.createSignal({
    type: opts.type ?? 'observation',
    body: opts.body,
    fragments: fragments.map((f) => f.id),
    anchors,
    context: opts.context ?? { source: 'feishu' },
    confidence: opts.confidence ?? 0.9,
    ...(opts.actors !== undefined && { actors: opts.actors }),
  });

  return { signal, evidence, fragments, anchors };
}

export { checkAuth, bspBase };
