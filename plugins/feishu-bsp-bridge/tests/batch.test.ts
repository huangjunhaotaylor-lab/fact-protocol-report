/**
 * batch.ts — loadManifest / batchIngest / buildDomainReport 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { loadManifest, buildDomainReport } from '../src/batch';

function writeManifest(content: unknown): string {
  const p = path.join(tmpdir(), `bsp-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(content));
  return p;
}

describe('loadManifest', () => {
  it('解析合法 manifest', () => {
    const p = writeManifest({
      continueOnError: true,
      documents: [
        { doc: 'W6qTdjo97oL50NxATnScG93SnoF', objectName: '仓库盘点流程', signalBody: '仓库使用 Excel 盘点。' },
        { doc: 'https://my.feishu.cn/wiki/XXX', objectId: 'OBJ-1' },
      ],
    });
    const m = loadManifest(p);
    expect(m.documents).toHaveLength(2);
    expect(m.continueOnError).toBe(true);
    expect(m.documents[0].doc).toBe('W6qTdjo97oL50NxATnScG93SnoF');
    expect(m.documents[1].objectId).toBe('OBJ-1');
  });

  it('documents 为空时拒绝', () => {
    const p = writeManifest({ documents: [] });
    expect(() => loadManifest(p)).toThrow(/documents/);
  });

  it('条目缺 doc 字段时拒绝', () => {
    const p = writeManifest({ documents: [{ objectName: 'x' }] });
    expect(() => loadManifest(p)).toThrow(/doc/);
  });

  it('G4：接受 domains / primary_domain 覆盖字段', () => {
    const p = writeManifest({
      documents: [{ doc: 'A', domains: ['采购供应', '仓储运营'], primary_domain: '采购供应' }],
    });
    const m = loadManifest(p);
    expect(m.documents[0].domains).toEqual(['采购供应', '仓储运营']);
    expect(m.documents[0].primary_domain).toBe('采购供应');
  });

  it('G4：domains 不是非空字符串数组时拒绝', () => {
    expect(() => loadManifest(writeManifest({ documents: [{ doc: 'A', domains: '采购供应' }] }))).toThrow(
      /domains/,
    );
    expect(() => loadManifest(writeManifest({ documents: [{ doc: 'A', domains: [''] }] }))).toThrow(/domains/);
  });

  it('G4：primary_domain 不在 domains 内 / 缺 domains 时拒绝', () => {
    expect(() =>
      loadManifest(writeManifest({ documents: [{ doc: 'A', domains: ['财务'], primary_domain: '采购供应' }] })),
    ).toThrow(/primary_domain/);
    expect(() => loadManifest(writeManifest({ documents: [{ doc: 'A', primary_domain: '采购供应' }] }))).toThrow(
      /primary_domain/,
    );
  });
});

/* ---------------- batchIngest 编排（mock ingest/relations/bsp） ---------------- */

const h = vi.hoisted(() => ({
  makeIngest: () =>
    vi.fn(async (opts: { doc: string; dryRun?: boolean }) => ({
      document: { token: opts.doc, title: 't', content: 'c' },
      object: { id: 'OBJ-1', name: 'n' },
      evidence: { id: 'EV-1' },
      fragments: [{ id: 'FRG-1', content: 'c' }],
      signal: { id: 'SIG-1', body: 'b', state: 'Captured' },
      skipped: [],
      dryRun: Boolean(opts.dryRun),
    })),
  makeGen: () =>
    vi.fn(async () => ({
      proposed: [{ source: 'A', target: 'B', type: 'references', derived_from: 'S1', confidence: 0.7, evidence_id: 'EV-1' }],
      created: [{ id: 'REL-1', source: 'A', target: 'B', type: 'references', derived_from: 'S1', confidence: 0.7 }],
      skipped: [],
      dryRun: false,
    })),
  makeBsp: () => ({
    setSignalDomains: vi.fn(async (id: string, input: { domains: string[]; primary_domain?: string }) => ({
      id,
      type: 'observation',
      body: 'b',
      state: 'Captured',
      anchors: ['OBJ-1'],
      fragments: ['FRG-1'],
      confidence: 0.9,
      domains: [...input.domains],
      primary_domain: input.primary_domain ?? input.domains[0] ?? null,
      domain_manual: true,
    })),
  }),
}));

