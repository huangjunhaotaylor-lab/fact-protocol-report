/**
 * 证据链追溯查询
 *
 * 核心追溯链路：
 * Signal → Fragment → Evidence
 *
 * 功能：
 * - Signal → Fragment 追溯：从 Signal 查看支撑它的 Fragment
 * - Fragment → Evidence 追溯：从 Fragment 查看原始 Evidence
 * - Signal → Evidence 全链路追溯
 *
 * 对应需求：12.8, 12.4, AC-009, AC-010
 */

import { Signal, Fragment, Evidence } from '../types';
import { signalRepository, fragmentRepository, evidenceRepository } from '../repositories';
import { NotFoundError } from '../utils/errors';

/** 追溯结果：Signal 的完整证据链 */
export interface SignalTrace {
  /** Signal 本身 */
  signal: Signal;
  /** 支撑该 Signal 的所有 Fragment */
  fragments: Fragment[];
  /** Fragment 对应的原始 Evidence */
  evidences: Evidence[];
  /** 完整链路 */
  chain: Array<{
    signal: Signal;
    fragment: Fragment;
    evidence: Evidence;
    /** Fragment 在 Evidence 中的位置 */
    position: { start: number; end: number } | null;
  }>;
}

export class TraceQuery {
  /**
   * AC-009: 从 Signal 查看支撑它的 Fragment
   * 12.8: 查看 Signal 的证据链
   */
  getSignalFragments(signalId: string): Fragment[] {
    const signal = signalRepository.findById(signalId);
    if (!signal) {
      throw new NotFoundError('Signal', signalId);
    }

    const fragments: Fragment[] = [];
    for (const fragId of signal.fragments) {
      const fragment = fragmentRepository.findById(fragId);
      if (fragment) {
        fragments.push(fragment);
      }
    }
    return fragments;
  }

  /**
   * AC-010: 从 Fragment 查看原始 Evidence
   */
  getFragmentEvidence(fragmentId: string): Evidence {
    const fragment = fragmentRepository.findById(fragmentId);
    if (!fragment) {
      throw new NotFoundError('Fragment', fragmentId);
    }
    const evidence = evidenceRepository.findById(fragment.evidence_id);
    if (!evidence) {
      throw new NotFoundError('Evidence', fragment.evidence_id);
    }
    return evidence;
  }

  /**
   * 全链路追溯：Signal → Fragment → Evidence
   */
  traceSignal(signalId: string): SignalTrace {
    const signal = signalRepository.findById(signalId);
    if (!signal) {
      throw new NotFoundError('Signal', signalId);
    }

    const fragments: Fragment[] = [];
    const evidences: Evidence[] = [];
    const chain: SignalTrace['chain'] = [];

    for (const fragId of signal.fragments) {
      const fragment = fragmentRepository.findById(fragId);
      if (!fragment) {
        continue;
      }
      fragments.push(fragment);

      const evidence = evidenceRepository.findById(fragment.evidence_id);
      if (!evidence) {
        continue;
      }

      // 避免重复添加 Evidence
      if (!evidences.find((e) => e.id === evidence.id)) {
        evidences.push(evidence);
      }

      // 计算 Fragment 在 Evidence 中的位置
      const start = evidence.content.indexOf(fragment.content);
      const position = start >= 0 ? { start, end: start + fragment.content.length } : null;

      chain.push({ signal, fragment, evidence, position });
    }

    return { signal, fragments, evidences, chain };
  }

  /**
   * 从 Object 追溯其所有 Signal 的证据链
   */
  traceObject(objectId: string): SignalTrace[] {
    const signals = signalRepository.find((s) => s.anchors.includes(objectId));
    return signals.map((s) => this.traceSignal(s.id));
  }
}

// 单例
export const traceQuery = new TraceQuery();
