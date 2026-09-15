/**
 * 板块分类器单元测试（G0 批次）
 *
 * 覆盖：
 * - 单板块命中 / 关键词去重计分
 * - 多板块命中与得分降序排序
 * - 主线板块（primary_domain）选择
 * - 并列得分 → 字典序靠前
 * - 全零命中兜底（domains: [], primary_domain: null, domain_scores: {}）
 * - 大小写不敏感（英文关键词）
 * - Object 传导纯函数（并集 / 计票 / 空信号）
 */

import { describe, it, expect } from 'vitest';
import { classifyDomains } from '../domain/classifier';
import { computeObjectDomains } from '../domain/propagation';
import { DOMAIN_DICTIONARY, BUILTIN_DOMAINS } from '../domain/dictionary';
import { Signal } from '../types';

describe('板块字典', () => {
  it('内置 7 个板块，关键词均为非空数组', () => {
    expect(BUILTIN_DOMAINS).toHaveLength(7);
    for (const name of BUILTIN_DOMAINS) {
      expect(DOMAIN_DICTIONARY[name].length).toBeGreaterThan(0);
    }
  });
});

describe('classifyDomains 分类器', () => {
  it('单板块主导：命中词去重计分，primary 为最高分板块', () => {
    const r = classifyDomains('华南仓 A 区实际库存与 WMS 账面存在 36 件差异，需复盘盘点流程');
    // 仓储运营：仓库?（未出现）→ 库存、WMS、盘点 = 3 分；项目推进：复盘 = 1 分
    expect(r.primary_domain).toBe('仓储运营');
    expect(r.domain_scores['仓储运营']).toBe(3);
    expect(r.domains[0]).toBe('仓储运营');
    expect(r.domains).toContain('项目推进');
  });

  it('同一关键词重复出现只计 1 分（去重命中）', () => {
    const r = classifyDomains('库存 库存 库存');
    expect(r.domain_scores['仓储运营']).toBe(1);
    expect(r.primary_domain).toBe('仓储运营');
  });

  it('多板块命中：domains 按得分降序', () => {
    // 系统与工具：系统、上线、Excel = 3；仓储运营：盘点 = 1
    const r = classifyDomains('新系统上线后仍用 Excel 盘点');
    expect(r.primary_domain).toBe('系统与工具');
    expect(r.domains).toEqual(['系统与工具', '仓储运营']);
  });

  it('英文关键词大小写不敏感', () => {
    const r = classifyDomains('wms 与 sku 主数据对齐');
    expect(r.primary_domain).toBe('仓储运营');
    expect(r.domain_scores['仓储运营']).toBe(2);
  });

  it('并列得分：primary 取字典序靠前者', () => {
    // 合同 → 采购供应 1 分；发票 → 财务 1 分
    const r = classifyDomains('合同与发票均已归档');
    expect(r.domain_scores['采购供应']).toBe(1);
    expect(r.domain_scores['财务']).toBe(1);
    expect(r.domains).toHaveLength(2);
    const expected = ['采购供应', '财务'].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    expect(r.domains).toEqual(expected);
    expect(r.primary_domain).toBe(expected[0]);
  });

  it('全零命中兜底：空 domains、primary 为 null、空得分表', () => {
    const r = classifyDomains('今天天气不错，适合外出走走');
    expect(r).toEqual({ domains: [], primary_domain: null, domain_scores: {} });
  });

  it('空字符串 / 空白输入同样走全零兜底', () => {
    expect(classifyDomains('').primary_domain).toBeNull();
    expect(classifyDomains('   ').domains).toEqual([]);
  });

  it('销售与交付典型句：客户订单交付', () => {
    const r = classifyDomains('恒晟电子 3 月订单交付日期调整');
    expect(r.primary_domain).toBe('销售与交付');
    // 客户?（未出现）→ 订单、交付 = 2 分
    expect(r.domain_scores['销售与交付']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Object 传导纯函数
// ---------------------------------------------------------------------------

function fakeSignal(domains: string[], primary: string | null): Signal {
  return {
    id: `SIG-${Math.random().toString(36).slice(2, 8)}`,
    type: 'observation',
    body: '测试信号',
    fragments: ['FRG-X'],
    anchors: ['OBJ-X'],
    context: {},
    state: 'Captured',
    captured_at: '2026-09-01T00:00:00.000Z',
    confidence: 0.9,
    domains,
    primary_domain: primary,
  };
}

describe('computeObjectDomains 板块传导', () => {
  it('并集：多条信号板块取并集；primary 计票最高者', () => {
    const signals = [
      fakeSignal(['仓储运营'], '仓储运营'),
      fakeSignal(['仓储运营', '系统与工具'], '系统与工具'),
      fakeSignal(['系统与工具'], '仓储运营'),
    ];
    const r = computeObjectDomains(signals);
    expect(r.domains.sort()).toEqual(['系统与工具', '仓储运营'].sort());
    // 计票：仓储运营 2 票 > 系统与工具 1 票
    expect(r.primary_domain).toBe('仓储运营');
  });

  it('信号无板块：domains 为空、primary 为 null', () => {
    const r = computeObjectDomains([fakeSignal([], null)]);
    expect(r).toEqual({ domains: [], primary_domain: null });
  });

  it('无锚定信号：空结果', () => {
    expect(computeObjectDomains([])).toEqual({ domains: [], primary_domain: null });
  });
});
