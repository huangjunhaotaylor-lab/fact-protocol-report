/**
 * 图投影层（Business Graph OS — G0 批次）
 *
 * 依据设计文档「二、BSP → 图模型映射（投影层契约）」：
 * 将五个协议对象 Repository 投影为统一形状的图（节点 + 边）。
 *
 * 纯增量查询模块：只读五个 Repository，不修改任何现有业务代码。
 *
 * 节点（5 类）：Evidence / Fragment / Signal / Object / Relation
 * 边（7 类）：
 * - HAS_FRAGMENT   Evidence → Fragment    (fragment.evidence_id)
 * - SUPPORTS       Fragment → Signal      (signal.fragments[])
 * - ANCHORS        Signal → Object        (signal.anchors[])
 * - RELATION       Object → Object        (relation.source/target，label=relation.type)
 * - DERIVED_FROM   Relation → Signal      (relation.derived_from)
 * - MERGED_INTO    Object → Object        (object.attributes._merged_into 合并留痕)
 * - SAME_CHAIN     Evidence ↔ Evidence    (evidence.chain_id；>5 条只连相邻，按 created_at 排序)
 *
 * 注意：degree 由前端计算，不在此投影。
 */

import { Evidence, Fragment, Signal, BSPObject, Relation } from '../types';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import { verifyChecksum } from '../utils/checksum';
import { NotFoundError, ValidationError } from '../utils/errors';

// ---------------------------------------------------------------------------
// 图元素类型
// ---------------------------------------------------------------------------

export type GraphNodeKind = 'Evidence' | 'Fragment' | 'Signal' | 'Object' | 'Relation';

export const GRAPH_NODE_KINDS: GraphNodeKind[] = [
  'Evidence',
  'Fragment',
  'Signal',
  'Object',
  'Relation',
];

export type GraphEdgeKind =
  | 'HAS_FRAGMENT'
  | 'SUPPORTS'
  | 'ANCHORS'
  | 'RELATION'
  | 'DERIVED_FROM'
  | 'MERGED_INTO'
  | 'SAME_CHAIN';

/** 图节点 — 统一形状（degree 由前端计算） */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  state?: string;
  type?: string;
  created_at?: string;
  captured_at?: string;
  occurred_at?: string;
  confidence?: number;
  /** Evidence / Fragment 专用：checksum 现算校验结果 */
  checksum_ok?: boolean;
  /** G0：业务板块（Signal 自身分类 / Object 传导；其余 kind 不带） */
  domains?: string[];
  /** G0：主线板块 */
  primary_domain?: string | null;
  /** 原始协议对象全量（供检查器面板） */
  data: Evidence | Fragment | Signal | BSPObject | Relation;
}

/** 图边 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label?: string;
}

/** 全图投影结果 */
export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 是否因 limit 被截断 */
  truncated: boolean;
  /** 截断前（kinds 过滤后）的节点总数 */
  total: number;
}

export interface GraphQueryOptions {
  /** 节点数上限保护（默认 500） */
  limit?: number;
  /** 节点类型过滤 */
  kinds?: GraphNodeKind[];
  /**
   * G0：业务板块过滤
   * - Signal 按自身 domains 含该板块过滤
   * - Object 按自身 domains 含该板块过滤
   * - Fragment / Evidence 跟随其关联 Signal（Fragment 被保留 Signal 引用；Evidence 含保留 Fragment）
   * - Relation 两端 Object 都保留才保留
   */
  domain?: string;
}

// ---------------------------------------------------------------------------
// Label 生成规则
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id;
}

function evidenceLabel(ev: Evidence): string {
  return `${ev.source}·${shortId(ev.id)}`;
}

function fragmentLabel(fr: Fragment): string {
  return `${fr.type}:${fr.content.slice(0, 12)}`;
}

function signalLabel(sig: Signal): string {
  return sig.body.slice(0, 20);
}

function objectLabel(obj: BSPObject): string {
  return obj.name;
}

function relationLabel(rel: Relation): string {
  return rel.type;
}

// ---------------------------------------------------------------------------
// 节点投影
// ---------------------------------------------------------------------------

