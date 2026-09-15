/**
 * relations.ts — computeRelations 单元测试
 */

import { describe, it, expect } from 'vitest';
import { computeRelations } from '../src/relations';
import type { BspSignal, BspRelation, SignalTrace } from '../src/bsp';

function signal(id: string, anchors: string[]): BspSignal {
  return { id, type: 'observation', body: id, state: 'Captured', anchors, fragments: [], confidence: 0.9 };
}

function trace(signalId: string, evidenceIds: string[]): SignalTrace {
  return {
    signal: { id: signalId, body: signalId, state: 'Captured' },
    fragments: [],
    evidences: evidenceIds.map((id) => ({ id, content: '' })),
    chain: [],
  };
}

function traces(map: Record<string, string[]>): Map<string, SignalTrace> {
  const m = new Map<string, SignalTrace>();
  for (const [sid, evs] of Object.entries(map)) m.set(sid, trace(sid, evs));
  return m;
}

describe('computeRelations', () => {
  it('同一 Evidence 内两个 Object → 生成双向 references 关系', () => {
    const signals = [signal('S1', ['OBJ-A']), signal('S2', ['OBJ-B'])];
    const t = traces({ S1: ['EV-1'], S2: ['EV-1'] });
    const proposed = computeRelations(signals, t, []);

    expect(proposed).toHaveLength(2);
    const pairs = proposed.map((p) => `${p.source}->${p.target}`).sort();
    expect(pairs).toEqual(['OBJ-A->OBJ-B', 'OBJ-B->OBJ-A']);
    // derived_from 必须锚定 source
    for (const p of proposed) {
      const srcSignal = signals.find((s) => s.id === p.derived_from)!;
      expect(srcSignal.anchors).toContain(p.source);
    }
  });

  it('一个 Signal 锚定多个 Object → 两两成对', () => {
    const signals = [signal('S1', ['OBJ-A', 'OBJ-B', 'OBJ-C'])];
    const t = traces({ S1: ['EV-1'] });
    const proposed = computeRelations(signals, t, []);

    expect(proposed).toHaveLength(6); // 3 × 2 有序对
    expect(new Set(proposed.map((p) => p.derived_from))).toEqual(new Set(['S1']));
  });

  it('无锚定 / 无追溯的 Signal 被跳过', () => {
    const signals = [signal('S1', ['OBJ-A']), signal('S2', [])];
    const t = traces({ S1: ['EV-1'] }); // S2 无追溯
    const proposed = computeRelations(signals, t, []);
    expect(proposed).toHaveLength(0);
  });

  it('不同 Evidence 之间不跨证据生成关系', () => {
    const signals = [signal('S1', ['OBJ-A']), signal('S2', ['OBJ-B'])];
    const t = traces({ S1: ['EV-1'], S2: ['EV-2'] });
    expect(computeRelations(signals, t, [])).toHaveLength(0);
  });

  it('与已存在 Relation 去重（幂等）', () => {
    const signals = [signal('S1', ['OBJ-A']), signal('S2', ['OBJ-B'])];
    const t = traces({ S1: ['EV-1'], S2: ['EV-1'] });
    const existing: BspRelation[] = [
      { id: 'REL-1', source: 'OBJ-A', target: 'OBJ-B', type: 'references', derived_from: 'S1', confidence: 0.7 },
    ];
    const proposed = computeRelations(signals, t, existing);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ source: 'OBJ-B', target: 'OBJ-A' });
  });

  it('不生成自引用关系', () => {
    const signals = [signal('S1', ['OBJ-A'])];
    const t = traces({ S1: ['EV-1'] });
    expect(computeRelations(signals, t, [])).toHaveLength(0);
  });
});
