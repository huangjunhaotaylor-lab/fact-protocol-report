/**
 * feishu-bsp-bridge — Relation 自动生成
 *
 * 规则（协议安全）：**同一份 Evidence 内共现的 Object 之间生成 `references` 事实关系**。
 * - source / target 必须是 Object（BSP 校验）
 * - derived_from 必须引用真实 Signal（BSP 校验）——取该 Evidence 组内锚定 source 的 Signal
 * - 只表达"同一原始证据中出现过"这一事实，不表达业务判断（符合 BSP 6.6）
 * - 幂等：与已存在 Relation（source|target|type）去重
 *
 * 对应协议：6.6 Relation、AC-013（Relation 必须能追溯到 derived_from Signal）
 */

import { createBspClient, BspClient, BspSignal, BspRelation, SignalTrace, RelationInput } from './bsp';

export interface ProposedRelation {
  source: string;
  target: string;
  type: string;
  derived_from: string;
  confidence: number;
  evidence_id: string;
}

export interface GenerateRelationsOptions {
  dryRun?: boolean;
  /** 关系类型，默认 references */
  type?: string;
  /** 置信度覆盖，默认取 derived_from Signal 的 confidence */
  confidence?: number;
}

export interface GenerateRelationsResult {
  proposed: ProposedRelation[];
  created: BspRelation[];
  skipped: Array<{ reason: string; relation: ProposedRelation }>;
  dryRun: boolean;
}

/**
 * 纯函数：根据 Signal 及其证据链计算候选关系（默认 references）。
 *
 * @param signals        全部 Signal
 * @param tracesBySignal  signalId → SignalTrace（含 evidence 链）
 * @param existing       已存在的 Relation（用于去重）
 * @param type           自动生成的关系类型，默认 references
 */
export function computeRelations(
  signals: BspSignal[],
  tracesBySignal: Map<string, SignalTrace>,
  existing: BspRelation[],
  type = 'references',
): ProposedRelation[] {
  // evidenceId → 该证据内的 (signalId, anchors)
  const groups = new Map<string, Array<{ signalId: string; anchors: string[] }>>();

  for (const signal of signals) {
    if (!signal.anchors || signal.anchors.length === 0) continue;
    const trace = tracesBySignal.get(signal.id);
    if (!trace?.evidences?.length) continue;
    for (const ev of trace.evidences) {
      if (!groups.has(ev.id)) groups.set(ev.id, []);
      groups.get(ev.id)!.push({ signalId: signal.id, anchors: signal.anchors });
    }
  }

  const existingKeys = new Set(existing.map((r) => `${r.source}|${r.target}|${r.type}`));
  const seen = new Set<string>();
  const proposed: ProposedRelation[] = [];

  for (const [evidenceId, members] of groups) {
    // 该证据内出现的全部 Object（去重）
    const objects = [...new Set(members.flatMap((m) => m.anchors))];

    for (const source of objects) {
      // 取该证据内锚定 source 的第一个 Signal 作为 derived_from
      const member = members.find((m) => m.anchors.includes(source));
      if (!member) continue;

      for (const target of objects) {
        if (target === source) continue;
        const key = `${source}|${target}|${type}`;
        if (existingKeys.has(key) || seen.has(key)) continue;

        seen.add(key);
        proposed.push({
          source,
          target,
          type,
          derived_from: member.signalId,
          confidence: 0.7,
          evidence_id: evidenceId,
        });
      }
    }
  }

  return proposed;
}

/** 编排：拉取全部 Signal 与证据链，计算并创建 references 关系 */
export async function generateRelations(
  opts: GenerateRelationsOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<GenerateRelationsResult> {
  const bsp: BspClient = createBspClient(env);
  const type = opts.type ?? 'references';

  // 1. 拉取现有数据
  const [signals, existing] = await Promise.all([bsp.listSignals(), bsp.listRelations()]);

  // 2. 逐 Signal 追溯证据链（单条失败不影响整体）
  const tracesBySignal = new Map<string, SignalTrace>();
  for (const s of signals) {
    try {
      tracesBySignal.set(s.id, await bsp.traceSignal(s.id));
    } catch {
      // 追溯失败（理论上不该发生），跳过该 Signal
    }
  }

  // 3. 计算候选
  const candidates = computeRelations(signals, tracesBySignal, existing, type);

  // 4. 创建
  const created: BspRelation[] = [];
  const skipped: GenerateRelationsResult['skipped'] = [];

  if (!opts.dryRun) {
    for (const c of candidates) {
      const input: RelationInput = {
        source: c.source,
        target: c.target,
        type: c.type,
        derived_from: c.derived_from,
        confidence: opts.confidence ?? c.confidence,
      };
      try {
        created.push(await bsp.createRelation(input));
      } catch (e) {
        skipped.push({ reason: (e as Error).message, relation: c });
      }
    }
  }

  return { proposed: candidates, created, skipped, dryRun: Boolean(opts.dryRun) };
}