function projectEvidence(ev: Evidence): GraphNode {
  return {
    id: ev.id,
    kind: 'Evidence',
    label: evidenceLabel(ev),
    state: ev.state,
    type: ev.source,
    created_at: ev.created_at,
    checksum_ok: verifyChecksum(ev.content, ev.checksum),
    data: ev,
  };
}

function projectFragment(fr: Fragment): GraphNode {
  return {
    id: fr.id,
    kind: 'Fragment',
    label: fragmentLabel(fr),
    state: fr.state,
    type: fr.type,
    checksum_ok: verifyChecksum(fr.content, fr.checksum),
    data: fr,
  };
}

function projectSignal(sig: Signal): GraphNode {
  return {
    id: sig.id,
    kind: 'Signal',
    label: signalLabel(sig),
    state: sig.state,
    type: sig.type,
    captured_at: sig.captured_at,
    occurred_at: sig.occurred_at,
    confidence: sig.confidence,
    domains: sig.domains ?? [],
    primary_domain: sig.primary_domain ?? null,
    data: sig,
  };
}

function projectObject(obj: BSPObject): GraphNode {
  return {
    id: obj.id,
    kind: 'Object',
    label: objectLabel(obj),
    state: obj.state,
    type: obj.type,
    created_at: obj.created_at,
    domains: obj.domains ?? [],
    primary_domain: obj.primary_domain ?? null,
    data: obj,
  };
}

function projectRelation(rel: Relation): GraphNode {
  return {
    id: rel.id,
    kind: 'Relation',
    label: relationLabel(rel),
    type: rel.type,
    created_at: rel.created_at,
    confidence: rel.confidence,
    data: rel,
  };
}

// ---------------------------------------------------------------------------
// 边投影
// ---------------------------------------------------------------------------

function edgeId(kind: GraphEdgeKind, source: string, target: string): string {
  return `${kind}:${source}->${target}`;
}

interface RawData {
  evidences: Evidence[];
  fragments: Fragment[];
  signals: Signal[];
  objects: BSPObject[];
  relations: Relation[];
}

function loadAll(): RawData {
  return {
    evidences: evidenceRepository.findAll(),
    fragments: fragmentRepository.findAll(),
    signals: signalRepository.findAll(),
    objects: objectRepository.findAll(),
    relations: relationRepository.findAll(),
  };
}

