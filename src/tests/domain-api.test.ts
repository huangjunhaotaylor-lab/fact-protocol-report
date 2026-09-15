/**
 * 业务板块 API 测试（G0 批次）
 *
 * 通过真实 HTTP 服务（ephemeral 端口）覆盖：
 * - POST /api/signals 创建时自动分类并传导到 Object
 * - GET /api/domains 板块字典 + 计数
 * - POST /api/signals/:id/domains 人工纠正（覆盖 + domain_manual + Object 重算）
 * - POST /api/admin/reclassify 存量回填（跳过人工纠正、幂等、distribution）
 * - GET /api/graph?domain= 板块过滤（Signal/Object/Fragment/Evidence/Relation 语义）
 * - GET /api/graph/search?q=信号 板块 X 板块短语
 * - GET /api/graph/stats domain_counts 与 domain 过滤
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../app';
import {
  evidenceRepository,
  fragmentRepository,
  signalRepository,
  objectRepository,
  relationRepository,
} from '../repositories';
import { relationService } from '../services/relation.service';
import { AddressInfo } from 'net';
import { Server } from 'http';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  evidenceRepository.clear();
  fragmentRepository.clear();
  signalRepository.clear();
  objectRepository.clear();
  relationRepository.clear();
});

// ---------------------------------------------------------------------------
// HTTP 播种工具
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: await res.json() };
}

/** 播一条完整链路：Evidence → Fragment → Signal(锚定 Object)，返回各 ID 与创建结果 */
async function seedChain(body: string, objectName = '测试对象') {
  const ev = await post('/api/evidences', { source: 'meeting', content: `原始记录：${body}` });
  const frg = await post('/api/fragments', {
    evidence_id: ev.json.id,
    type: 'Speech',
    content: body,
  });
  const obj = await post('/api/objects', { type: 'Customer', name: objectName });
  const sig = await post('/api/signals', {
    type: 'observation',
    body,
    fragments: [frg.json.id],
    anchors: [obj.json.id],
    context: { channel: 'meeting' },
    confidence: 0.9,
  });
  return { ev: ev.json, frg: frg.json, obj: obj.json, sig: sig.json };
}

// ---------------------------------------------------------------------------
// Signal 创建自动分类 + Object 传导
// ---------------------------------------------------------------------------

describe('Signal 创建自动分类', () => {
  it('创建时对 body 分类，三字段随信号持久化，Object 同步传导', async () => {
    const { sig, obj } = await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异');

    expect(sig.domains).toContain('仓储运营');
    expect(sig.primary_domain).toBe('仓储运营');
    expect(sig.domain_scores['仓储运营']).toBeGreaterThan(0);
    expect(sig.domain_manual).toBeUndefined();

    // Object 传导：并集 + primary
    const objNow = objectRepository.findById(obj.id)!;
    expect(objNow.domains).toContain('仓储运营');
    expect(objNow.primary_domain).toBe('仓储运营');
  });

  it('无命中文本：domains 为空、primary 为 null，Object 不产生板块', async () => {
    const { sig, obj } = await seedChain('今天下午大家一起去楼下走了走');
    expect(sig.domains).toEqual([]);
    expect(sig.primary_domain).toBeNull();

    const objNow = objectRepository.findById(obj.id)!;
    expect(objNow.domains).toEqual([]);
    expect(objNow.primary_domain).toBeNull();
  });

  it('同一 Object 多条信号：传导取并集，primary 计票最高', async () => {
    const first = await seedChain('仓库盘点流程沿用纸质单据', '华东仓');
    await post('/api/signals', {
      type: 'observation',
      body: '盘点系统模块已上线灰度版本',
      fragments: [first.frg.id],
      anchors: [first.obj.id],
      context: {},
      confidence: 0.8,
    });

    const objNow = objectRepository.findById(first.obj.id)!;
    expect(objNow.domains).toContain('仓储运营');
    expect(objNow.domains).toContain('系统与工具');
  });
});

// ---------------------------------------------------------------------------
// GET /api/domains
// ---------------------------------------------------------------------------

