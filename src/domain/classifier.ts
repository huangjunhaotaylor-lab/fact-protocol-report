/**
 * 业务板块分类器 — G0 批次
 *
 * 纯函数、无 IO、可单测：
 * - 输入一段文本（通常是 Signal.body），按板块字典做关键词命中计分
 * - 每个板块得分 = 去重后的命中关键词数（每词 1 分，同一词多次出现不重复计分）
 * - domains = 得分 > 0 的板块，按得分降序（同分按字典序，保证确定性）
 * - primary_domain = 最高分板块；并列时取字典序靠前者
 * - 全部零命中 → 兜底 { domains: [], primary_domain: null, domain_scores: {} }
 *
 * 匹配规则：大小写不敏感（文本与关键词统一转小写后做子串包含匹配）。
 * 中文没有词边界问题；英文关键词（如 WMS、SKU、Excel）按子串匹配，
 * 初版接受其带来的少量误命中（如 excel 命中 excellence），后续可加词边界。
 */

import { DOMAIN_DICTIONARY } from './dictionary';

/** 分类结果 */
export interface DomainClassification {
  /** 得分 > 0 的板块（按得分降序，同分按字典序） */
  domains: string[];
  /** 主线板块（最高分；并列取字典序靠前；全零为 null） */
  primary_domain: string | null;
  /** 各命中板块的得分（只含得分 > 0 的板块） */
  domain_scores: Record<string, number>;
}

/**
 * 对文本做板块分类
 * @param text 待分类文本（通常为 Signal.body）
 */
export function classifyDomains(text: string): DomainClassification {
  const normalized = (text ?? '').toLowerCase();

  // 逐板块计分：去重命中，每词 1 分
  const scores: Record<string, number> = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_DICTIONARY)) {
    let score = 0;
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[domain] = score;
    }
  }

  // 全零兜底
  const hitDomains = Object.keys(scores);
  if (hitDomains.length === 0) {
    return { domains: [], primary_domain: null, domain_scores: {} };
  }

  // 排序：得分降序；同分按字典序（保证结果确定性）
  const sorted = hitDomains.sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return a.localeCompare(b, 'zh-Hans-CN');
  });

  return {
    domains: sorted,
    primary_domain: sorted[0],
    domain_scores: scores,
  };
}
