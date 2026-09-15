/**
 * AI 解读测试（Business Graph OS — AI 解读）
 *
 * 覆盖：
 * - 上下文组装：五种 kind 的组装函数单测（含 8000 字截断 cap）
 * - 端点（真实 HTTP，ephemeral 端口；注入假 LLM）：
 *   - 未配置 → 503 AI_NOT_CONFIGURED
 *   - PUT /api/ai/config → GET /api/ai/status（key 永不回显）
 *   - POST /api/ai/interpret 五种 kind 全链路
 *   - 缓存命中（第二次调用标 cached:true 且不再调用 LLM）
 *   - POST /api/ai/interpret-view（含 lens 与 truncated 标记）
 *
 * 配置 / 缓存文件均指向 os.tmpdir() 下的临时路径（BSP_AI_CONFIG_PATH /
 * BSP_AI_CACHE_PATH 惰性解析），不触碰真实 data/ 目录。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { createApp } from '../app';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import { computeChecksum } from '../utils/checksum';
import { Evidence, Fragment, Signal, BSPObject, Relation } from '../types';
import {
  buildNodeContext,
  buildViewContext,
  CONTEXT_CAP,
  EVIDENCE_SELF_CAP,
  PEER_SIGNAL_CAP,
  VIEW_NODE_CAP,
} from '../ai/context';
import { setLLMCaller } from '../ai/llm';

// ---------------------------------------------------------------------------
// 临时路径与 HTTP 服务
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-ai-test-'));
let tmpSeq = 0;

let server: Server;
let base: string;
let llmCalls: Array<{ model: string; userLen: number }>;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setLLMCaller(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  evidenceRepository.clear();
  fragmentRepository.clear();
  signalRepository.clear();
  objectRepository.clear();
  relationRepository.clear();
  // 每个用例独立的配置 / 缓存文件，互不污染
  tmpSeq += 1;
  process.env.BSP_AI_CONFIG_PATH = path.join(tmpDir, `ai-config-${tmpSeq}.json`);
  process.env.BSP_AI_CACHE_PATH = path.join(tmpDir, `ai-cache-${tmpSeq}.json`);
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  // 假 LLM：记录调用并返回固定串
  llmCalls = [];
  setLLMCaller(async (cfg, messages) => {
    llmCalls.push({ model: cfg.model, userLen: messages[messages.length - 1].content.length });
    return '## 摘要\n这是假 LLM 的解读结果。';
  });
});

// ---------------------------------------------------------------------------
// 播种工具
// ---------------------------------------------------------------------------

function seedEvidence(id: string, content = `证据原文 ${id}`, overrides: Partial<Evidence> = {}): Evidence {
  return evidenceRepository.create({
    id,
    source: 'meeting',
    content,
    checksum: computeChecksum(content),
    state: 'Created',
    created_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  });
}

function seedFragment(id: string, evidenceId: string, overrides: Partial<Fragment> = {}): Fragment {
  const content = overrides.content ?? `片段内容 ${id}`;
  return fragmentRepository.create({
    id,
    evidence_id: evidenceId,
    type: 'Speech',
    content,
    checksum: computeChecksum(content),
    state: 'Created',
    ...overrides,
  });
}

function seedSignal(id: string, fragments: string[], anchors: string[], overrides: Partial<Signal> = {}): Signal {
  return signalRepository.create({
    id,
    type: 'observation',
    body: `信号观察 ${id}：仓库使用 Excel 盘点`,
    fragments,
    anchors,
    context: { channel: 'meeting' },
    state: 'Captured',
    captured_at: '2026-08-02T10:00:00.000Z',
    confidence: 0.9,
    domains: ['仓储运营'],
    primary_domain: '仓储运营',
    ...overrides,
  });
}

function seedObject(id: string, overrides: Partial<BSPObject> = {}): BSPObject {
  return objectRepository.create({
    id,
    type: 'Customer',
    name: `对象${id}`,
    state: 'Active',
    created_at: '2026-08-03T10:00:00.000Z',
    updated_at: '2026-08-03T10:00:00.000Z',
    ...overrides,
  });
}

function seedRelation(id: string, source: string, target: string, derivedFrom: string): Relation {
  return relationRepository.create({
    id,
    source,
    target,
    type: 'depends_on',
    derived_from: derivedFrom,
    confidence: 0.8,
    created_at: '2026-08-04T10:00:00.000Z',
  });
}

/** 播一条完整链：EV → FRG → SIG → OBJ（+ 可选 REL） */
function seedChain(tag = 'a') {
  const ev = seedEvidence(`EV-${tag}`);
  const frg = seedFragment(`FRG-${tag}`, ev.id, { start_offset: 0, end_offset: 5 });
  const obj = seedObject(`OBJ-${tag}`);
  const sig = seedSignal(`SIG-${tag}`, [frg.id], [obj.id]);
  return { ev, frg, obj, sig };
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

async function post(p: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function put(p: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${p}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(p: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, json: await res.json() };
}

async function configureAI() {
  return put('/api/ai/config', {
    base_url: 'https://fake-llm.test/v1',
    api_key: 'sk-test-secret-12345',
    model: 'fake-model-1',
  });
}

// ---------------------------------------------------------------------------
// 上下文组装单测
// ---------------------------------------------------------------------------

describe('AI 上下文组装', () => {
  it('Signal：本体 + 锚定 Object + Fragment（含偏移）+ Evidence 原文 + 同对象其他 Signal + Relation', () => {
    const { ev, frg, obj, sig } = seedChain('s1');
    const obj2 = seedObject('OBJ-s1b');
    const peer = seedSignal('SIG-s1-peer', [frg.id], [obj.id]);
    const rel = seedRelation('REL-s1', obj.id, obj2.id, sig.id);

    const ctx = buildNodeContext('Signal', sig.id);
    expect(ctx.text).toContain(sig.id);
    expect(ctx.text).toContain(sig.body);
    expect(ctx.text).toContain('仓储运营');
    expect(ctx.text).toContain(obj.id);
    expect(ctx.text).toContain(frg.id);
    expect(ctx.text).toContain('偏移 0–5');
    expect(ctx.text).toContain(ev.id);
    expect(ctx.text).toContain(ev.content);
    expect(ctx.text).toContain(peer.id); // 同对象其他信号
    expect(ctx.text).toContain(rel.id);
    expect(ctx.text).toContain(rel.derived_from);
    expect(ctx.evidence_ids).toEqual([ev.id]);
    expect(ctx.signal_ids).toEqual(expect.arrayContaining([sig.id, peer.id, sig.id]));
    expect(ctx.signal_ids).toContain(rel.derived_from);
  });

  it('Evidence：原文（≤3000 字截断）+ Fragment 清单 + 关联 Signal 摘要', () => {
    const longContent = '长'.repeat(5000);
    const ev = seedEvidence('EV-e1', longContent);
    const frg = seedFragment('FRG-e1', ev.id, { content: '长长长' });
    const obj = seedObject('OBJ-e1');
    const sig = seedSignal('SIG-e1', [frg.id], [obj.id]);

    const ctx = buildNodeContext('Evidence', ev.id);
    expect(ctx.text).toContain(ev.id);
    expect(ctx.text).toContain(frg.id);
    expect(ctx.text).toContain(sig.id);
    expect(ctx.text).toContain('（截断）');
    // 原文段不超过自截断上限（含标记与格式开销留余量）
    expect(ctx.text.length).toBeLessThan(EVIDENCE_SELF_CAP + 800);
    expect(ctx.evidence_ids).toEqual([ev.id]);
    expect(ctx.signal_ids).toEqual([sig.id]);
  });

  it('Fragment：内容 + 所属 Evidence 原文 + 关联 Signal', () => {
    const { ev, frg, sig } = seedChain('f1');
    const ctx = buildNodeContext('Fragment', frg.id);
    expect(ctx.text).toContain(frg.id);
    expect(ctx.text).toContain(frg.content);
    expect(ctx.text).toContain(ev.id);
    expect(ctx.text).toContain(ev.content);
    expect(ctx.text).toContain(sig.id);
    expect(ctx.evidence_ids).toEqual([ev.id]);
    expect(ctx.signal_ids).toEqual([sig.id]);
  });

  it('Object：属性 + 全部锚定 Signal 摘要 + Relation', () => {
    const { obj, sig } = seedChain('o1');
    const obj2 = seedObject('OBJ-o1b');
    const rel = seedRelation('REL-o1', obj.id, obj2.id, sig.id);

    const ctx = buildNodeContext('Object', obj.id);
    expect(ctx.text).toContain(obj.id);
    expect(ctx.text).toContain(obj.name);
    expect(ctx.text).toContain(sig.id);
    expect(ctx.text).toContain(sig.body);
    expect(ctx.text).toContain(rel.id);
    expect(ctx.text).toContain('depends_on');
    expect(ctx.signal_ids).toEqual(expect.arrayContaining([sig.id]));
  });

  it('Relation：两端 Object 摘要 + derived_from Signal', () => {
    const { obj, sig } = seedChain('r1');
    const obj2 = seedObject('OBJ-r1b');
    const rel = seedRelation('REL-r1', obj.id, obj2.id, sig.id);

    const ctx = buildNodeContext('Relation', rel.id);
    expect(ctx.text).toContain(rel.id);
    expect(ctx.text).toContain(obj.id);
    expect(ctx.text).toContain(obj2.id);
    expect(ctx.text).toContain(sig.id);
    expect(ctx.signal_ids).toEqual([sig.id]);
  });

  it('未知 kind / 不存在 id 抛错', () => {
    expect(() => buildNodeContext('Nope', 'x')).toThrow();
    expect(() => buildNodeContext('Signal', 'SIG-absent')).toThrow();
  });

  it('截断 cap：超长上下文总量不超过 8000 字上限，且必保段（Signal 本体）仍在', () => {
    const { frg, obj, sig } = seedChain('cap');
    // 同对象其他信号：20 条 × 600 字 body，足以把总量推过 cap
    for (let i = 0; i < 20; i++) {
      seedSignal(`SIG-cap-peer-${i}`, [frg.id], [obj.id], { body: `同伴信号${i}：${'料'.repeat(600)}` });
    }
    // 大 Evidence 原文
    seedEvidence('EV-cap-big', '证'.repeat(9000));
    const frg2 = seedFragment('FRG-cap-big', 'EV-cap-big', { content: '证证' });
    seedSignal('SIG-cap-big', [frg2.id], [obj.id], { body: '大证据信号' });

    const ctx = buildNodeContext('Signal', sig.id);
    expect(ctx.text.length).toBeLessThanOrEqual(CONTEXT_CAP + 40); // 含截断标记余量
    expect(ctx.text).toContain(sig.body); // priority 0 必保
    // 同对象其他信号段被优先丢弃（peer cap 生效 + 低优先段裁剪）
    const peerCount = (ctx.text.match(/SIG-cap-peer-/g) || []).length;
    expect(peerCount).toBeLessThanOrEqual(PEER_SIGNAL_CAP);
  });

  it('视图 digest：计数 / 板块分布 / 状态分布 / 清单 + lens 注入', () => {
    const a = seedChain('v1');
    const b = seedChain('v2');
    const rel = seedRelation('REL-v1', a.obj.id, b.obj.id, a.sig.id);

    const ctx = buildViewContext(
      [a.ev.id, a.frg.id, a.sig.id, a.obj.id, b.sig.id, b.obj.id, rel.id],
      { domain: '仓储运营', time_window: [Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31)] },
    );
    expect(ctx.text).toContain('视图概况');
    expect(ctx.text).toContain('Signal ×2');
    expect(ctx.text).toContain('板块分布：仓储运营');
    expect(ctx.text).toContain('状态分布');
    expect(ctx.text).toContain('当前视角板块过滤：仓储运营');
    expect(ctx.text).toContain('当前视角时间窗');
    expect(ctx.text).toContain(a.sig.id);
    expect(ctx.text).toContain(rel.id);
    expect(ctx.node_count).toBe(7);
    expect(ctx.truncated).toBeUndefined();
  });

  it('视图 digest：node_ids 超 150 按 Signal>Object>… 优先级截断并标 truncated', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push(seedObject(`OBJ-t-${i}`).id);
    for (let i = 0; i < 80; i++) ids.push(seedEvidence(`EV-t-${i}`).id);
    const { sig } = seedChain('t');
    ids.push(sig.id);

    const ctx = buildViewContext(ids);
    expect(ctx.truncated).toBe(true);
    expect(ctx.node_count).toBe(VIEW_NODE_CAP);
    expect(ctx.text).toContain('截断');
    expect(ctx.signal_ids).toEqual([sig.id]); // Signal 最优先保留
  });

  it('视图 digest：空 node_ids 抛校验错', () => {
    expect(() => buildViewContext([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 端点测试（假 LLM 全链路）
// ---------------------------------------------------------------------------

describe('AI 解读端点', () => {
  it('GET /api/ai/status 未配置 → configured:false 且不含 key', async () => {
    const { status, json } = await get('/api/ai/status');
    expect(status).toBe(200);
    expect(json.configured).toBe(false);
    expect(json.base_url).toBe('https://api.openai.com/v1');
    expect(json.model).toBe('gpt-4o-mini');
    expect(JSON.stringify(json)).not.toContain('api_key');
  });

  it('POST /api/ai/interpret 未配置 → 503 友好错误，不调用 LLM', async () => {
    const { sig } = seedChain('nc');
    const { status, json } = await post('/api/ai/interpret', { kind: 'Signal', id: sig.id });
    expect(status).toBe(503);
    expect(json.error.code).toBe('AI_NOT_CONFIGURED');
    expect(json.error.message).toContain('未配置');
    expect(llmCalls.length).toBe(0);
  });

  it('PUT /api/ai/config → 返回 status 同款且 key 不回显；GET status 同步', async () => {
    const bad = await put('/api/ai/config', { base_url: '   ' });
    expect(bad.status).toBe(422);

    const badUrl = await put('/api/ai/config', { base_url: 'ftp://x' });
    expect(badUrl.status).toBe(422);

    const { status, json } = await configureAI();
    expect(status).toBe(200);
    expect(json).toEqual({
      configured: true,
      base_url: 'https://fake-llm.test/v1',
      model: 'fake-model-1',
    });
    expect(JSON.stringify(json)).not.toContain('sk-test-secret-12345');
    expect(JSON.stringify(json)).not.toContain('api_key');

    const st = await get('/api/ai/status');
    expect(st.json.configured).toBe(true);
    expect(JSON.stringify(st.json)).not.toContain('sk-test-secret-12345');
  });

  it('POST /api/ai/interpret 五种 kind 全链路 + 响应结构', async () => {
    await configureAI();
    const { ev, frg, obj, sig } = seedChain('e2e');
    const obj2 = seedObject('OBJ-e2eb');
    const rel = seedRelation('REL-e2e', obj.id, obj2.id, sig.id);

    for (const [kind, id] of [
      ['Signal', sig.id],
      ['Evidence', ev.id],
      ['Fragment', frg.id],
      ['Object', obj.id],
      ['Relation', rel.id],
    ] as const) {
      const { status, json } = await post('/api/ai/interpret', { kind, id });
      expect(status).toBe(200);
      expect(json.interpretation).toContain('假 LLM');
      expect(json.model).toBe('fake-model-1');
      expect(json.context.node_count).toBeGreaterThan(0);
      expect(Array.isArray(json.context.evidence_ids)).toBe(true);
      expect(Array.isArray(json.context.signal_ids)).toBe(true);
    }
    expect(llmCalls.length).toBe(5);
  });

  it('缓存命中：同一节点第二次解读标 cached:true 且不再调用 LLM；数据变化后重新调用', async () => {
    await configureAI();
    const { obj, sig } = seedChain('cache');

    const first = await post('/api/ai/interpret', { kind: 'Signal', id: sig.id });
    expect(first.json.cached).toBeUndefined();
    const second = await post('/api/ai/interpret', { kind: 'Signal', id: sig.id });
    expect(second.json.cached).toBe(true);
    expect(second.json.interpretation).toBe(first.json.interpretation);
    expect(llmCalls.length).toBe(1);

    // 上下文指纹变化（锚定新信号到同对象）→ 缓存失效
    seedSignal('SIG-cache-new', [sig.fragments[0]], [obj.id]);
    const third = await post('/api/ai/interpret', { kind: 'Signal', id: sig.id });
    expect(third.json.cached).toBeUndefined();
    expect(llmCalls.length).toBe(2);
  });

  it('POST /api/ai/interpret 节点不存在 → 404；kind 非法 → 422', async () => {
    await configureAI();
    const nf = await post('/api/ai/interpret', { kind: 'Signal', id: 'SIG-absent' });
    expect(nf.status).toBe(404);
    const bad = await post('/api/ai/interpret', { kind: 'Nope', id: 'x' });
    expect(bad.status).toBe(422);
    const missing = await post('/api/ai/interpret', {});
    expect(missing.status).toBe(422);
  });

  it('POST /api/ai/interpret-view 全链路：lens + digest + 缓存', async () => {
    await configureAI();
    const a = seedChain('vw');
    const rel = seedRelation('REL-vw', a.obj.id, seedObject('OBJ-vwb').id, a.sig.id);
    const nodeIds = [a.ev.id, a.frg.id, a.sig.id, a.obj.id, rel.id];

    const { status, json } = await post('/api/ai/interpret-view', {
      node_ids: nodeIds,
      lens: { domain: '仓储运营', time_window: [Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31)] },
    });
    expect(status).toBe(200);
    expect(json.interpretation).toContain('假 LLM');
    expect(json.context.node_count).toBe(5);
    expect(json.context.signal_ids).toEqual([a.sig.id]);
    expect(json.context.evidence_ids).toEqual([a.ev.id]);
    expect(json.truncated).toBeUndefined();
    expect(llmCalls[0].userLen).toBeGreaterThan(0);

    // 缓存命中
    const again = await post('/api/ai/interpret-view', {
      node_ids: nodeIds,
      lens: { domain: '仓储运营', time_window: [Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31)] },
    });
    expect(again.json.cached).toBe(true);
    expect(llmCalls.length).toBe(1);

    // lens 变化 → 不同缓存 key
    const other = await post('/api/ai/interpret-view', { node_ids: nodeIds, lens: { domain: null } });
    expect(other.json.cached).toBeUndefined();
    expect(llmCalls.length).toBe(2);
  });

  it('POST /api/ai/interpret-view：node_ids > 150 → truncated:true 且按优先级保留', async () => {
    await configureAI();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(seedObject(`OBJ-vt-${i}`).id);
    for (let i = 0; i < 60; i++) ids.push(seedEvidence(`EV-vt-${i}`).id);

    const { status, json } = await post('/api/ai/interpret-view', { node_ids: ids });
    expect(status).toBe(200);
    expect(json.truncated).toBe(true);
    expect(json.context.node_count).toBe(VIEW_NODE_CAP);
    // 120 个 Object 全保留 + 30 个 Evidence
    expect(json.context.evidence_ids.length).toBe(VIEW_NODE_CAP - 120);

    const bad = await post('/api/ai/interpret-view', { node_ids: [] });
    expect(bad.status).toBe(422);
  });

  it('POST /api/ai/interpret-view 未配置 → 503', async () => {
    const { sig } = seedChain('vnc');
    const { status, json } = await post('/api/ai/interpret-view', { node_ids: [sig.id] });
    expect(status).toBe(503);
    expect(json.error.code).toBe('AI_NOT_CONFIGURED');
  });
});
