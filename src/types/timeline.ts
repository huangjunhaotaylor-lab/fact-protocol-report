/**
 * Timeline — 时间线投影
 *
 * Timeline 表示围绕 Object 的 Signal 时间投影。
 *
 * 规则：
 * - Timeline 是 Projection（投影）
 * - Timeline 由 Signal 查询生成
 * - Timeline 不作为独立 Reality Source 写入
 */

/** Timeline 字段 */
export interface Timeline {
  /** 目标对象 ID */
  object: string;
  /** 关联 Signal ID 列表 */
  signals: string[];
  /** 起始时间 */
  start: string;
  /** 结束时间 */
  end: string;
}
