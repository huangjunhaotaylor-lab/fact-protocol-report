/**
 * Signal — 业务观察
 *
 * Signal 表示业务观察（Observation）。
 * Signal 不是问题、风险、建议、决策或摘要。
 *
 * 规则：
 * - Signal 必须引用至少一个 Fragment
 * - Signal 必须锚定至少一个 Object
 * - body 必须是事实观察
 * - confidence 表示抽取置信度，不表示业务重要性
 * - Verified 必须由人工或可信规则确认
 * - Invalid 表示错误识别，不得物理删除
 * - Archived 表示历史失效，不得物理删除
 *
 * 状态：Captured → Verified / Invalid, Verified → Archived
 */

/** Signal 类型 */
export type SignalType = 'observation' | 'event' | 'change' | 'status' | 'action';

/** Signal 状态 */
export type SignalState = 'Captured' | 'Verified' | 'Invalid' | 'Archived';

/** Signal Context — 信号发生环境 */
export interface SignalContext {
  /** 渠道 */
  channel?: string;
  /** 来源 */
  source?: string;
  /** 组织 */
  organization?: string;
  /** 位置 */
  location?: string;
  /** 会议 */
  meeting?: string;
  /** 文档 */
  document?: string;
  /** 系统 */
  system?: string;
}

/** Signal 必填字段 */
export interface SignalRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 信号类型 */
  type: SignalType;
  /** 事实观察内容 */
  body: string;
  /** 引用的 Fragment ID 列表 */
  fragments: string[];
  /** 锚定的 Object ID 列表 */
  anchors: string[];
  /** 信号发生环境 */
  context: SignalContext;
  /** 状态 */
  state: SignalState;
  /** 捕获时间 */
  captured_at: string;
  /** 抽取置信度 (0-1) */
  confidence: number;
}

/** Signal 可选字段 */
export interface SignalOptionalFields {
  /** 参与者 */
  actors?: string[];
  /** 发生时间 */
  occurred_at?: string;
  /** 附加属性 */
  attributes?: Record<string, unknown>;
}

/** Signal 完整接口 */
export interface Signal extends SignalRequiredFields, SignalOptionalFields {}
