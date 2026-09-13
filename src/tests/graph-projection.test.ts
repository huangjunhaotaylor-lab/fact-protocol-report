/**
 * 图投影层测试（Business Graph OS — G0 批次）
 *
 * 覆盖：
 * - 投影完整性：播种后节点 5 类齐全、边 7 类齐全
 * - SAME_CHAIN（≤5 两两相连 / >5 只连相邻）、MERGED_INTO、DERIVED_FROM 边正确性
 * - expand 各 kind 一度邻居正确
 * - search 三种结构化短语 + 纯关键词全文
 * - stats 时间分桶 / kind / state / type 统计
 * - limit / kinds 过滤与 truncated 标记
 * - checksum_ok 现算（正确 / 篡改）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  projectGraph,
  expandNode,
  searchGraph,
  graphStats,
  GraphEdge,
} from '../queries/graph.projection';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import { computeChecksum } from '../utils/checksum';
import { Evidence, Fragment, Signal, BSPObject, Relation } from '../types';

// ---------------------------------------------------------------------------
// 播种工具
// ---------------------------------------------------------------------------

function seedEvidence(
  id: string,
  overrides: Partial<Evidence> = {},
  content = `证据原文 ${id}`,
): Evidence {
  const ev: Evidence = {
    id,
    source: 'meeting',
    content,
    checksum: computeChecksum(content),
    state: 'Created',
    created_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
  return evidenceRepository.create(ev);
}

function seedFragment(
  id: string,
  evidenceId: string,
  overrides: Partial<Fragment> = {},
): Fragment {
  const content = `片段内容 ${id}`;
  const fr: Fragment = {
    id,
    evidence_id: evidenceId,
    type: 'Speech',
    content,
    checksum: computeChecksum(content),
    state: 'Created',
    ...overrides,
  };
  return fragmentRepository.create(fr);
}

function seedSignal(
  id: string,
  fragments: string[],
  anchors: string[],
  overrides: Partial<Signal> = {},
): Signal {
  const sig: Signal = {
    id,
    type: 'observation',
    body: `信号观察 ${id}：仓库目前使用 Excel 盘点`,
    fragments,
    anchors,
    context: { channel: 'meeting' },
    state: 'Captured',
    captured_at: '2026-08-02T10:00:00.000Z',
    confidence: 0.9,
    ...overrides,
  };
  return signalRepository.create(sig);
}

function seedObject(id: string, overrides: Partial<BSPObject> = {}): BSPObject {
  const obj: BSPObject = {
    id,
    type: 'Customer',
    name: `对象${id}`,
    state: 'Active',
    created_at: '2026-08-03T10:00:00.000Z',
    updated_at: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
  return objectRepository.create(obj);
}

function seedRelation(
  id: string,
  source: string,
  target: string,
  derivedFrom: string,
  overrides: Partial<Relation> = {},
): Relation {
  const rel: Relation = {
    id,
    source,
    target,
    type: 'depends_on',
    derived_from: derivedFrom,
    confidence: 0.8,
    created_at: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
  return relationRepository.create(rel);
}

/** 播一套完整数据：EV→FRG→SIG→OBJ，OBJ-OBJ relation，合并留痕 */
function seedFullGraph() {
  const ev = seedEvidence('EV-1', { chain_id: 'CHAIN-A' });
  const frg = seedFragment('FRG-1', ev.id);
  const obj1 = seedObject('OBJ-1', { name: '华东大客户' });
  const obj2 = seedObject('OBJ-2', { name: '盘点系统', type: 'System' });
  const sig = seedSignal('SIG-1', [frg.id], [obj1.id]);
  const rel = seedRelation('REL-1', obj1.id, obj2.id, sig.id);
  const objOld = seedObject('OBJ-OLD', {
    name: '旧华东客户',
    state: 'Merged',
    attributes: { _merged_into: obj1.id, _merged_at: '2026-08-05T00:00:00.000Z' },
  });
  return { ev, frg, obj1, obj2, sig, rel, objOld };
}

beforeEach(() => {
  evidenceRepository.clear();
  fragmentRepository.clear();
  signalRepository.clear();
  objectRepository.clear();
  relationRepository.clear();
});

// ---------------------------------------------------------------------------
// 投影完整性
// ---------------------------------------------------------------------------

