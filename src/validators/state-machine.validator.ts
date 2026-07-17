/**
 * 状态机校验器
 *
 * 校验各协议对象的状态流转是否合法。
 *
 * 状态流转规则（文档第 11 节）：
 * - Evidence:  Created → Archived
 * - Fragment:  Created → Archived
 * - Signal:    Captured → Verified, Captured → Invalid, Verified → Archived
 * - Object:    Created → Active, Active → Merged, Active → Archived
 *
 * 状态规则：
 * - Invalid 不代表删除，只代表错误识别
 * - Archived 不代表删除，只代表不再作为当前有效现实
 * - Merged 必须保留合并来源
 * - Verified 表示人工或可信规则确认
 *
 * 对应需求：11
 */

import { StateTransitionError, ImmutabilityError, ForbiddenError } from '../utils/errors';

/** Evidence 状态流转 */
const EVIDENCE_TRANSITIONS: Record<string, string[]> = {
  Created: ['Archived'],
  Archived: [],
};

/** Fragment 状态流转 */
const FRAGMENT_TRANSITIONS: Record<string, string[]> = {
  Created: ['Archived'],
  Archived: [],
};

/** Signal 状态流转 */
const SIGNAL_TRANSITIONS: Record<string, string[]> = {
  Captured: ['Verified', 'Invalid'],
  Verified: ['Archived'],
  Invalid: [],
  Archived: [],
};

/** Object 状态流转 */
const OBJECT_TRANSITIONS: Record<string, string[]> = {
  Created: ['Active'],
  Active: ['Merged', 'Archived'],
  Merged: [],
  Archived: [],
};

/**
 * 校验状态流转是否合法
 */
export function validateStateTransition(
  entityName: string,
  transitions: Record<string, string[]>,
  fromState: string,
  toState: string,
): void {
  const allowed = transitions[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new StateTransitionError(
      `Invalid ${entityName} state transition: ${fromState} → ${toState}. ` +
        `Allowed transitions from "${fromState}": ${allowed.length > 0 ? allowed.join(', ') : 'none'}`,
      fromState,
      toState,
    );
  }
}

/** 校验 Evidence 状态流转 */
export function validateEvidenceTransition(from: string, to: string): void {
  validateStateTransition('Evidence', EVIDENCE_TRANSITIONS, from, to);
}

/** 校验 Fragment 状态流转 */
export function validateFragmentTransition(from: string, to: string): void {
  validateStateTransition('Fragment', FRAGMENT_TRANSITIONS, from, to);
}

/** 校验 Signal 状态流转 */
export function validateSignalTransition(from: string, to: string): void {
  validateStateTransition('Signal', SIGNAL_TRANSITIONS, from, to);
}

/** 校验 Object 状态流转 */
export function validateObjectTransition(from: string, to: string): void {
  validateStateTransition('Object', OBJECT_TRANSITIONS, from, to);
}

/**
 * 校验不可变字段
 * Evidence.content 和 Fragment.content 不可修改
 */
export function validateImmutability(
  entityName: string,
  id: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  if (oldValue !== undefined && oldValue !== newValue) {
    throw new ImmutabilityError(
      `${entityName}.${field} is immutable and cannot be modified after creation (id: ${id})`,
      field,
    );
  }
}

/**
 * 校验不可物理删除
 * Invalid / Archived 的 Signal 不可物理删除
 */
export function validateNoPhysicalDelete(
  entityName: string,
  id: string,
  state: string,
): void {
  if (state === 'Invalid' || state === 'Archived') {
    throw new ForbiddenError(
      `Cannot physically delete ${entityName} in state "${state}" (id: ${id}). ` +
        `${state} records must be preserved per BSP protocol.`,
    );
  }
}
