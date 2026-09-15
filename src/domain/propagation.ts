/**
 * 板块传导（Signal → Object）— G0 批次
 *
 * 传导规则：
 * - Object.domains = 其全部锚定信号的板块并集
 * - Object.primary_domain = 并集内计票最高者（每条锚定信号用自己的 primary_domain 投一票；
 *   并列时取字典序靠前，保证确定性）
 * - 触发时机：Signal 创建 / 人工纠正板块 / 存量回填时重算
 * - 归档、状态变更（verify / invalid / archive）不触发重算
 *
 * 注意：本模块直接读写 Repository，供 service 层调用；
 * 自身不做校验，调用方保证 objectId / signal 数据合法。
 */

import { Signal, BSPObject } from '../types';
import { signalRepository, objectRepository } from '../repositories';
import { logger } from '../utils/logger';

/** 由锚定信号集合计算 Object 的板块字段（纯函数，便于测试） */
export function computeObjectDomains(signals: Signal[]): {
  domains: string[];
  primary_domain: string | null;
} {
  // 并集（保持字典序稳定输出）
  const union = new Set<string>();
  for (const sig of signals) {
    for (const d of sig.domains ?? []) {
      union.add(d);
    }
  }
  if (union.size === 0) {
    return { domains: [], primary_domain: null };
  }

  // 计票：每条信号用 primary_domain 投一票（仅统计落在并集内的票）
  const votes = new Map<string, number>();
  for (const sig of signals) {
    const primary = sig.primary_domain;
    if (primary && union.has(primary)) {
      votes.set(primary, (votes.get(primary) ?? 0) + 1);
    }
  }

  // 最高票；并列取字典序靠前（保证确定性）
  let primary: string | null = null;
  let best = -1;
  for (const domain of Array.from(union).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
    const v = votes.get(domain) ?? 0;
    if (v > best) {
      best = v;
      primary = domain;
    }
  }

  return {
    domains: Array.from(union).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    primary_domain: primary,
  };
}

/**
 * 重算单个 Object 的板块传导字段并持久化
 * @returns 更新后的 Object；Object 不存在时返回 undefined
 */
export function recalcObjectDomains(objectId: string): BSPObject | undefined {
  const obj = objectRepository.findById(objectId);
  if (!obj) return undefined;

  const anchored = signalRepository.find((s) => s.anchors.includes(objectId));
  const { domains, primary_domain } = computeObjectDomains(anchored);

  const updated = objectRepository.update(objectId, {
    domains,
    primary_domain,
  });
  logger.debug(
    `Domain propagation: Object ${objectId} → domains=[${domains.join(',')}] primary=${primary_domain}`,
  );
  return updated;
}

/**
 * 重算全部 Object 的板块传导字段
 * （存量回填 / 人工纠正后批量调用）
 */
export function recalcAllObjectDomains(): void {
  for (const obj of objectRepository.findAll()) {
    recalcObjectDomains(obj.id);
  }
}
