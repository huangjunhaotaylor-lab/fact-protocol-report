/**
 * feishu-bsp-bridge 单元测试
 *
 * 覆盖：
 * - splitContent 切分逻辑（原文子串保证、最短长度过滤）
 * - ingestDocument 编排逻辑（mock lark-cli 读取与 BSP 客户端）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitContent } from '../src/ingest';

/* ---------------- splitContent ---------------- */

describe('splitContent', () => {
  it('按行与句读符号切分，片段均为原文连续子串', () => {
    const content = '张三说：仓库目前使用 Excel 进行盘点。\n李四说：华南仓库存 12,480 件。';
    const pieces = splitContent(content, 4);
    expect(pieces).toHaveLength(2);
    for (const p of pieces) {
      expect(content.includes(p)).toBe(true);
    }
    expect(pieces[0]).toBe('张三说：仓库目前使用 Excel 进行盘点。');
  });

  it('短片段被过滤（minLen）', () => {
    const pieces = splitContent('首页\n仓库。', 4);
    expect(pieces).toEqual([]);
  });

  it('长句按句号切分并保留分隔符', () => {
    const pieces = splitContent('A 区库存 12,480 件。B 区库存 8,000 件。', 4);
    expect(pieces).toEqual(['A 区库存 12,480 件。', 'B 区库存 8,000 件。']);
  });

  it('空行与空白被忽略', () => {
    expect(splitContent('\n\n   \n有内容的一段文字。\n', 4)).toEqual(['有内容的一段文字。']);
  });
});

/* ---------------- ingestDocument ---------------- */

// vi.hoisted：供顶层 vi.mock 工厂引用的共享状态与构造器（避免 TDZ 与闭包提升问题）
const h = vi.hoisted(() => {
  const FAKE_DOC = {
    token: 'doc-test-001',
    title: '测试会议纪要',
    content: '张三说：仓库目前使用 Excel 进行盘点。\n李四说：华南仓 A 区库存 12,480 件。',
    url: 'https://my.feishu.cn/docx/doc-test-001',
  };

  const makeBsp = () => {
    const calls: any[] = [];
    const client = {
      listObjects: vi.fn(async () => []),
      createObject: vi.fn(async (input: any) => {
        calls.push(['createObject', input]);
        return { id: 'OBJ-1', name: input.name, type: input.type };
      }),
      createEvidence: vi.fn(async (input: any) => {
        calls.push(['createEvidence', input]);
        return { id: 'EV-1' };
      }),
      getEvidence: vi.fn(async (id: string) => {
        calls.push(['getEvidence', id]);
        return { id, content: '张三说：仓库目前使用 Excel 进行盘点。', source: 'feishu' };
      }),
      createFragment: vi.fn(async (input: any) => {
        calls.push(['createFragment', input]);
        return { id: `FRG-${calls.filter((c) => c[0] === 'createFragment').length}`, evidence_id: input.evidence_id };
      }),
      listFragmentsByEvidence: vi.fn(async (evidenceId: string) => {
        calls.push(['listFragmentsByEvidence', evidenceId]);
        return [
          { id: 'FRG-X1', content: '张三说：仓库目前使用 Excel 进行盘点。' },
          { id: 'FRG-X2', content: '李四说：华南仓 A 区库存 12,480 件。' },
        ];
      }),
      createSignal: vi.fn(async (input: any) => {
        calls.push(['createSignal', input]);
        return { id: 'SIG-1', body: input.body, state: 'Captured' };
      }),
      traceSignal: vi.fn(async () => ({ signal: {}, fragments: [], evidences: [], chain: [] })),
    };
    return { client, calls };
  };

  return { FAKE_DOC, makeBsp };
});

// 顶层 mock：工厂只读取 globalThis 状态（vi.mock 提升安全）
vi.mock('../src/feishu', () => ({
  readDocument: vi.fn(async () => (globalThis as any).__fakeDoc),
  checkAuth: vi.fn(async () => ({ ok: true, detail: 'ok' })),
}));

vi.mock('../src/bsp', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/bsp')>();
  return {
    ...orig,
    bspBase: () => 'http://localhost:3000',
    createBspClient: () => (globalThis as any).__bspClient,
  };
});

/** 每个用例前重置模块并注入新状态 */
function freshState(configure?: (client: any) => void) {
  vi.resetModules();
  (globalThis as any).__fakeDoc = h.FAKE_DOC;
  const { client, calls } = h.makeBsp();
  configure?.(client);
  (globalThis as any).__bspClient = client;
  (globalThis as any).__bspCalls = calls;
}

function lastCalls(): any[] {
  return (globalThis as any).__bspCalls as any[];
}