describe('GET /api/domains', () => {
  it('返回 7 个内置板块（带关键词）+ 计数 + unclassified_signals', async () => {
    await seedChain('恒晟电子 3 月订单交付日期调整'); // 销售与交付
    await seedChain('今天下午大家一起去楼下走了走'); // 未分类

    const { status, json } = await get('/api/domains');
    expect(status).toBe(200);

    const names = json.domains.map((d: any) => d.name);
    for (const builtin of ['仓储运营', '销售与交付', '项目推进', '采购供应', '财务', '人力', '系统与工具']) {
      expect(names).toContain(builtin);
    }

    const sales = json.domains.find((d: any) => d.name === '销售与交付');
    expect(sales.keywords).toContain('订单');
    expect(sales.signal_count).toBe(1);
    expect(sales.object_count).toBe(1);

    expect(json.unclassified_signals).toBe(1);
  });

  it('数据里出现的字典外板块名也会列出（keywords 为空）', async () => {
    const { sig } = await seedChain('仓库盘点流程沿用纸质单据');
    await post(`/api/signals/${sig.id}/domains`, {
      domains: ['自定义板块X'],
      primary_domain: '自定义板块X',
    });

    const { json } = await get('/api/domains');
    const custom = json.domains.find((d: any) => d.name === '自定义板块X');
    expect(custom).toBeDefined();
    expect(custom.keywords).toEqual([]);
    expect(custom.signal_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 人工纠正
// ---------------------------------------------------------------------------

describe('POST /api/signals/:id/domains 人工纠正', () => {
  it('覆盖板块字段、记录 domain_manual、重算 Object 传导', async () => {
    const { sig, obj } = await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异');

    const { status, json } = await post(`/api/signals/${sig.id}/domains`, {
      domains: ['人力', '财务'],
      primary_domain: '人力',
    });
    expect(status).toBe(200);
    expect(json.domains).toEqual(['人力', '财务']);
    expect(json.primary_domain).toBe('人力');
    expect(json.domain_manual).toBe(true);
    expect(json.domain_scores).toEqual({});

    // Object 传导同步更新为纠正后的板块（并集输出按字典序排序）
    const objNow = objectRepository.findById(obj.id)!;
    expect(objNow.domains).toEqual(['财务', '人力']);
    expect(objNow.primary_domain).toBe('人力');
  });

  it('未传 primary_domain 时默认取 domains[0]', async () => {
    const { sig } = await seedChain('仓库盘点流程沿用纸质单据');
    const { json } = await post(`/api/signals/${sig.id}/domains`, { domains: ['项目推进'] });
    expect(json.primary_domain).toBe('项目推进');
  });

  it('primary_domain 不在 domains 内 → 422；信号不存在 → 404', async () => {
    const { sig } = await seedChain('仓库盘点流程沿用纸质单据');
    const bad = await post(`/api/signals/${sig.id}/domains`, {
      domains: ['财务'],
      primary_domain: '人力',
    });
    expect(bad.status).toBe(422); // ValidationError（项目既有约定）

    const notFound = await post('/api/signals/SIG-NOPE/domains', { domains: ['财务'] });
    expect(notFound.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 存量回填
// ---------------------------------------------------------------------------

describe('POST /api/admin/reclassify 存量回填', () => {
  it('跳过人工纠正信号、重算全部 Object 传导、幂等', async () => {
    const auto = await seedChain('恒晟电子 3 月订单交付日期调整');
    const manual = await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异');

    // 人工纠正第二条为「人力」
    await post(`/api/signals/${manual.sig.id}/domains`, { domains: ['人力'] });

    // 清空第一条的板块字段，模拟历史存量数据
    signalRepository.update(auto.sig.id, { domains: [], primary_domain: null, domain_scores: {} });
    objectRepository.update(auto.obj.id, { domains: [], primary_domain: null });

    const r1 = await post('/api/admin/reclassify', {});
    expect(r1.status).toBe(200);
    expect(r1.json.reclassified).toBe(1); // 只有自动那条被重跑
    expect(r1.json.skipped_manual).toBe(1);
    expect(r1.json.distribution['销售与交付']).toBe(1);
    expect(r1.json.distribution['人力']).toBe(1);

    // 自动信号被回填；人工信号保持「人力」不变
    const autoNow = signalRepository.findById(auto.sig.id)!;
    expect(autoNow.primary_domain).toBe('销售与交付');
    const manualNow = signalRepository.findById(manual.sig.id)!;
    expect(manualNow.domains).toEqual(['人力']);
    expect(manualNow.domain_manual).toBe(true);

    // Object 传导已重算
    const autoObj = objectRepository.findById(auto.obj.id)!;
    expect(autoObj.domains).toContain('销售与交付');

    // 幂等：再跑一遍结果一致
    const r2 = await post('/api/admin/reclassify', {});
    expect(r2.json).toEqual(r1.json);
  });
});

// ---------------------------------------------------------------------------
// graph domain 过滤 / search 板块短语 / stats
// ---------------------------------------------------------------------------

describe('graph 板块能力', () => {
  it('GET /api/graph?domain= 过滤：Signal/Object 按自身板块，Fragment/Evidence 跟随 Signal，Relation 两端都在才保留', async () => {
    const a = await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异', '华东仓');
    const b = await seedChain('恒晟电子 3 月订单交付日期调整', '恒晟电子');
    // a、b 两个 Object 之间建关系（派生自 a 的信号）
    relationService.create({
      source: a.obj.id,
      target: b.obj.id,
      type: 'depends_on',
      derived_from: a.sig.id,
      confidence: 0.8,
    });

    const { json } = await get(`/api/graph?domain=${encodeURIComponent('仓储运营')}`);
    const ids = json.nodes.map((n: any) => n.id);

    // 保留：a 链全部节点
    expect(ids).toContain(a.sig.id);
    expect(ids).toContain(a.frg.id);
    expect(ids).toContain(a.ev.id);
    expect(ids).toContain(a.obj.id);
    // 排除：b 链（销售与交付）
    expect(ids).not.toContain(b.sig.id);
    expect(ids).not.toContain(b.obj.id);
    // Relation：两端 Object 不都在 → 被滤掉
    const relIds = json.nodes.filter((n: any) => n.kind === 'Relation').map((n: any) => n.id);
    expect(relIds).toHaveLength(0);

    // 节点投影带板块字段
    const sigNode = json.nodes.find((n: any) => n.id === a.sig.id);
    expect(sigNode.domains).toContain('仓储运营');
    expect(sigNode.primary_domain).toBe('仓储运营');

    // 两个 Object 都属于该板块时 Relation 才保留：把 b 的信号也改成仓储运营
    await post(`/api/signals/${b.sig.id}/domains`, { domains: ['仓储运营'] });
    const again = await get(`/api/graph?domain=${encodeURIComponent('仓储运营')}`);
    const relNodes = again.json.nodes.filter((n: any) => n.kind === 'Relation');
    expect(relNodes).toHaveLength(1);
  });

  it('expand 节点带 domains/primary_domain 字段', async () => {
    const a = await seedChain('仓库盘点流程沿用纸质单据', '华东仓');
    const { json } = await get(`/api/graph/expand/Signal/${a.sig.id}`);
    expect(json.node.domains).toContain('仓储运营');
    expect(json.node.primary_domain).toBe('仓储运营');
  });

  it('GET /api/graph/search 板块短语：信号 板块 仓储运营', async () => {
    const a = await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异');
    const b = await seedChain('恒晟电子 3 月订单交付日期调整');

    const { json } = await get(
      `/api/graph/search?q=${encodeURIComponent('信号 板块 仓储运营')}`,
    );
    const ids = json.nodes.map((n: any) => n.id);
    expect(ids).toContain(a.sig.id);
    expect(ids).not.toContain(b.sig.id);
    expect(json.total).toBe(1);

    // Object 也可用板块短语
    const objRes = await get(
      `/api/graph/search?q=${encodeURIComponent('对象 板块 销售与交付')}`,
    );
    expect(objRes.json.nodes.map((n: any) => n.id)).toContain(b.obj.id);
  });

  it('GET /api/graph/stats 输出 domain_counts；domain 参数过滤', async () => {
    await seedChain('华南仓 A 区实际库存与 WMS 账面存在 36 件差异');
    await seedChain('恒晟电子 3 月订单交付日期调整');

    const all = await get('/api/graph/stats');
    expect(all.json.domain_counts['仓储运营']).toBeGreaterThan(0);
    expect(all.json.domain_counts['销售与交付']).toBeGreaterThan(0);

    const filtered = await get(`/api/graph/stats?domain=${encodeURIComponent('仓储运营')}`);
    expect(filtered.json.domain_counts['仓储运营']).toBeGreaterThan(0);
    // 过滤后只剩仓储运营相关节点
    expect(filtered.json.domain_counts['销售与交付']).toBeUndefined();
    expect(filtered.json.kind_counts.Signal).toBe(1);
  });
});