vi.mock('../src/ingest', () => ({
  // 调用时动态解析，避免工厂求值期缓存 undefined
  ingestDocument: (...args: unknown[]) => (globalThis as any).__mockIngest(...args),
}));

vi.mock('../src/relations', () => ({
  generateRelations: (...args: unknown[]) => (globalThis as any).__mockGen(...args),
}));

vi.mock('../src/bsp', () => ({
  createBspClient: () => (globalThis as any).__mockBsp,
}));

describe('batchIngest', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).__mockIngest = h.makeIngest();
    (globalThis as any).__mockGen = h.makeGen();
    (globalThis as any).__mockBsp = h.makeBsp();
  });

  it('逐条导入并汇总结果', async () => {
    const p = writeManifest({ documents: [{ doc: 'A' }, { doc: 'B' }] });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, {});

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.items.every((i) => i.ok)).toBe(true);
    expect(result.relations).toBeUndefined();
  });

  it('默认失败即停；--continue-on-error 继续', async () => {
    const p = writeManifest({ documents: [{ doc: 'A' }, { doc: 'B' }] });

    // 失败即停
    (globalThis as any).__mockIngest = h.makeIngest();
    (globalThis as any).__mockIngest.mockImplementationOnce(async () => {
      throw new Error('BSP 不可达');
    });
    const { batchIngest } = await import('../src/batch');
    const stopped = await batchIngest(p, {});
    expect(stopped.failed).toBe(1);
    expect(stopped.succeeded).toBe(0); // 第二条未执行
    expect(stopped.items).toHaveLength(1);

    // continue-on-error
    vi.resetModules();
    (globalThis as any).__mockIngest = h.makeIngest();
    (globalThis as any).__mockIngest.mockImplementationOnce(async () => {
      throw new Error('BSP 不可达');
    });
    const { batchIngest: batchIngest2 } = await import('../src/batch');
    const continued = await batchIngest2(p, { continueOnError: true });
    expect(continued.failed).toBe(1);
    expect(continued.succeeded).toBe(1);
    expect(continued.items).toHaveLength(2);
  });

  it('--relations 在批量后触发关系生成', async () => {
    const p = writeManifest({ documents: [{ doc: 'A' }] });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, { relations: true });
    expect(result.relations).toBeDefined();
    expect(result.relations!.created).toHaveLength(1);
  });

  it('--dry-run 不触发关系生成，也不产出分类分布报告', async () => {
    const p = writeManifest({ documents: [{ doc: 'A', domains: ['采购供应'] }] });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, { dryRun: true, relations: true });
    expect(result.dryRun).toBe(true);
    expect(result.relations).toBeUndefined();
    expect(result.succeeded).toBe(1);
    expect(result.domainReport).toBeUndefined();
    // dry-run 下不做板块覆盖
    expect((globalThis as any).__mockBsp.setSignalDomains).not.toHaveBeenCalled();
    // dryRun 必须透传给 ingest（回归：历史上 runEntry 丢过 dryRun 导致误写库）
    expect((globalThis as any).__mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      expect.anything(),
    );
  });

  it('G4：domains / primary_domain 覆盖 —— 调 POST /api/signals/:id/domains 并计入报告', async () => {
    const p = writeManifest({
      documents: [{ doc: 'A', domains: ['采购供应', '仓储运营'], primary_domain: '采购供应' }],
    });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, {});

    const bsp = (globalThis as any).__mockBsp;
    expect(bsp.setSignalDomains).toHaveBeenCalledTimes(1);
    expect(bsp.setSignalDomains).toHaveBeenCalledWith('SIG-1', {
      domains: ['采购供应', '仓储运营'],
      primary_domain: '采购供应',
    });

    // 覆盖后的板块回填进条目结果与报告
    expect(result.items[0].result!.signal.domains).toEqual(['采购供应', '仓储运营']);
    expect(result.items[0].result!.signal.primary_domain).toBe('采购供应');
    expect(result.domainReport).toBeDefined();
    expect(result.domainReport!.total_signals).toBe(1);
    expect(result.domainReport!.by_domain).toEqual({ 采购供应: 1, 仓储运营: 1 });
    expect(result.domainReport!.primary_counts).toEqual({ 采购供应: 1 });
    expect(result.domainReport!.unclassified).toHaveLength(0);
  });

  it('G4：未指定 domains 的条目不做覆盖，未归口信号进入 unclassified 清单', async () => {
    (globalThis as any).__mockIngest = vi.fn(async (opts: { doc: string }) => ({
      document: { token: opts.doc, title: 't', content: 'c' },
      object: { id: 'OBJ-1', name: 'n' },
      evidence: { id: 'EV-1' },
      fragments: [{ id: 'FRG-1', content: 'c' }],
      signal:
        opts.doc === 'A'
          ? { id: 'SIG-A', body: 'b', state: 'Captured', domains: ['仓储运营'], primary_domain: '仓储运营' }
          : { id: 'SIG-B', body: 'b', state: 'Captured', domains: [], primary_domain: null },
      skipped: [],
      dryRun: false,
    }));
    const p = writeManifest({ documents: [{ doc: 'A' }, { doc: 'B' }] });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, {});

    expect((globalThis as any).__mockBsp.setSignalDomains).not.toHaveBeenCalled();
    expect(result.domainReport!.total_signals).toBe(2);
    expect(result.domainReport!.by_domain).toEqual({ 仓储运营: 1 });
    expect(result.domainReport!.primary_counts).toEqual({ 仓储运营: 1 });
    expect(result.domainReport!.unclassified).toEqual([{ signal: 'SIG-B', label: 'B' }]);
  });

  it('G4：板块覆盖失败时条目记为失败，错误信息保留已创建信号 id', async () => {
    (globalThis as any).__mockBsp = {
      setSignalDomains: vi.fn(async () => {
        throw new Error('BSP POST /api/signals/SIG-1/domains 失败（HTTP 400）：VALIDATION_ERROR');
      }),
    };
    const p = writeManifest({ documents: [{ doc: 'A', domains: ['采购供应'] }] });
    const { batchIngest } = await import('../src/batch');
    const result = await batchIngest(p, {});

    expect(result.failed).toBe(1);
    expect(result.items[0].ok).toBe(false);
    expect(result.items[0].error).toMatch(/SIG-1 已创建/);
    expect(result.items[0].error).toMatch(/板块覆盖失败/);
  });
});

