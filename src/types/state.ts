/**
 * State — 对象当前状态
 *
 * State 表示 Object 当前状态，不表示历史。
 *
 * 规则：
 * - State 必须由 Signal 推导或人工基于 Signal 确认
 * - 历史由 Signal 记录
 * - State 改变时必须保留 derived_from
 */

/** State 必填字段 */
export interface StateRequiredFields {
  /** 目标 Object ID */
  object: string;
  /** 当前状态值 */
  current_state: string;
  /** 更新时间 */
  updated_at: string;
  /** 推导来源 Signal ID */
  derived_from: string;
}

/** State 可选字段 */
export interface StateOptionalFields {
  /** 状态变更原因 */
  reason?: string;
}

/** State 完整接口 */
export interface BSPState extends StateRequiredFields, StateOptionalFields {}
