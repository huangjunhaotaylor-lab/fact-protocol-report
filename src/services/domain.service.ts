/**
 * 业务板块（Domain）服务 — G0 批次
 *
 * 职责：
 * - 板块字典查询 + 计数（GET /api/domains）
 * - 人工纠正信号板块（POST /api/signals/:id/domains）
 * - 存量回填（POST /api/admin/reclassify）
 *
 * 规则：
 * - 人工纠正写入 domain_manual: true，回填时跳过
 * - 回填幂等：对同一批数据重复执行结果一致
 * - 任何板块字段变更后都重算 Object 传导
 */

import { Signal } from '../types';
import { signalRepository, objectRepository } from '../repositories';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { DOMAIN_DICTIONARY, BUILTIN_DOMAINS } from '../domain/dictionary';
import { classifyDomains } from '../domain/classifier';
import { recalcObjectDomains, recalcAllObjectDomains } from '../domain/propagation';

/** GET /api/domains 单板块条目 */
export interface DomainSummary {
  name: string;
  keywords: string[];
  signal_count: number;
  object_count: number;
}

/** GET /api/domains 返回体 */
export interface DomainListResult {
  domains: DomainSummary[];
  unclassified_signals: number;
}

/** POST /api/admin/reclassify 返回体 */
export interface ReclassifyResult {
  reclassified: number;
  skipped_manual: number;
  distribution: Record<string, number>;
}

export class DomainService {
  /**
   * 板块字典 + 计数
   * - 含 7 个内置板块 + 数据里出现过的其他板块名（人工纠正可能引入字典外板块）
   * - 字典外板块 keywords 返回空数组
   */
  listDomains(): DomainListResult {
    const signals = signalRepository.findAll();
    const objects = objectRepository.findAll();

    // 收集数据里出现过的全部板块名
    const seen = new Set<string>(BUILTIN_DOMAINS);
    const extras = new Set<string>();
    const collect = (domains?: string[]) => {
      for (const d of domains ?? []) {
        if (!seen.has(d) && !extras.has(d)) extras.add(d);
      }
    };
    for (const s of signals) collect(s.domains);
    for (const o of objects) collect(o.domains);

    const names = [
      ...BUILTIN_DOMAINS,
      ...Array.from(extras).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    ];

    const domains: DomainSummary[] = names.map((name) => ({
      name,
      keywords: DOMAIN_DICTIONARY[name] ?? [],
      signal_count: signals.filter((s) => (s.domains ?? []).includes(name)).length,
      object_count: objects.filter((o) => (o.domains ?? []).includes(name)).length,
    }));

    const unclassified = signals.filter((s) => (s.domains ?? []).length === 0).length;

    return { domains, unclassified_signals: unclassified };
  }

  /**
   * 人工纠正信号板块
   * - 覆盖 domains / primary_domain（未传 primary_domain 时取 domains[0]，空数组则为 null）
   * - domain_scores 置空（人工结果非分类器产出，保留旧得分会误导）
   * - 记录 domain_manual: true（存量回填跳过）
   * - 重算锚定 Object 传导
   */
  manualCorrect(signalId: string, domains: string[], primaryDomain?: string): Signal {
    const signal = signalRepository.findById(signalId);
    if (!signal) {
      throw new NotFoundError('Signal', signalId);
    }

    // 入参校验：domains 必须为字符串数组
    if (!Array.isArray(domains) || domains.some((d) => typeof d !== 'string' || d.length === 0)) {
      throw new ValidationError('domains must be an array of non-empty strings', ['domains']);
    }
    if (primaryDomain !== undefined && !domains.includes(primaryDomain)) {
      throw new ValidationError('primary_domain must be one of domains', ['primary_domain']);
    }

    const updated = signalRepository.update(signalId, {
      domains: [...domains],
      primary_domain: primaryDomain ?? domains[0] ?? null,
      domain_scores: {},
      domain_manual: true,
    });
    logger.info(`Signal domains manually corrected: ${signalId} → [${domains.join(',')}]`);

    // 重算锚定 Object 传导
    for (const objId of signal.anchors) {
      recalcObjectDomains(objId);
    }

    return updated!;
  }

  /**
   * 存量回填：对所有 domain_manual !== true 的信号重跑分类器，再重算全部 Object 传导
   * 幂等：分类器是纯函数，重复执行结果一致
   */
  reclassifyAll(): ReclassifyResult {
    const signals = signalRepository.findAll();

    let reclassified = 0;
    let skippedManual = 0;

    for (const signal of signals) {
      if (signal.domain_manual === true) {
        skippedManual += 1;
        continue;
      }
      const classification = classifyDomains(signal.body);
      signalRepository.update(signal.id, {
        domains: classification.domains,
        primary_domain: classification.primary_domain,
        domain_scores: classification.domain_scores,
      });
      reclassified += 1;
    }

    // 全部信号就位后，统一重算 Object 传导
    recalcAllObjectDomains();

    // 分布：按回填后全部信号（含人工纠正过的）的 primary_domain 统计
    const distribution: Record<string, number> = {};
    for (const signal of signalRepository.findAll()) {
      const key = signal.primary_domain ?? '未分类';
      distribution[key] = (distribution[key] ?? 0) + 1;
    }

    logger.info(
      `Reclassify done: reclassified=${reclassified}, skipped_manual=${skippedManual}`,
    );
    return {
      reclassified,
      skipped_manual: skippedManual,
      distribution,
    };
  }
}

// 单例
export const domainService = new DomainService();