describe('图投影完整性', () => {
  it('播种后节点 5 类齐全，label / state / type / data 符合契约', () => {
    seedFullGraph();
    const { nodes, truncated } = projectGraph();

    const kinds = new Set(nodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(['Evidence', 'Fragment', 'Signal', 'Object', 'Relation']));
    expect(truncated).toBe(false);

    const ev = nodes.find((n) => n.id === 'EV-1')!;
    expect(ev.label).toBe('meeting·EV-1');
    expect(ev.type).toBe('meeting');
    expect(ev.state).toBe('Created');
    expect(ev.created_at).toBeDefined();
    expect(ev.checksum_ok).toBe(true);
    expect((ev.data as Evidence).content).toContain('证据原文');

    const frg = nodes.find((n) => n.id === 'FRG-1')!;
    expect(frg.label).toBe('Speech:片段内容 FRG-1');
    expect(frg.checksum_ok).toBe(true);

    const sig = nodes.find((n) => n.id === 'SIG-1')!;
    expect(sig.label).toBe('信号观察 SIG-1：仓库目前使用 Ex');
    expect(sig.label).toHaveLength(20);
    expect(sig.confidence).toBe(0.9);
    expect(sig.captured_at).toBeDefined();

    const obj = nodes.find((n) => n.id === 'OBJ-1')!;
    expect(obj.label).toBe('华东大客户');

    const rel = nodes.find((n) => n.id === 'REL-1')!;
    expect(rel.label).toBe('depends_on');
    expect(rel.confidence).toBe(0.8);

    // 节点不应包含 degree（由前端计算）
    for (const n of nodes) {
      expect(n).not.toHaveProperty('degree');
    }
  });

  it('播种后边 7 类齐全，端点与 label 正确', () => {
    seedFullGraph();
    const { edges } = projectGraph();

    const byKind = (kind: GraphEdge['kind']) => edges.filter((e) => e.kind === kind);

    const hasFragment = byKind('HAS_FRAGMENT');
    expect(hasFragment).toHaveLength(1);
    expect(hasFragment[0]).toMatchObject({ source: 'EV-1', target: 'FRG-1' });

    const supports = byKind('SUPPORTS');
    expect(supports).toHaveLength(1);
    expect(supports[0]).toMatchObject({ source: 'FRG-1', target: 'SIG-1' });

    const anchors = byKind('ANCHORS');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ source: 'SIG-1', target: 'OBJ-1' });

    const relation = byKind('RELATION');
    expect(relation).toHaveLength(1);
    expect(relation[0]).toMatchObject({
      source: 'OBJ-1',
      target: 'OBJ-2',
      label: 'depends_on',
    });

    const derivedFrom = byKind('DERIVED_FROM');
    expect(derivedFrom).toHaveLength(1);
    expect(derivedFrom[0]).toMatchObject({ source: 'REL-1', target: 'SIG-1' });

    const mergedInto = byKind('MERGED_INTO');
    expect(mergedInto).toHaveLength(1);
    expect(mergedInto[0]).toMatchObject({ source: 'OBJ-OLD', target: 'OBJ-1' });

    expect(byKind('SAME_CHAIN')).toHaveLength(0); // 链上只有 1 条 Evidence
  });
});

// ---------------------------------------------------------------------------
// SAME_CHAIN 语义
// ---------------------------------------------------------------------------

describe('SAME_CHAIN 边', () => {
  it('链上 3 条 Evidence：两两相连（3 条边）', () => {
    seedEvidence('EV-A1', { chain_id: 'CHAIN-A' });
    seedEvidence('EV-A2', { chain_id: 'CHAIN-A' });
    seedEvidence('EV-A3', { chain_id: 'CHAIN-A' });
    seedEvidence('EV-B1', { chain_id: 'CHAIN-B' }); // 另一条链不受影响

    const { edges } = projectGraph();
    const sameChain = edges.filter((e) => e.kind === 'SAME_CHAIN');
    expect(sameChain).toHaveLength(3);

    const pairs = sameChain.map((e) => [e.source, e.target].sort().join('|')).sort();
    expect(pairs).toEqual(['EV-A1|EV-A2', 'EV-A1|EV-A3', 'EV-A2|EV-A3']);
  });

  it('链上 6 条 Evidence（>5）：只连相邻，按 created_at 排序（5 条边）', () => {
    // 故意乱序播种
    seedEvidence('EV-C3', { chain_id: 'CHAIN-C', created_at: '2026-08-03T00:00:00.000Z' });
    seedEvidence('EV-C1', { chain_id: 'CHAIN-C', created_at: '2026-08-01T00:00:00.000Z' });
    seedEvidence('EV-C6', { chain_id: 'CHAIN-C', created_at: '2026-08-06T00:00:00.000Z' });
    seedEvidence('EV-C2', { chain_id: 'CHAIN-C', created_at: '2026-08-02T00:00:00.000Z' });
    seedEvidence('EV-C5', { chain_id: 'CHAIN-C', created_at: '2026-08-05T00:00:00.000Z' });
    seedEvidence('EV-C4', { chain_id: 'CHAIN-C', created_at: '2026-08-04T00:00:00.000Z' });

    const { edges } = projectGraph();
    const sameChain = edges.filter((e) => e.kind === 'SAME_CHAIN');
    expect(sameChain).toHaveLength(5);

    const pairs = sameChain.map((e) => `${e.source}|${e.target}`).sort();
    expect(pairs).toEqual([
      'EV-C1|EV-C2',
      'EV-C2|EV-C3',
      'EV-C3|EV-C4',
      'EV-C4|EV-C5',
      'EV-C5|EV-C6',
    ]);
  });
});

