/**
 * AI 解读上下文组装（Business Graph OS — AI 解读）
 *
 * 单节点解读（五种 kind）与视图级解读（digest）的上下文装配：
 * - 只读五个协议对象 Repository，纯增量模块
 * - 总上下文 cap 约 8000 字；截断策略：优先保留 Signal body 与 Evidence 原文前段，
 *   低优先段（同对象其他信号 / 关联清单尾部）先行丢弃
 * - 视图 digest：各层计数、板块分布、状态分布、Signal body 清单（≤60 条、每条 ≤120 字）、
 *   Object 清单、Relation 清单；node_ids > 150 时按 Signal>Object>Evidence>Fragment>Relation
 *   优先级截断并标 truncated
 */

import {
  Evidence,
  Fragment,
  Signal,
  BSPObject,
  Relation,
} from '../types';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import { GRAPH_NODE_KINDS, GraphNodeKind } from '../queries/graph.projection';
import { NotFoundError, ValidationError } from '../utils/errors';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 总上下文上限（字符） */
export const CONTEXT_CAP = 8000;
/** Signal 解读时单份 Evidence 原文上限 */
export const EVIDENCE_TEXT_CAP = 2000;
/** Evidence 解读时原文上限 */
export const EVIDENCE_SELF_CAP = 3000;
/** Signal 解读时同对象其他信号摘要条数上限 */
export const PEER_SIGNAL_CAP = 10;
/** 视图 digest：Signal body 清单条数上限 / 单条长度上限 */
export const VIEW_SIGNAL_CAP = 60;
export const VIEW_SIGNAL_BODY_CAP = 120;
/** 视图解读 node_ids 上限（超出按优先级截断并标 truncated） */
export const VIEW_NODE_CAP = 150;
/** 视图 digest：Object / Relation 清单条数上限 */
export const VIEW_LIST_CAP = 60;

export interface ViewLens {
  domain?: string | null;
  time_window?: [number, number] | null;
}

