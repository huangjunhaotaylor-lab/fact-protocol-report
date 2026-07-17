/**
 * Context — 信号发生环境
 *
 * Context 表示 Signal 发生环境。
 *
 * 规则：
 * - Context 只描述环境
 * - Context 不表达业务意义、风险等级或管理判断
 *
 * 注：Context 作为 Signal 的内嵌字段使用，不独立存储。
 * 此接口与 signal.ts 中的 SignalContext 保持一致。
 */

export interface Context {
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
