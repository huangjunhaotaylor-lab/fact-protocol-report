/**
 * Signal 服务
 *
 * Signal 表示业务观察（Observation）。
 * Signal 不是问题、风险、建议、决策或摘要。
 *
 * 核心规则：
 * - Signal 必须引用至少一个 Fragment
 * - Signal 必须锚定至少一个 Object
 * - body 必须是事实观察
 * - confidence 表示抽取置信度，不表示业务重要性
 * - Verified 必须由人工或可信规则确认
 * - Invalid 表示错误识别，不得物理删除
 * - Archived 表示历史失效，不得物理删除
 *
 * 状态：Captured → Verified / Invalid, Verified → Archived
 *
 * 对应需求：6.3, AC-005~AC-008, AC-011, 12.5, 12.6, 12.8~12.10
 */

import { Signal, SignalType, SignalState, SignalContext } from '../types';
import { signalRepository, fragmentRepository, objectRepository } from '../repositories';
import { generateId, logger, NotFoundError, StateTransitionError, ProtocolViolationError, ForbiddenError } from '../utils';
import { validateSignalBody } from '../validators/signal-body.validator';

export interface CreateSignalInput {
  type: SignalType;
  body: string;
  fragments: string[];
  anchors: string[];
  context: SignalContext;
  confidence: number;
  actors?: string[];
  occurred_at?: string;
  attributes?: Record<string, unknown>;
}

export class SignalService {
  /**
   * 从一个或多个 Fragment 创建 Signal
   *
   * AC-005: 用户可以基于一个或多个 Fragment 创建 Signal
   * AC-006: 创建无 Fragment 的 Signal 时，系统必须拒绝
   * AC-007: Signal 必须至少锚定一个 Object
   * AC-008: Signal body 包含明显建议、风险、结论类表达时，系统必须拒绝或标记为待人工确认
   *
   * 12.5: 从 Fragment 创建 Signal
   * 12.6: 将 Signal 锚定到 Object
   */
  create(input: CreateSignalInput): Signal {
    // AC-006: Signal 必须引用至少一个 Fragment
    if (!input.fragments || input.fragments.length === 0) {
      throw new ProtocolViolationError(
        'Signal must reference at least one Fragment (AC-006)',
      );
    }

    // 校验所有 Fragment 存在
    for (const fragId of input.fragments) {
      const fragment = fragmentRepository.findById(fragId);
      if (!fragment) {
        throw new ProtocolViolationError(
          `Cannot create Signal: Fragment not found: ${fragId}`,
        );
      }
    }

    // AC-007: Signal 必须至少锚定一个 Object
    if (!input.anchors || input.anchors.length === 0) {
      throw new ProtocolViolationError(
        'Signal must anchor at least one Object (AC-007)',
      );
    }

    // 校验所有 Object 存在
    for (const objId of input.anchors) {
      const obj = objectRepository.findById(objId);
      if (!obj) {
        throw new ProtocolViolationError(
          `Cannot create Signal: Object not found: ${objId}`,
        );
      }
    }

    // AC-008: Signal body 校验 — 必须是事实观察，不能包含判断类表达
    const bodyValidation = validateSignalBody(input.body);
    if (!bodyValidation.valid) {
      throw new ProtocolViolationError(
        `Signal body validation failed: ${bodyValidation.reason} (AC-008). ` +
          `Forbidden expressions detected: ${bodyValidation.detectedTerms?.join(', ')}`,
      );
    }

    const signal: Signal = {
      id: generateId('Signal'),
      type: input.type,
      body: input.body,
      fragments: input.fragments,
      anchors: input.anchors,
      context: input.context,
      state: 'Captured',
      captured_at: new Date().toISOString(),
      confidence: input.confidence,
      ...(input.actors !== undefined && { actors: input.actors }),
      ...(input.occurred_at !== undefined && { occurred_at: input.occurred_at }),
      ...(input.attributes !== undefined && { attributes: input.attributes }),
    };

    signalRepository.create(signal);
    logger.info(`Signal created: ${signal.id} (type: ${signal.type}, confidence: ${signal.confidence})`);
    return signal;
  }

  /**
   * 获取 Signal
   */
  getById(id: string): Signal {
    const signal = signalRepository.findById(id);
    if (!signal) {
      throw new NotFoundError('Signal', id);
    }
    return signal;
  }

  /**
   * 获取所有 Signal
   */
  getAll(): Signal[] {
    return signalRepository.findAll();
  }

  /**
   * 12.9: 标记 Signal 为 Verified
   * Verified 必须由人工或可信规则确认
   * 状态流转：Captured → Verified
   */
  verify(id: string): Signal {
    const signal = this.getById(id);
    if (signal.state !== 'Captured') {
      throw new StateTransitionError(
        `Cannot verify Signal in state "${signal.state}"`,
        signal.state,
        'Verified',
      );
    }
    const updated = signalRepository.update(id, {
      state: 'Verified' as SignalState,
    });
    logger.info(`Signal verified: ${id}`);
    return updated!;
  }

  /**
   * 12.10: 标记 Signal 为 Invalid
   * Invalid 表示错误识别，不得物理删除
   * 状态流转：Captured → Invalid
   */
  markInvalid(id: string): Signal {
    const signal = this.getById(id);
    if (signal.state !== 'Captured') {
      throw new StateTransitionError(
        `Cannot mark Signal as Invalid from state "${signal.state}"`,
        signal.state,
        'Invalid',
      );
    }
    const updated = signalRepository.update(id, {
      state: 'Invalid' as SignalState,
    });
    logger.info(`Signal marked invalid: ${id} (preserved, not deleted)`);
    return updated!;
  }

  /**
   * 归档 Signal
   * Archived 表示历史失效，不得物理删除
   * 状态流转：Verified → Archived
   */
  archive(id: string): Signal {
    const signal = this.getById(id);
    if (signal.state !== 'Verified') {
      throw new StateTransitionError(
        `Cannot archive Signal from state "${signal.state}"`,
        signal.state,
        'Archived',
      );
    }
    const updated = signalRepository.update(id, {
      state: 'Archived' as SignalState,
    });
    logger.info(`Signal archived: ${id} (preserved, not deleted)`);
    return updated!;
  }

  /**
   * AC-011: Signal 被标记为 Invalid 后不得物理删除
   * 此方法始终抛出错误
   */
  physicalDelete(id: string): never {
    const signal = this.getById(id);
    if (signal.state === 'Invalid' || signal.state === 'Archived') {
      throw new ForbiddenError(
        `Cannot physically delete Signal in state "${signal.state}" (AC-011). ` +
          `Invalid and Archived signals must be preserved.`,
      );
    }
    throw new ForbiddenError(
      `Physical deletion of Signal is not allowed in BSP protocol (id: ${id})`,
    );
  }

  /**
   * 按 Object 查询 Signal
   */
  getByObject(objectId: string): Signal[] {
    return signalRepository.find((s) => s.anchors.includes(objectId));
  }

  /**
   * 按 Fragment 查询 Signal
   * 一个 Fragment 可以支撑多个 Signal
   */
  getByFragment(fragmentId: string): Signal[] {
    return signalRepository.find((s) => s.fragments.includes(fragmentId));
  }
}

// 单例
export const signalService = new SignalService();