/** 组装结果 */
export interface AssembledContext {
  /** 送给 LLM 的用户消息文本（已按 cap 截断） */
  text: string;
  /** 上下文指纹（缓存 key 依据） */
  fingerprint: string;
  node_count: number;
  evidence_ids: string[];
  signal_ids: string[];
  /** 视图级：node_ids 超上限被服务端截断 */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function cut(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}…（截断）`;
}

function fmtSignalSummary(sig: Signal): string {
  const doms = (sig.domains ?? []).join('/');
  return `- [${sig.id}]（${sig.state}，置信度 ${sig.confidence}）${doms ? `［板块 ${doms}］` : ''}${sig.body}`;
}

function fmtObjectLine(obj: BSPObject): string {
  return `- [${obj.id}] ${obj.type}「${obj.name}」（${obj.state}）`;
}

function fmtFragmentLine(fr: Fragment): string {
  const loc: string[] = [];
  if (typeof fr.start_offset === 'number' && typeof fr.end_offset === 'number') {
    loc.push(`偏移 ${fr.start_offset}–${fr.end_offset}`);
  }
  if (fr.speaker) loc.push(`说话人 ${fr.speaker}`);
  if (fr.page != null) loc.push(`页 ${fr.page}`);
  if (fr.section) loc.push(`章节 ${fr.section}`);
  return `- [${fr.id}] ${fr.type}${loc.length ? `（${loc.join('，')}）` : ''}：${fr.content}`;
}

function fmtRelationLine(rel: Relation, objectById: Map<string, BSPObject>): string {
  const src = objectById.get(rel.source);
  const tgt = objectById.get(rel.target);
  const srcName = src ? `${src.name}（${rel.source}）` : rel.source;
  const tgtName = tgt ? `${tgt.name}（${rel.target}）` : rel.target;
  return `- [${rel.id}] ${srcName} —${rel.type}→ ${tgtName}（派生自 Signal ${rel.derived_from}，置信度 ${rel.confidence}）`;
}

function relationsOfObjects(objectIds: Set<string>): Relation[] {
  return relationRepository
    .findAll()
    .filter((r) => objectIds.has(r.source) || objectIds.has(r.target));
}

/**
 * 按优先级装配最终文本：
 * sections 按 priority 升序传入（0 = 最重要，必保）；超 cap 时从最低优先段尾部逐行丢弃，
 * 仍超限则对全文做硬截断。返回最终文本与截断标记。
 */
function assemble(sections: Array<{ priority: number; title: string; lines: string[] }>): string {
  const sorted = [...sections].sort((a, b) => a.priority - b.priority);
  const render = () =>
    sorted
      .filter((s) => s.lines.length > 0)
      .map((s) => `【${s.title}】\n${s.lines.join('\n')}`)
      .join('\n\n');
  let text = render();
  if (text.length <= CONTEXT_CAP) return text;

  // 从最低优先段开始逐行丢弃
  for (let p = sorted.length - 1; p >= 0 && text.length > CONTEXT_CAP; p--) {
    const sec = sorted[p];
    if (sec.priority === 0) continue; // 必保段不丢行
    while (sec.lines.length > 1 && text.length > CONTEXT_CAP) {
      sec.lines.pop();
      text = render();
    }
    if (sec.lines.length <= 1 && text.length > CONTEXT_CAP) {
      sec.lines = [];
      text = render();
    }
  }
  if (text.length > CONTEXT_CAP) {
    text = `${text.slice(0, CONTEXT_CAP)}…（上下文已按 ${CONTEXT_CAP} 字上限截断）`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// 单节点解读：五种 kind
// ---------------------------------------------------------------------------

/** Signal 解读上下文：本体 + 锚定 Object + 支撑 Fragment + Evidence 原文 + 同对象其他 Signal + 相关 Relation */
function buildSignalContext(sig: Signal): { sections: Parameters<typeof assemble>[0]; evidenceIds: Set<string>; signalIds: Set<string>; nodeCount: number } {
  const objectById = new Map(objectRepository.findAll().map((o) => [o.id, o]));
  const evidenceIds = new Set<string>();
  const signalIds = new Set<string>([sig.id]);
  let nodeCount = 1;

  const head = [
    `Signal ID：${sig.id}`,
    `类型：${sig.type}　状态：${sig.state}　置信度：${sig.confidence}`,
    `板块：${(sig.domains ?? []).join('、') || '（无）'}　主线板块：${sig.primary_domain ?? '（无）'}`,
    `捕获时间：${sig.captured_at}${sig.occurred_at ? `　发生时间：${sig.occurred_at}` : ''}`,
    `事实观察：${sig.body}`,
  ];
  const ctx = sig.context ?? {};
  const ctxPairs = Object.entries(ctx).filter(([, v]) => v != null && v !== '');
  if (ctxPairs.length) head.push(`Context：${ctxPairs.map(([k, v]) => `${k}=${v}`).join('，')}`);
  if (sig.actors?.length) head.push(`参与者：${sig.actors.join('、')}`);

  // 锚定 Object
  const anchorLines: string[] = [];
  for (const objId of sig.anchors) {
    const obj = objectById.get(objId);
    if (obj) {
      anchorLines.push(fmtObjectLine(obj));
      nodeCount++;
    }
  }

  // 支撑 Fragment + 所属 Evidence 原文
  const fragLines: string[] = [];
  const evidenceLines: string[] = [];
  for (const fragId of sig.fragments) {
    const fr = fragmentRepository.findById(fragId);
    if (!fr) continue;
    fragLines.push(fmtFragmentLine(fr));
    nodeCount++;
    const ev = evidenceRepository.findById(fr.evidence_id);
    if (ev && !evidenceIds.has(ev.id)) {
      evidenceIds.add(ev.id);
      nodeCount++;
      evidenceLines.push(
        `- [${ev.id}]（来源 ${ev.source}，${ev.created_at}，状态 ${ev.state}）：\n${cut(ev.content, EVIDENCE_TEXT_CAP)}`,
      );
    }
  }

  // 同 Object 的其他 Signal 摘要（最多 10 条）
  const anchorSet = new Set(sig.anchors);
  const peerLines: string[] = [];
  for (const other of signalRepository.findAll()) {
    if (other.id === sig.id) continue;
    if (!other.anchors.some((a) => anchorSet.has(a))) continue;
    peerLines.push(fmtSignalSummary(other));
    signalIds.add(other.id);
    if (peerLines.length >= PEER_SIGNAL_CAP) break;
  }
  nodeCount += peerLines.length;

  // 相关 Relation
  const relLines = relationsOfObjects(anchorSet).map((r) => {
    signalIds.add(r.derived_from);
    nodeCount++;
    return fmtRelationLine(r, objectById);
  });

  return {
    sections: [
      { priority: 0, title: '待解读信号（Signal）', lines: head },
      { priority: 1, title: '支撑片段（Fragment，含在原文中的偏移）', lines: fragLines },
      { priority: 1, title: '证据原文（Evidence）', lines: evidenceLines },
      { priority: 2, title: '锚定对象（Object）', lines: anchorLines },
      { priority: 3, title: '相关关系（Relation）', lines: relLines },
      { priority: 4, title: '同对象的其他信号（摘要）', lines: peerLines },
    ],
    evidenceIds,
    signalIds,
    nodeCount,
  };
}

/** Evidence 解读上下文：原文 + Fragment 清单 + 关联 Signal 摘要 */
function buildEvidenceContext(ev: Evidence): { sections: Parameters<typeof assemble>[0]; evidenceIds: Set<string>; signalIds: Set<string>; nodeCount: number } {
  const signalIds = new Set<string>();
  let nodeCount = 1;

  const head = [
    `Evidence ID：${ev.id}`,
    `来源：${ev.source}${ev.source_id ? `（来源内 ID ${ev.source_id}）` : ''}　状态：${ev.state}`,
    `创建时间：${ev.created_at}${ev.chain_id ? `　证据链：${ev.chain_id}` : ''}`,
  ];

  const textLines = [cut(ev.content, EVIDENCE_SELF_CAP)];

  const fragLines: string[] = [];
  const sigLines: string[] = [];
  for (const fr of fragmentRepository.findAll()) {
    if (fr.evidence_id !== ev.id) continue;
    fragLines.push(fmtFragmentLine(fr));
    nodeCount++;
    for (const sig of signalRepository.findAll()) {
      if (!sig.fragments.includes(fr.id) || signalIds.has(sig.id)) continue;
      signalIds.add(sig.id);
      sigLines.push(fmtSignalSummary(sig));
      nodeCount++;
    }
  }

  return {
    sections: [
      { priority: 0, title: '待解读证据（Evidence）', lines: head },
      { priority: 1, title: '证据原文', lines: textLines },
      { priority: 2, title: '片段清单（Fragment）', lines: fragLines },
      { priority: 3, title: '关联信号（Signal 摘要）', lines: sigLines },
    ],
    evidenceIds: new Set([ev.id]),
    signalIds,
    nodeCount,
  };
}

/** Fragment 解读上下文：内容 + 所属 Evidence 原文 + 关联 Signal */
function buildFragmentContext(fr: Fragment): { sections: Parameters<typeof assemble>[0]; evidenceIds: Set<string>; signalIds: Set<string>; nodeCount: number } {
  const signalIds = new Set<string>();
  const evidenceIds = new Set<string>();
  let nodeCount = 1;

  const head = [
    `Fragment ID：${fr.id}`,
    `类型：${fr.type}　状态：${fr.state}　所属 Evidence：${fr.evidence_id}`,
    `内容：${fr.content}`,
  ];
  if (typeof fr.start_offset === 'number' && typeof fr.end_offset === 'number') {
    head.push(`在原文中的偏移：${fr.start_offset}–${fr.end_offset}`);
  }
  if (fr.speaker) head.push(`说话人：${fr.speaker}`);

  const evLines: string[] = [];
  const ev = evidenceRepository.findById(fr.evidence_id);
  if (ev) {
    evidenceIds.add(ev.id);
    nodeCount++;
    evLines.push(
      `- [${ev.id}]（来源 ${ev.source}，${ev.created_at}）：\n${cut(ev.content, EVIDENCE_TEXT_CAP)}`,
    );
  }

  const sigLines: string[] = [];
  for (const sig of signalRepository.findAll()) {
    if (!sig.fragments.includes(fr.id)) continue;
    signalIds.add(sig.id);
    nodeCount++;
    sigLines.push(fmtSignalSummary(sig));
  }

  return {
    sections: [
      { priority: 0, title: '待解读片段（Fragment）', lines: head },
      { priority: 1, title: '所属证据原文（Evidence）', lines: evLines },
      { priority: 2, title: '关联信号（Signal 摘要）', lines: sigLines },
    ],
    evidenceIds,
    signalIds,
    nodeCount,
  };
}

/** Object 解读上下文：属性 + 全部锚定 Signal 摘要 + Relation */
function buildObjectContext(obj: BSPObject): { sections: Parameters<typeof assemble>[0]; evidenceIds: Set<string>; signalIds: Set<string>; nodeCount: number } {
  const signalIds = new Set<string>();
  let nodeCount = 1;

  const head = [
    `Object ID：${obj.id}`,
    `类型：${obj.type}　名称：${obj.name}　状态：${obj.state}`,
    `板块：${(obj.domains ?? []).join('、') || '（无）'}　主线板块：${obj.primary_domain ?? '（无）'}`,
    `创建时间：${obj.created_at}　更新时间：${obj.updated_at}`,
  ];
  if (obj.aliases?.length) head.push(`别名：${obj.aliases.join('、')}`);
  if (obj.attributes && Object.keys(obj.attributes).length) {
    head.push(`附加属性：${JSON.stringify(obj.attributes)}`);
  }

  const sigLines: string[] = [];
  for (const sig of signalRepository.findAll()) {
    if (!sig.anchors.includes(obj.id)) continue;
    signalIds.add(sig.id);
    nodeCount++;
    sigLines.push(fmtSignalSummary(sig));
  }

  const objectById = new Map(objectRepository.findAll().map((o) => [o.id, o]));
  const relLines = relationsOfObjects(new Set([obj.id])).map((r) => {
    signalIds.add(r.derived_from);
    nodeCount++;
    return fmtRelationLine(r, objectById);
  });

  return {
    sections: [
      { priority: 0, title: '待解读对象（Object）', lines: head },
      { priority: 1, title: '锚定信号（Signal 摘要）', lines: sigLines },
      { priority: 3, title: '相关关系（Relation）', lines: relLines },
    ],
    evidenceIds: new Set(),
    signalIds,
    nodeCount,
  };
}

/** Relation 解读上下文：两端节点摘要 + derived_from Signal */
function buildRelationContext(rel: Relation): { sections: Parameters<typeof assemble>[0]; evidenceIds: Set<string>; signalIds: Set<string>; nodeCount: number } {
  const signalIds = new Set<string>();
  let nodeCount = 1;

  const head = [
    `Relation ID：${rel.id}`,
    `关系类型：${rel.type}　置信度：${rel.confidence}　创建时间：${rel.created_at}`,
    `Source：${rel.source}　Target：${rel.target}　派生自 Signal：${rel.derived_from}`,
  ];

  const objectById = new Map(objectRepository.findAll().map((o) => [o.id, o]));
  const endLines: string[] = [];
  for (const objId of [rel.source, rel.target]) {
    const obj = objectById.get(objId);
    if (obj) {
      endLines.push(fmtObjectLine(obj));
      nodeCount++;
    }
  }

  const sigLines: string[] = [];
  const sig = signalRepository.findById(rel.derived_from);
  if (sig) {
    signalIds.add(sig.id);
    nodeCount++;
    sigLines.push(fmtSignalSummary(sig));
  }

  return {
    sections: [
      { priority: 0, title: '待解读关系（Relation）', lines: head },
      { priority: 1, title: '两端对象（Object）', lines: endLines },
      { priority: 2, title: '派生来源信号（Signal）', lines: sigLines },
    ],
    evidenceIds: new Set(),
    signalIds,
    nodeCount,
  };
}

/** 单节点上下文组装入口 */
export function buildNodeContext(kind: string, id: string): AssembledContext {
  if (!GRAPH_NODE_KINDS.includes(kind as GraphNodeKind)) {
    throw new ValidationError(`Unknown node kind: "${kind}"`, ['kind']);
  }

  let built: ReturnType<typeof buildSignalContext>;
  switch (kind as GraphNodeKind) {
    case 'Signal': {
      const sig = signalRepository.findById(id);
      if (!sig) throw new NotFoundError('Signal', id);
      built = buildSignalContext(sig);
      break;
    }
    case 'Evidence': {
      const ev = evidenceRepository.findById(id);
      if (!ev) throw new NotFoundError('Evidence', id);
      built = buildEvidenceContext(ev);
      break;
    }
    case 'Fragment': {
      const fr = fragmentRepository.findById(id);
      if (!fr) throw new NotFoundError('Fragment', id);
      built = buildFragmentContext(fr);
      break;
    }
    case 'Object': {
      const obj = objectRepository.findById(id);
      if (!obj) throw new NotFoundError('Object', id);
      built = buildObjectContext(obj);
      break;
    }
    case 'Relation': {
      const rel = relationRepository.findById(id);
      if (!rel) throw new NotFoundError('Relation', id);
      built = buildRelationContext(rel);
      break;
    }
  }

  const text = assemble(built.sections);
  return {
    text,
    fingerprint: text,
    node_count: built.nodeCount,
    evidence_ids: [...built.evidenceIds],
    signal_ids: [...built.signalIds],
  };
}

// ---------------------------------------------------------------------------
// 视图级解读：digest
// ---------------------------------------------------------------------------

/** node_ids 截断优先级：Signal > Object > Evidence > Fragment > Relation */
const VIEW_KIND_PRIORITY: GraphNodeKind[] = ['Signal', 'Object', 'Evidence', 'Fragment', 'Relation'];

function kindOf(id: string): GraphNodeKind | undefined {
  if (signalRepository.findById(id)) return 'Signal';
  if (objectRepository.findById(id)) return 'Object';
  if (evidenceRepository.findById(id)) return 'Evidence';
  if (fragmentRepository.findById(id)) return 'Fragment';
  if (relationRepository.findById(id)) return 'Relation';
  return undefined;
}

/** 视图 digest 组装（node_ids > 150 按优先级截断并标 truncated） */
export function buildViewContext(nodeIds: string[], lens?: ViewLens): AssembledContext {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new ValidationError('node_ids 必须是非空数组', ['node_ids']);
  }

  // 去重 + kind 解析（未识别的 id 丢弃）
  const seen = new Set<string>();
  const byKind = new Map<GraphNodeKind, string[]>();
  for (const rawId of nodeIds) {
    if (typeof rawId !== 'string' || seen.has(rawId)) continue;
    seen.add(rawId);
    const k = kindOf(rawId);
    if (!k) continue;
    const list = byKind.get(k) ?? [];
    list.push(rawId);
    byKind.set(k, list);
  }

  // 超限按优先级截断
  let total = 0;
  for (const ids of byKind.values()) total += ids.length;
  let truncated = false;
  if (total > VIEW_NODE_CAP) {
    truncated = true;
    let budget = VIEW_NODE_CAP;
    for (const k of VIEW_KIND_PRIORITY) {
      const ids = byKind.get(k);
      if (!ids) continue;
      const keep = Math.max(0, Math.min(ids.length, budget));
      byKind.set(k, ids.slice(0, keep));
      budget -= keep;
    }
  }

  const signals = (byKind.get('Signal') ?? [])
    .map((id) => signalRepository.findById(id))
    .filter((s): s is Signal => Boolean(s));
  const objects = (byKind.get('Object') ?? [])
    .map((id) => objectRepository.findById(id))
    .filter((o): o is BSPObject => Boolean(o));
  const evidences = (byKind.get('Evidence') ?? [])
    .map((id) => evidenceRepository.findById(id))
    .filter((e): e is Evidence => Boolean(e));
  const fragments = (byKind.get('Fragment') ?? [])
    .map((id) => fragmentRepository.findById(id))
    .filter((f): f is Fragment => Boolean(f));
  const relations = (byKind.get('Relation') ?? [])
    .map((id) => relationRepository.findById(id))
    .filter((r): r is Relation => Boolean(r));

  const nodeCount =
    signals.length + objects.length + evidences.length + fragments.length + relations.length;

  // 各层计数
  const countLines = [
    `Signal ×${signals.length}　Object ×${objects.length}　Evidence ×${evidences.length}　Fragment ×${fragments.length}　Relation ×${relations.length}（共 ${nodeCount} 个节点）`,
  ];
  if (truncated) countLines.push(`（原始请求 ${total} 个节点，已按 Signal>Object>Evidence>Fragment>Relation 优先级截断至 ${nodeCount} 个）`);
  if (lens?.domain) countLines.push(`当前视角板块过滤：${lens.domain}`);
  if (lens?.time_window) {
    const [t0, t1] = lens.time_window;
    countLines.push(`当前视角时间窗：${new Date(t0).toISOString().slice(0, 10)} ~ ${new Date(t1).toISOString().slice(0, 10)}`);
  }

  // 板块分布 / 状态分布（Signal + Object 的 domains 命中）
  const domainCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};
  for (const n of [...signals, ...objects]) {
    for (const d of n.domains ?? []) domainCounts[d] = (domainCounts[d] ?? 0) + 1;
  }
  for (const n of [...signals, ...objects, ...evidences, ...fragments]) {
    stateCounts[n.state] = (stateCounts[n.state] ?? 0) + 1;
  }
  const distLines: string[] = [];
  const domEntries = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  if (domEntries.length) distLines.push(`板块分布：${domEntries.map(([d, c]) => `${d} ×${c}`).join('，')}`);
  distLines.push(`状态分布：${Object.entries(stateCounts).map(([s, c]) => `${s} ×${c}`).join('，') || '（无）'}`);

  // Signal body 清单（≤60 条、每条 ≤120 字）
  const sigLines = signals
    .slice(0, VIEW_SIGNAL_CAP)
    .map((s) => `- [${s.id}]（${s.state}，置信度 ${s.confidence}）${cut(s.body, VIEW_SIGNAL_BODY_CAP)}`);
  if (signals.length > VIEW_SIGNAL_CAP) sigLines.push(`…（其余 ${signals.length - VIEW_SIGNAL_CAP} 条信号省略）`);

  const objectById = new Map(objectRepository.findAll().map((o) => [o.id, o]));
  const objLines = objects.slice(0, VIEW_LIST_CAP).map(fmtObjectLine);
  if (objects.length > VIEW_LIST_CAP) objLines.push(`…（其余 ${objects.length - VIEW_LIST_CAP} 个对象省略）`);

  const relLines = relations.slice(0, VIEW_LIST_CAP).map((r) => fmtRelationLine(r, objectById));
  if (relations.length > VIEW_LIST_CAP) relLines.push(`…（其余 ${relations.length - VIEW_LIST_CAP} 条关系省略）`);

  const text = assemble([
    { priority: 0, title: '视图概况', lines: countLines },
    { priority: 0, title: '分布统计', lines: distLines },
    { priority: 1, title: '信号清单（Signal）', lines: sigLines },
    { priority: 2, title: '对象清单（Object）', lines: objLines },
    { priority: 3, title: '关系清单（Relation）', lines: relLines },
  ]);

  return {
    text,
    fingerprint: text,
    node_count: nodeCount,
    evidence_ids: evidences.map((e) => e.id),
    signal_ids: signals.map((s) => s.id),
    truncated: truncated ? true : undefined,
  };
}
