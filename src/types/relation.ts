/**
 * Relation — 对象间事实关系
 *
 * Relation 表示 Object 之间的事实关系。
 *
 * 类型：references, belongs_to, implements, depends_on, causes, blocks, affects, supersedes
 *
 * 规则：
 * - source 和 target 必须是 Object
 * - derived_from 必须引用 Signal
 * - Relation 只表达事实关系，不表达建议、优先级或策略
 */

/** Relation 类型 */
export type RelationType =
  | 'references'
  | 'belongs_to'
  | 'implements'
  | 'depends_on'
  | 'causes'
  | 'blocks'
  | 'affects'
  | 'supersedes';

/** Relation 必填字段 */
export interface RelationRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 源 Object ID */
  source: string;
  /** 目标 Object ID */
  target: string;
  /** 关系类型 */
  type: RelationType;
  /** 推导来源 Signal ID */
  derived_from: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 创建时间 */
  created_at: string;
}

/** Relation 完整接口 */
export interface Relation extends RelationRequiredFields {}
