/**
 * 板块字典持久化 + 关键词管理 + 分类预览 API 测试（G3 批次）
 *
 * 覆盖：
 * - dictionary-store：初始化落盘 / 持久化读写 / 损坏回退内置 / 入参校验
 * - GET  /api/domains/:name/keywords — 读取板块关键词（字典外板块空数组）
 * - PUT  /api/domains/:name/keywords — 整体替换（校验非空字符串数组，分类器立即生效）
 * - POST /api/classify-preview — 实时预览（不落库，body 必须字符串）
 *
 * 隔离约定：测试通过 BSP_DOMAIN_DICTIONARY_PATH 指向临时文件 +
 * invalidateDictionaryCache() 复位，不触碰真实 data/domain-dictionary.json。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createApp } from '../app';
import {
  signalRepository,
  objectRepository,
  evidenceRepository,
  fragmentRepository,
  relationRepository,
} from '../repositories';
import { DOMAIN_DICTIONARY } from '../domain/dictionary';
import { classifyDomains } from '../domain/classifier';
import {
  loadDictionary,
  setDomainKeywords,
  invalidateDictionaryCache,
} from '../domain/dictionary-store';
import { AddressInfo } from 'net';
import { Server } from 'http';

let server: Server;
let base: string;
let tmpDir: string;
let dictFile: string;

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

  // 每个用例一份全新临时字典文件（不存在 → 触发初始化路径）
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-dict-'));
  dictFile = path.join(tmpDir, 'domain-dictionary.json');
  process.env.BSP_DOMAIN_DICTIONARY_PATH = dictFile;
  invalidateDictionaryCache();
});

afterEach(() => {
  delete process.env.BSP_DOMAIN_DICTIONARY_PATH;
  invalidateDictionaryCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const get = (p: string) => req('GET', p);
const post = (p: string, b: unknown) => req('POST', p, b);
const put = (p: string, b: unknown) => req('PUT', p, b);

// ---------------------------------------------------------------------------
// dictionary-store 持久化行为
// ---------------------------------------------------------------------------

describe('dictionary-store 持久化', () => {
  it('文件不存在：用内置字典初始化并落盘（可直接编辑的纯映射）', () => {
    expect(fs.existsSync(dictFile)).toBe(false);
    const dict = loadDictionary();
    expect(dict).toEqual(DOMAIN_DICTIONARY);
    expect(fs.existsSync(dictFile)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
    expect(onDisk).toEqual(DOMAIN_DICTIONARY);
  });

  it('setDomainKeywords 写入后缓存失效，重新加载读到新值', () => {
    setDomainKeywords('仓储运营', ['库存', '盘点', '越库']);
    invalidateDictionaryCache();

    const dict = loadDictionary();
    expect(dict['仓储运营']).toEqual(['库存', '盘点', '越库']);
    // 其余板块保持内置
    expect(dict['销售与交付']).toEqual(DOMAIN_DICTIONARY['销售与交付']);

    // 文件内容同步
    const onDisk = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
    expect(onDisk['仓储运营']).toEqual(['库存', '盘点', '越库']);
  });

  it('setDomainKeywords 支持字典外新板块 upsert；关键词去空白去重', () => {
    const cleaned = setDomainKeywords(' 新板块 ', [' 甲 ', '乙', '甲']);
    expect(cleaned).toEqual(['甲', '乙']);

    invalidateDictionaryCache();
    expect(loadDictionary()['新板块']).toEqual(['甲', '乙']);
  });

  it('入参校验：空数组 / 空串元素 / 非数组 → ValidationError(422)', () => {
    expect(() => setDomainKeywords('财务', [])).toThrowError(/non-empty array/);
    expect(() => setDomainKeywords('财务', ['发票', '  '])).toThrowError(/non-empty array/);
    expect(() => setDomainKeywords('财务', '发票')).toThrowError(/non-empty array/);
    expect(() => setDomainKeywords('  ', ['发票'])).toThrowError(/non-empty string/);
  });

  it('文件损坏：回退内置字典且不覆盖原文件', () => {
    fs.writeFileSync(dictFile, '{broken json', 'utf8');
    invalidateDictionaryCache();

    const dict = loadDictionary();
    expect(dict).toEqual(DOMAIN_DICTIONARY);
    expect(fs.readFileSync(dictFile, 'utf8')).toBe('{broken json');
  });

  it('文件结构非法（非 板块→字符串数组 映射）：回退内置', () => {
    fs.writeFileSync(dictFile, JSON.stringify({ 财务: '发票' }), 'utf8');
    invalidateDictionaryCache();
    expect(loadDictionary()).toEqual(DOMAIN_DICTIONARY);
  });

  it('classifyDomains 默认走生效字典：持久化修改立即影响分类', () => {
    setDomainKeywords('仓储运营', ['越库']);
    invalidateDictionaryCache();

    const hit = classifyDomains('本周启动越库作业试点');
    expect(hit.primary_domain).toBe('仓储运营');

    // 内置关键词「盘点」已被整体替换 → 不再命中
    const miss = classifyDomains('华南仓盘点差异复盘');
    expect(miss.domains).not.toContain('仓储运营');
  });
});

// ---------------------------------------------------------------------------
// GET /api/domains/:name/keywords
// ---------------------------------------------------------------------------

describe('GET /api/domains/:name/keywords', () => {
  it('内置板块返回内置关键词', async () => {
    const { status, json } = await get(`/api/domains/${encodeURIComponent('仓储运营')}/keywords`);
    expect(status).toBe(200);
    expect(json.name).toBe('仓储运营');
    expect(json.keywords).toEqual(DOMAIN_DICTIONARY['仓储运营']);
  });

  it('字典外板块返回空数组（不 404）', async () => {
    const { status, json } = await get(`/api/domains/${encodeURIComponent('不存在板块')}/keywords`);
    expect(status).toBe(200);
    expect(json.keywords).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/domains/:name/keywords
// ---------------------------------------------------------------------------

describe('PUT /api/domains/:name/keywords', () => {
  it('整体替换关键词：GET 确认 + /api/domains 反映 + 分类器立即生效', async () => {
    const before = await get('/api/domains');
    expect(before.json.domains.find((d: any) => d.name === '仓储运营').keywords).toContain('盘点');

    const r = await put(`/api/domains/${encodeURIComponent('仓储运营')}/keywords`, {
      keywords: ['库存', '盘点', '越库'],
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ name: '仓储运营', keywords: ['库存', '盘点', '越库'] });

    // GET 确认
    const confirm = await get(`/api/domains/${encodeURIComponent('仓储运营')}/keywords`);
    expect(confirm.json.keywords).toEqual(['库存', '盘点', '越库']);

    // /api/domains 反映新关键词
    const after = await get('/api/domains');
    expect(after.json.domains.find((d: any) => d.name === '仓储运营').keywords).toEqual([
      '库存',
      '盘点',
      '越库',
    ]);

    // 分类器立即生效：新词命中
    const preview = await post('/api/classify-preview', { body: '越库作业今日开始' });
    expect(preview.json.primary_domain).toBe('仓储运营');
  });

  it('字典外新板块：PUT 建档后出现在 /api/domains 并可被分类命中', async () => {
    const r = await put(`/api/domains/${encodeURIComponent('质量安全')}/keywords`, {
      keywords: ['质检', '客诉'],
    });
    expect(r.status).toBe(200);

    const list = await get('/api/domains');
    const added = list.json.domains.find((d: any) => d.name === '质量安全');
    expect(added).toBeDefined();
    expect(added.keywords).toEqual(['质检', '客诉']);

    const preview = await post('/api/classify-preview', { body: '本周收到两起客诉并完成质检' });
    expect(preview.json.primary_domain).toBe('质量安全');
  });

  it('校验失败：空数组 / 含空串 / 非数组 → 422；字典保持不变', async () => {
    const url = `/api/domains/${encodeURIComponent('财务')}/keywords`;
    expect((await put(url, { keywords: [] })).status).toBe(422);
    expect((await put(url, { keywords: ['发票', ''] })).status).toBe(422);
    expect((await put(url, { keywords: '发票' })).status).toBe(422);
    expect((await put(url, {})).status).toBe(422);

    const after = await get(url);
    expect(after.json.keywords).toEqual(DOMAIN_DICTIONARY['财务']);
  });
});

// ---------------------------------------------------------------------------
// POST /api/classify-preview
// ---------------------------------------------------------------------------

describe('POST /api/classify-preview', () => {
  it('仓储文本返回仓储运营为主线（不落库）', async () => {
    const { status, json } = await post('/api/classify-preview', { body: '华南仓盘点库存' });
    expect(status).toBe(200);
    expect(json.primary_domain).toBe('仓储运营');
    expect(json.domains[0]).toBe('仓储运营');
    expect(json.domain_scores['仓储运营']).toBeGreaterThan(0);

    // 不落库：信号数不变
    expect(signalRepository.findAll()).toHaveLength(0);
  });

  it('无命中文本：domains 空、primary 为 null', async () => {
    const { json } = await post('/api/classify-preview', { body: '今天中午天气不错' });
    expect(json.domains).toEqual([]);
    expect(json.primary_domain).toBeNull();
    expect(json.domain_scores).toEqual({});
  });

  it('空字符串合法（返回零命中）；body 缺失 / 非字符串 → 422', async () => {
    const empty = await post('/api/classify-preview', { body: '' });
    expect(empty.status).toBe(200);
    expect(empty.json.primary_domain).toBeNull();

    expect((await post('/api/classify-preview', {})).status).toBe(422);
    expect((await post('/api/classify-preview', { body: 123 })).status).toBe(422);
  });
});