function buildEdges(raw: RawData): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const evidenceIds = new Set(raw.evidences.map((e) => e.id));
  const fragmentIds = new Set(raw.fragments.map((f) => f.id));
  const signalIds = new Set(raw.signals.map((s) => s.id));
  const objectIds = new Set(raw.objects.map((o) => o.id));

  // HAS_FRAGMENT: Evidence → Fragment
  for (const fr of raw.fragments) {
    if (evidenceIds.has(fr.evidence_id)) {
      edges.push({
        id: edgeId('HAS_FRAGMENT', fr.evidence_id, fr.id),
        source: fr.evidence_id,
        target: fr.id,
        kind: 'HAS_FRAGMENT',
      });
    }
  }

  // SUPPORTS: Fragment → Signal；ANCHORS: Signal → Object
  for (const sig of raw.signals) {
    for (const fragId of sig.fragments) {
      if (fragmentIds.has(fragId)) {
        edges.push({
          id: edgeId('SUPPORTS', fragId, sig.id),
          source: fragId,
          target: sig.id,
          kind: 'SUPPORTS',
        });
      }
    }
    for (const objId of sig.anchors) {
      if (objectIds.has(objId)) {
        edges.push({
          id: edgeId('ANCHORS', sig.id, objId),
          source: sig.id,
          target: objId,
          kind: 'ANCHORS',
        });
      }
    }
  }

  // RELATION: Object → Object（label=relation.type）；DERIVED_FROM: Relation → Signal
  for (const rel of raw.relations) {
    if (objectIds.has(rel.source) && objectIds.has(rel.target)) {
      edges.push({
        id: edgeId('RELATION', rel.source, rel.target),
        source: rel.source,
        target: rel.target,
        kind: 'RELATION',
        label: rel.type,
      });
    }
    if (signalIds.has(rel.derived_from)) {
      edges.push({
        id: edgeId('DERIVED_FROM', rel.id, rel.derived_from),
        source: rel.id,
        target: rel.derived_from,
        kind: 'DERIVED_FROM',
      });
    }
  }

  // MERGED_INTO: Object → Object（合并留痕存于 attributes._merged_into）
  for (const obj of raw.objects) {
    const mergedInto = obj.attributes?._merged_into;
    if (typeof mergedInto === 'string' && objectIds.has(mergedInto)) {
      edges.push({
        id: edgeId('MERGED_INTO', obj.id, mergedInto),
        source: obj.id,
        target: mergedInto,
        kind: 'MERGED_INTO',
      });
    }
  }

  // SAME_CHAIN: Evidence ↔ Evidence（同 chain_id；>5 条只连相邻，按 created_at 排序）
  const byChain = new Map<string, Evidence[]>();
  for (const ev of raw.evidences) {
    if (!ev.chain_id) continue;
    const list = byChain.get(ev.chain_id) ?? [];
    list.push(ev);
    byChain.set(ev.chain_id, list);
  }
  for (const chainEvidences of byChain.values()) {
    if (chainEvidences.length < 2) continue;
    if (chainEvidences.length > 5) {
      // 只连相邻（按 created_at 排序）
      const sorted = [...chainEvidences].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        edges.push({
          id: edgeId('SAME_CHAIN', sorted[i].id, sorted[i + 1].id),
          source: sorted[i].id,
          target: sorted[i + 1].id,
          kind: 'SAME_CHAIN',
        });
      }
    } else {
      // 两两相连
      for (let i = 0; i < chainEvidences.length; i++) {
        for (let j = i + 1; j < chainEvidences.length; j++) {
          edges.push({
            id: edgeId('SAME_CHAIN', chainEvidences[i].id, chainEvidences[j].id),
            source: chainEvidences[i].id,
            target: chainEvidences[j].id,
            kind: 'SAME_CHAIN',
          });
        }
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// 板块过滤（G0）
// ---------------------------------------------------------------------------

/**
 * 按板块过滤节点：
 * - Signal / Object：自身 domains 含该板块
 * - Fragment：被保留 Signal 引用（跟随其关联 Signal）
 * - Evidence：含被保留 Fragment（跟随其关联 Signal）
 * - Relation：两端 Object 都保留才保留
 */
function filterByDomain(raw: RawData, nodes: GraphNode[], domain: string): GraphNode[] {
  const keptSignalIds = new Set(
    raw.signals.filter((s) => (s.domains ?? []).includes(domain)).map((s) => s.id),
  );
  const keptFragmentIds = new Set(
    raw.fragments
      .filter((f) => raw.signals.some((s) => keptSignalIds.has(s.id) && s.fragments.includes(f.id)))
      .map((f) => f.id),
  );
  const keptEvidenceIds = new Set(
    raw.evidences
      .filter((e) => raw.fragments.some((f) => keptFragmentIds.has(f.id) && f.evidence_id === e.id))
      .map((e) => e.id),
  );
  const keptObjectIds = new Set(
    raw.objects.filter((o) => (o.domains ?? []).includes(domain)).map((o) => o.id),
  );
  const keptRelationIds = new Set(
    raw.relations
      .filter((r) => keptObjectIds.has(r.source) && keptObjectIds.has(r.target))
      .map((r) => r.id),
  );

  return nodes.filter((n) => {
    switch (n.kind) {
      case 'Signal':
        return keptSignalIds.has(n.id);
      case 'Object':
        return keptObjectIds.has(n.id);
      case 'Fragment':
        return keptFragmentIds.has(n.id);
      case 'Evidence':
        return keptEvidenceIds.has(n.id);
      case 'Relation':
        return keptRelationIds.has(n.id);
    }
  });
}

// ---------------------------------------------------------------------------
// 查询：全图投影
// ---------------------------------------------------------------------------

/**
 * 全图投影
 * - kinds 过滤节点类型（只保留两端节点均存活的边）
 * - domain 板块过滤（G0，语义见 filterByDomain）
 * - limit 节点数上限保护（默认 500），超限返回 truncated:true
 */
export function projectGraph(options: GraphQueryOptions = {}): GraphProjection {
  const limit = options.limit ?? 500;
  const kindFilter = options.kinds ? new Set<GraphNodeKind>(options.kinds) : null;

  const raw = loadAll();

  let nodes: GraphNode[] = [
    ...raw.evidences.map(projectEvidence),
    ...raw.fragments.map(projectFragment),
    ...raw.signals.map(projectSignal),
    ...raw.objects.map(projectObject),
    ...raw.relations.map(projectRelation),
  ];

  if (kindFilter) {
    nodes = nodes.filter((n) => kindFilter.has(n.kind));
  }

  // G0：板块过滤（先于 limit，total 计过滤后的真实规模）
  if (options.domain) {
    nodes = filterByDomain(raw, nodes, options.domain);
  }

  const total = nodes.length;
  const truncated = total > limit;
  if (truncated) {
    nodes = nodes.slice(0, limit);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = buildEdges(raw).filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  return { nodes, edges, truncated, total };
}

// ---------------------------------------------------------------------------
// 查询：单节点一度邻居展开
// ---------------------------------------------------------------------------

/** 节点与其一度邻居子图 */
export interface GraphNeighborhood {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function findRawNode(kind: GraphNodeKind, id: string): GraphNode | undefined {
  switch (kind) {
    case 'Evidence': {
      const ev = evidenceRepository.findById(id);
      return ev ? projectEvidence(ev) : undefined;
    }
    case 'Fragment': {
      const fr = fragmentRepository.findById(id);
      return fr ? projectFragment(fr) : undefined;
    }
    case 'Signal': {
      const sig = signalRepository.findById(id);
      return sig ? projectSignal(sig) : undefined;
    }
    case 'Object': {
      const obj = objectRepository.findById(id);
      return obj ? projectObject(obj) : undefined;
    }
    case 'Relation': {
      const rel = relationRepository.findById(id);
      return rel ? projectRelation(rel) : undefined;
    }
  }
}

/**
 * 单节点一度邻居展开（Bloom expand）
 *
 * 按 kind 分派的语义由全图投影的一度邻接统一覆盖：
 * - Object   → 其 signals（ANCHORS）+ relations（RELATION/Relation 节点）+ merged（MERGED_INTO）
 * - Signal   → fragments（SUPPORTS）+ anchors 的 objects（ANCHORS）+ derived relations（DERIVED_FROM）
 * - Fragment → evidence（HAS_FRAGMENT）+ signals（SUPPORTS）
 * - Evidence → fragments（HAS_FRAGMENT）+ 同链 Evidence（SAME_CHAIN）
 * - Relation → 两端 objects（RELATION）+ derived signal（DERIVED_FROM）
 */
export function expandNode(kind: string, id: string): GraphNeighborhood {
  if (!GRAPH_NODE_KINDS.includes(kind as GraphNodeKind)) {
    throw new ValidationError(`Unknown node kind: "${kind}"`, ['kind']);
  }
  const center = findRawNode(kind as GraphNodeKind, id);
  if (!center) {
    throw new NotFoundError(kind, id);
  }

  // 一度邻接：全图投影后筛出与中心节点直接相连的边与节点
  const full = projectGraph({ limit: Number.MAX_SAFE_INTEGER });
  const edges = full.edges.filter((e) => e.source === id || e.target === id);

  // Relation 节点特判：RELATION 边两端是 Object，不直接触 Relation 节点，
  // 需补入该 Relation 派生的 RELATION 边，从而带出两端 Object 邻居
  if (kind === 'Relation') {
    const rel = center.data as Relation;
    for (const e of full.edges) {
      if (e.kind === 'RELATION' && e.source === rel.source && e.target === rel.target) {
        edges.push(e);
      }
    }
  }

  const neighborIds = new Set<string>();
  for (const e of edges) {
    neighborIds.add(e.source);
    neighborIds.add(e.target);
  }
  neighborIds.delete(id);
  const nodes = full.nodes.filter((n) => neighborIds.has(n.id));

  return { node: center, nodes, edges };
}

// ---------------------------------------------------------------------------
// 查询：结构化搜索
// ---------------------------------------------------------------------------

export interface GraphSearchResult {
  nodes: GraphNode[];
  /** 命中节点之间的边 */
  edges: GraphEdge[];
  total: number;
}

/** 中文属性名 → 节点字段 */
const SEARCH_ATTR_MAP: Record<string, 'state' | 'type' | 'source'> = {
  状态: 'state',
  类型: 'type',
  来源: 'source',
  // 注意：「板块」是 G0 新增的特殊属性（匹配 domains 数组包含），
  // 不走字段映射，在 searchGraph 内单独处理
};

/** 节点类型中文别名 → 英文 kind */
const SEARCH_KIND_ALIAS: Record<string, GraphNodeKind> = {
  证据: 'Evidence', 片段: 'Fragment', 信号: 'Signal', 对象: 'Object', 关系: 'Relation',
};

/** 属性值中文别名 → 英文值（状态 / 对象类型 / 信号类型） */
const SEARCH_VALUE_ALIAS: Record<string, string> = {
  待核: 'captured', 已核: 'verified', 无效: 'invalid', 已归档: 'archived', 归档: 'archived',
  已创建: 'created', 活跃: 'active', 已合并: 'merged',
  客户: 'customer', 部门: 'department', 项目: 'project', 系统: 'system',
  文档: 'document', 人员: 'person', 产品: 'product',
  观察: 'observation', 事件: 'event', 变更: 'change', 行动: 'action',
};

/** 全文匹配的候选文本（label / body / name / content 前 200 字） */
function fullTextOf(node: GraphNode): string {
  const data = node.data as { body?: unknown; name?: unknown; content?: unknown };
  const parts = [node.label];
  if (typeof data.body === 'string') parts.push(data.body.slice(0, 200));
  if (typeof data.name === 'string') parts.push(data.name.slice(0, 200));
  if (typeof data.content === 'string') parts.push(data.content.slice(0, 200));
  return parts.join('\n').toLowerCase();
}

/**
 * 结构化搜索
 *
 * 支持三类查询：
 * 1. 「类型 + 属性中文名 + 值」短语：如 "Signal 状态 Captured"、"Object 类型 Customer"、
 *    "Evidence 来源 meeting"（属性映射：状态→state、类型→type、来源→source）
 * 2. 「类型 + 板块 + 板块名」短语（G0）：如 "信号 板块 仓储运营"，
 *    匹配节点 domains 数组包含该板块（Signal / Object 节点）
 * 3. 纯关键词全文：匹配 label / body / name / content 前 200 字（大小写不敏感）
 *
 * kind 参数进一步限定返回节点类型。
 */
export function searchGraph(query: string, kind?: string): GraphSearchResult {
  const q = (query ?? '').trim();
  if (!q) {
    return { nodes: [], edges: [], total: 0 };
  }
  if (kind && !GRAPH_NODE_KINDS.includes(kind as GraphNodeKind)) {
    throw new ValidationError(`Unknown node kind: "${kind}"`, ['kind']);
  }

  const full = projectGraph({ limit: Number.MAX_SAFE_INTEGER });
  let candidates = full.nodes;
  if (kind) {
    candidates = candidates.filter((n) => n.kind === kind);
  }

  // 尝试解析「类型 + 属性中文名 + 值」结构化短语（kind 与值均支持中文别名）
  const tokens = q.split(/\s+/);
  let hits: GraphNode[];
  const kindTok = SEARCH_KIND_ALIAS[tokens[0]]
    ?? (GRAPH_NODE_KINDS.includes(tokens[0] as GraphNodeKind) ? (tokens[0] as GraphNodeKind) : undefined);
  if (tokens.length >= 3 && kindTok) {
    const phraseKind = kindTok;
    if (tokens[1] === '板块') {
      // G0：板块短语 — 匹配节点 domains 数组包含该板块名（大小写敏感，板块名是中文专有词）
      const value = tokens.slice(2).join(' ');
      hits = full.nodes.filter((n) => {
        if (n.kind !== phraseKind) return false;
        if (kind && n.kind !== kind) return false;
        return (n.domains ?? []).includes(value);
      });
    } else {
      const attr = SEARCH_ATTR_MAP[tokens[1]];
      if (attr) {
        const rawValue = tokens.slice(2).join(' ').toLowerCase();
        const value = SEARCH_VALUE_ALIAS[rawValue] ?? rawValue;
        hits = full.nodes.filter((n) => {
          if (n.kind !== phraseKind) return false;
          if (kind && n.kind !== kind) return false;
          const raw =
            attr === 'source'
              ? (n.data as Evidence).source ?? n.type
              : (n as unknown as Record<string, unknown>)[attr];
          return typeof raw === 'string' && raw.toLowerCase() === value;
        });
      } else {
        hits = keywordSearch(candidates, q);
      }
    }
  } else {
    hits = keywordSearch(candidates, q);
  }

  const hitIds = new Set(hits.map((n) => n.id));
  const edges = full.edges.filter((e) => hitIds.has(e.source) && hitIds.has(e.target));

  return { nodes: hits, edges, total: hits.length };
}

function keywordSearch(candidates: GraphNode[], q: string): GraphNode[] {
  const needle = q.toLowerCase();
  return candidates.filter((n) => fullTextOf(n).includes(needle));
}

// ---------------------------------------------------------------------------
// 查询：直方图统计
// ---------------------------------------------------------------------------

export interface GraphTimeBucket {
  /** 'YYYY-MM' */
  bucket: string;
  count: number;
  by_kind: Partial<Record<GraphNodeKind, number>>;
}

export interface GraphStats {
  /** 按 captured_at ?? occurred_at ?? created_at 月聚合，升序 */
  time_buckets: GraphTimeBucket[];
  kind_counts: Partial<Record<GraphNodeKind, number>>;
  /** 各 kind 的状态分布 */
  state_counts: Partial<Record<GraphNodeKind, Record<string, number>>>;
  /** 各 kind 的类型分布 */
  type_counts: Partial<Record<GraphNodeKind, Record<string, number>>>;
  /** G0：板块分布（统计 Signal / Object 节点 domains 命中数，一个节点可计入多个板块） */
  domain_counts: Record<string, number>;
}

/** 直方图数据（时间 / 类型 / 状态分桶）；G0：支持 domain 板块过滤，输出 domain_counts */
export function graphStats(domain?: string): GraphStats {
  const { nodes } = projectGraph({ limit: Number.MAX_SAFE_INTEGER, domain });

  const buckets = new Map<string, GraphTimeBucket>();
  const kindCounts: Partial<Record<GraphNodeKind, number>> = {};
  const stateCounts: Partial<Record<GraphNodeKind, Record<string, number>>> = {};
  const typeCounts: Partial<Record<GraphNodeKind, Record<string, number>>> = {};
  const domainCounts: Record<string, number> = {};

  for (const node of nodes) {
    kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;

    // G0：板块分布（仅 Signal / Object 节点带 domains 字段）
    for (const d of node.domains ?? []) {
      domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    }

    if (node.state) {
      const byKind = (stateCounts[node.kind] ??= {});
      byKind[node.state] = (byKind[node.state] ?? 0) + 1;
    }

    if (node.type) {
      const byKind = (typeCounts[node.kind] ??= {});
      byKind[node.type] = (byKind[node.type] ?? 0) + 1;
    }

    const ts = node.captured_at ?? node.occurred_at ?? node.created_at;
    if (ts) {
      const month = ts.slice(0, 7);
      const bucket = buckets.get(month) ?? { bucket: month, count: 0, by_kind: {} };
      bucket.count += 1;
      bucket.by_kind[node.kind] = (bucket.by_kind[node.kind] ?? 0) + 1;
      buckets.set(month, bucket);
    }
  }

  const time_buckets = Array.from(buckets.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  );

  return {
    time_buckets,
    kind_counts: kindCounts,
    state_counts: stateCounts,
    type_counts: typeCounts,
    domain_counts: domainCounts,
  };
}

// 单例风格导出入口（与既有 query 模块保持一致的使用习惯）
export const graphProjection = {
  projectGraph,
  expandNode,
  searchGraph,
  graphStats,
};