// ---------------------------------------------------------------------------
// expand
// ---------------------------------------------------------------------------

describe('expand 一度邻居', () => {
  it('Object → 其 signals + relations + merged', () => {
    seedFullGraph();
    const { node, nodes, edges } = expandNode('Object', 'OBJ-1');

    expect(node.id).toBe('OBJ-1');
    const ids = nodes.map((n) => n.id).sort();
    // ANCHORS(SIG-1) + RELATION(OBJ-2) + MERGED_INTO(OBJ-OLD)
    expect(ids).toEqual(['OBJ-2', 'OBJ-OLD', 'SIG-1']);
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['ANCHORS', 'RELATION', 'MERGED_INTO']));
  });

  it('Signal → fragments + anchors 的 objects + derived relations', () => {
    seedFullGraph();
    const { nodes, edges } = expandNode('Signal', 'SIG-1');

    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['FRG-1', 'OBJ-1', 'REL-1']);
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['SUPPORTS', 'ANCHORS', 'DERIVED_FROM']));
  });

  it('Fragment → evidence + signals', () => {
    seedFullGraph();
    const { nodes, edges } = expandNode('Fragment', 'FRG-1');

    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['EV-1', 'SIG-1']);
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['HAS_FRAGMENT', 'SUPPORTS']));
  });

  it('Evidence → fragments + 同链 Evidence', () => {
    seedFullGraph();
    seedEvidence('EV-2', { chain_id: 'CHAIN-A' });
    const { nodes, edges } = expandNode('Evidence', 'EV-1');

    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['EV-2', 'FRG-1']);
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['HAS_FRAGMENT', 'SAME_CHAIN']));
  });

  it('Relation → 两端 objects + derived signal', () => {
    seedFullGraph();
    const { nodes, edges } = expandNode('Relation', 'REL-1');

    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['OBJ-1', 'OBJ-2', 'SIG-1']);
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['RELATION', 'DERIVED_FROM']));
  });

  it('不存在的节点抛 404 NotFoundError，非法 kind 抛 ValidationError', () => {
    expect(() => expandNode('Object', 'NOPE')).toThrowError(/not found/);
    expect(() => expandNode('Alien', 'X')).toThrowError(/Unknown node kind/);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('search 结构化搜索', () => {
  beforeEach(() => {
    seedFullGraph();
  });

  it('短语「Signal 状态 Captured」', () => {
    seedSignal('SIG-2', ['FRG-1'], ['OBJ-1'], { state: 'Verified' });
    const { nodes, total } = searchGraph('Signal 状态 Captured');
    expect(total).toBe(1);
    expect(nodes[0].id).toBe('SIG-1');
  });

  it('短语「Object 类型 Customer」', () => {
    const { nodes } = searchGraph('Object 类型 Customer');
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['OBJ-1', 'OBJ-OLD']); // OBJ-2 是 System
  });

  it('短语「Evidence 来源 meeting」', () => {
    seedEvidence('EV-EMAIL', { source: 'email' });
    const { nodes } = searchGraph('Evidence 来源 meeting');
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['EV-1']);
  });

  it('纯关键词全文：匹配 body / name / content / label', () => {
    // body 命中
    expect(searchGraph('Excel').nodes.map((n) => n.id)).toContain('SIG-1');
    // name 命中
    expect(searchGraph('华东大客户').nodes.map((n) => n.id)).toContain('OBJ-1');
    // content 命中
    expect(searchGraph('片段内容 FRG-1').nodes.map((n) => n.id)).toContain('FRG-1');
    // label 命中（Evidence label 含 source）
    expect(searchGraph('meeting').nodes.map((n) => n.id)).toContain('EV-1');
    // 大小写不敏感
    expect(searchGraph('excel').nodes.map((n) => n.id)).toContain('SIG-1');
  });

  it('kind 参数限定返回类型；命中节点间的边一并返回', () => {
    const r = searchGraph('Excel', 'Signal');
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].kind).toBe('Signal');
    expect(r.edges).toHaveLength(0); // 只有一个命中节点，节点间无边

    // 两个命中节点之间的边
    const r2 = searchGraph('对象', undefined);
    const hitIds = new Set(r2.nodes.map((n) => n.id));
    for (const e of r2.edges) {
      expect(hitIds.has(e.source)).toBe(true);
      expect(hitIds.has(e.target)).toBe(true);
    }
  });

  it('空查询返回空结果', () => {
    expect(searchGraph('')).toEqual({ nodes: [], edges: [], total: 0 });
  });
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe('stats 直方图', () => {
  it('时间分桶按 captured_at ?? occurred_at ?? created_at 月聚合，by_kind 正确', () => {
    seedEvidence('EV-1', { created_at: '2026-07-15T10:00:00.000Z' });
    seedFragment('FRG-1', 'EV-1'); // Fragment 无时间字段，不进时间桶
    seedObject('OBJ-1', { created_at: '2026-08-03T10:00:00.000Z' });
    // occurred_at 优先于无 captured_at 的情况；captured_at 存在时优先 captured_at
    seedSignal('SIG-1', ['FRG-1'], ['OBJ-1'], {
      captured_at: '2026-09-01T10:00:00.000Z',
      occurred_at: '2026-08-20T10:00:00.000Z',
    });

    const stats = graphStats();
    const bucketMap = new Map(stats.time_buckets.map((b) => [b.bucket, b]));

    expect(stats.time_buckets.map((b) => b.bucket)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(bucketMap.get('2026-07')).toMatchObject({ count: 1, by_kind: { Evidence: 1 } });
    expect(bucketMap.get('2026-08')).toMatchObject({ count: 1, by_kind: { Object: 1 } });
    // Signal 用 captured_at（2026-09）而非 occurred_at（2026-08）
    expect(bucketMap.get('2026-09')).toMatchObject({ count: 1, by_kind: { Signal: 1 } });
  });

  it('kind_counts / state_counts / type_counts 正确', () => {
    seedFullGraph();
    seedSignal('SIG-2', ['FRG-1'], ['OBJ-2'], { state: 'Verified', type: 'event' });

    const stats = graphStats();

    expect(stats.kind_counts).toEqual({
      Evidence: 1,
      Fragment: 1,
      Signal: 2,
      Object: 3,
      Relation: 1,
    });

    expect(stats.state_counts.Signal).toEqual({ Captured: 1, Verified: 1 });
    expect(stats.state_counts.Object).toEqual({ Active: 2, Merged: 1 });

    expect(stats.type_counts.Object).toEqual({ Customer: 2, System: 1 });
    expect(stats.type_counts.Signal).toEqual({ observation: 1, event: 1 });
    expect(stats.type_counts.Evidence).toEqual({ meeting: 1 });
  });
});

// ---------------------------------------------------------------------------
// limit / kinds 过滤
// ---------------------------------------------------------------------------

describe('limit / kinds 过滤', () => {
  it('kinds 过滤：只保留选中类型节点，边两端均存活才保留', () => {
    seedFullGraph();
    const { nodes, edges, total } = projectGraph({ kinds: ['Evidence', 'Object'] });

    expect(new Set(nodes.map((n) => n.kind))).toEqual(new Set(['Evidence', 'Object']));
    expect(total).toBe(4); // EV-1 + OBJ-1/OBJ-2/OBJ-OLD
    // FRG-1 / SIG-1 / REL-1 被滤掉，相关边全部消失；只剩 Object 之间的边
    const edgeKinds = new Set(edges.map((e) => e.kind));
    expect(edgeKinds).toEqual(new Set(['RELATION', 'MERGED_INTO']));
    for (const e of edges) {
      expect(nodes.some((n) => n.id === e.source)).toBe(true);
      expect(nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });

  it('limit 保护：超限 truncated:true，边不悬空', () => {
    seedFullGraph(); // 7 个节点（1+1+2+1+1+1）
    const { nodes, edges, truncated, total } = projectGraph({ limit: 3 });

    expect(total).toBe(7);
    expect(truncated).toBe(true);
    expect(nodes).toHaveLength(3);

    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('默认 limit=500 不截断小图', () => {
    seedFullGraph();
    const { truncated, total } = projectGraph();
    expect(total).toBe(7);
    expect(truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checksum_ok
// ---------------------------------------------------------------------------

describe('checksum_ok 现算', () => {
  it('checksum 匹配 → true；篡改 → false', () => {
    seedEvidence('EV-OK');
    seedEvidence('EV-BAD', { checksum: 'deadbeef' });
    seedFragment('FRG-OK', 'EV-OK');
    seedFragment('FRG-BAD', 'EV-OK', { checksum: 'deadbeef' });
    seedObject('OBJ-1');

    const { nodes } = projectGraph();
    const byId = new Map(nodes.map((n) => [n.id, n]));

    expect(byId.get('EV-OK')!.checksum_ok).toBe(true);
    expect(byId.get('EV-BAD')!.checksum_ok).toBe(false);
    expect(byId.get('FRG-OK')!.checksum_ok).toBe(true);
    expect(byId.get('FRG-BAD')!.checksum_ok).toBe(false);
    // 非 Evidence/Fragment 节点不带 checksum_ok
    expect(byId.get('OBJ-1')!).not.toHaveProperty('checksum_ok');
  });
});