describe('ingestDocument', () => {
  beforeEach(() => {
    freshState();
  });

  it('完整链路：Evidence(source=feishu) → Fragment ×2 → Signal 锚定 Object', async () => {
    const { ingestDocument } = await import('../src/ingest');
    const result = await ingestDocument({
      doc: 'doc-test-001',
      objectName: '仓库盘点流程',
      signalBody: '仓库目前使用 Excel 进行盘点。',
    });

    const calls = lastCalls();

    // Object：按名称创建（不存在时）
    expect(calls[0][0]).toBe('createObject');
    expect(calls[0][1]).toMatchObject({ type: 'Document', name: '仓库盘点流程' });

    // Evidence：原文保存 + feishu 来源 + token 溯源
    const evCall = calls.find((c) => c[0] === 'createEvidence');
    expect(evCall[1]).toMatchObject({
      source: 'feishu',
      source_id: 'doc-test-001',
      content: h.FAKE_DOC.content,
    });
    expect(evCall[1].metadata.feishu_token).toBe('doc-test-001');

    // Fragment：2 个，逐字来自原文
    const fragCalls = calls.filter((c) => c[0] === 'createFragment');
    expect(fragCalls).toHaveLength(2);
    for (const [, input] of fragCalls) {
      expect(h.FAKE_DOC.content.includes(input.content)).toBe(true);
    }

    // Signal：锚定 OBJ-1，引用全部 Fragment，body 为指定值
    const sigCall = calls.find((c) => c[0] === 'createSignal');
    expect(sigCall[1]).toMatchObject({
      anchors: ['OBJ-1'],
      fragments: ['FRG-1', 'FRG-2'],
      body: '仓库目前使用 Excel 进行盘点。',
      context: { channel: 'feishu', source: 'feishu' },
    });

    expect(result.evidence.id).toBe('EV-1');
    expect(result.signal.state).toBe('Captured');
    expect(result.skipped).toEqual([]);
  });

  it('Object 已存在时直接复用，不重复创建', async () => {
    freshState((client) => {
      client.listObjects.mockImplementation(async () => [
        { id: 'OBJ-EXIST', name: '仓库盘点流程', type: 'Process', state: 'Active' },
      ]);
    });

    const { ingestDocument } = await import('../src/ingest');
    await ingestDocument({ doc: 'doc-test-001', objectName: '仓库盘点流程' });

    const calls = lastCalls();
    expect(calls.some((c) => c[0] === 'createObject')).toBe(false);
    const sigCall = calls.find((c) => c[0] === 'createSignal');
    expect(sigCall[1].anchors).toEqual(['OBJ-EXIST']);
  });

  it('dry-run 不调用 BSP 写接口', async () => {
    const { ingestDocument } = await import('../src/ingest');
    const result = await ingestDocument({ doc: 'doc-test-001', dryRun: true });

    const calls = lastCalls();
    expect(calls.filter((c) => c[0] !== 'listObjects')).toHaveLength(0);
    expect(result.dryRun).toBe(true);
    expect(result.signal.id).toBe('(dry-run)');
  });

  it('Signal body 含判断词时 BSP 拒绝，错误向上传播', async () => {
    freshState((client) => {
      client.createSignal.mockImplementation(async () => {
        throw new Error(
          'BSP POST /api/signals 失败（HTTP 422）：Signal body validation failed: ... Forbidden expressions detected: 建议 (AC-008)',
        );
      });
    });

    const { ingestDocument } = await import('../src/ingest');
    await expect(
      ingestDocument({ doc: 'doc-test-001', signalBody: '建议上线新系统。' }),
    ).rejects.toThrow(/AC-008/);
  });

  it('ingest --anchors 支持多对象锚定', async () => {
    const { ingestDocument } = await import('../src/ingest');
    await ingestDocument({
      doc: 'doc-test-001',
      anchors: ['OBJ-A', 'OBJ-B'],
      signalBody: '仓库目前使用 Excel 进行盘点。',
    });

    const calls = lastCalls();
    // 指定 anchors 时不再创建 Object
    expect(calls.some((c) => c[0] === 'createObject')).toBe(false);
    const sigCall = calls.find((c) => c[0] === 'createSignal');
    expect(sigCall[1].anchors).toEqual(['OBJ-A', 'OBJ-B']);
  });
});

/* ---------------- attachSignal ---------------- */

describe('attachSignal', () => {
  beforeEach(() => {
    freshState();
  });

  it('复用已有 Evidence 的 Fragment，锚定指定 Object', async () => {
    const { attachSignal } = await import('../src/ingest');
    const result = await attachSignal({
      evidenceId: 'EV-99',
      body: '恒晟交付项目计划于 3 月 20 日完成首批发货。',
      anchors: ['OBJ-DELIVERY'],
      type: 'event',
    });

    const calls = lastCalls();
    const evCall = calls.find((c) => c[0] === 'getEvidence');
    expect(evCall).toBeTruthy();

    const fragCall = calls.find((c) => c[0] === 'listFragmentsByEvidence');
    expect(fragCall[1]).toBe('EV-99');

    const sigCall = calls.find((c) => c[0] === 'createSignal');
    expect(sigCall[1]).toMatchObject({
      body: '恒晟交付项目计划于 3 月 20 日完成首批发货。',
      anchors: ['OBJ-DELIVERY'],
      type: 'event',
      fragments: ['FRG-X1', 'FRG-X2'],
    });

    expect(result.evidence.id).toBe('EV-99');
    expect(result.anchors).toEqual(['OBJ-DELIVERY']);
  });

  it('--object-name 时查找或创建 Object 作为锚点', async () => {
    const { attachSignal } = await import('../src/ingest');
    await attachSignal({
      evidenceId: 'EV-99',
      body: '恒晟交付项目计划于 3 月 20 日完成首批发货。',
      objectName: '恒晟交付项目',
    });

    const calls = lastCalls();
    expect(calls.some((c) => c[0] === 'createObject')).toBe(true);
    const sigCall = calls.find((c) => c[0] === 'createSignal');
    expect(sigCall[1].anchors).toEqual(['OBJ-1']);
  });

  it('既无 anchors 也无 objectName 时拒绝', async () => {
    const { attachSignal } = await import('../src/ingest');
    await expect(
      attachSignal({ evidenceId: 'EV-99', body: '恒晟交付项目计划于 3 月 20 日完成首批发货。' }),
    ).rejects.toThrow(/anchors|object-name/);
  });
});