/* ---------------- buildDomainReport 纯函数 ---------------- */

describe('buildDomainReport', () => {
  it('统计 domains 分布 / 主线计数 / 未归口清单，跳过失败与 dry-run 条目', () => {
    const report = buildDomainReport([
      {
        label: 'A',
        ok: true,
        result: {
          signal: { id: 'SIG-1', body: 'b', state: 'Captured', domains: ['仓储运营', '项目推进'], primary_domain: '仓储运营' },
        } as never,
      },
      {
        label: 'B',
        ok: true,
        result: {
          signal: { id: 'SIG-2', body: 'b', state: 'Captured', domains: ['仓储运营'], primary_domain: '仓储运营' },
        } as never,
      },
      {
        label: 'C',
        ok: true,
        result: { signal: { id: 'SIG-3', body: 'b', state: 'Captured', domains: [], primary_domain: null } } as never,
      },
      { label: 'D', ok: false, error: 'x' },
      {
        label: 'E',
        ok: true,
        result: { signal: { id: '(dry-run)', body: 'b', state: 'Captured' }, dryRun: true } as never,
      },
    ]);

    expect(report.total_signals).toBe(3);
    expect(report.by_domain).toEqual({ 仓储运营: 2, 项目推进: 1 });
    expect(report.primary_counts).toEqual({ 仓储运营: 2 });
    expect(report.unclassified).toEqual([{ signal: 'SIG-3', label: 'C' }]);
  });
});
