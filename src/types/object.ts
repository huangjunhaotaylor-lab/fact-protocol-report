/**
 * Object — 企业对象
 *
 * Object 表示企业中的稳定实体。
 *
 * 类型：Project, System, Department, Customer, Product, Document, Process, Person, Organization, Task
 *
 * 规则：
 * - Object 是 Reality Network 的组织中心
 * - Object 不由单个 Signal 临时决定
 * - Object 名称变化不等于新 Object
 * - Object 合并后旧 Object 进入 Merged，不得删除
 *
 * 状态：Created → Active, Active → Merged/Archived
 */

/** Object 类型 */
export type ObjectType =
  | 'Project'
  | 'System'
  | 'Department'
  | 'Customer'
  | 'Product'
  | 'Document'
  | 'Process'
  | 'Person'
  | 'Organization'
  | 'Task';

/** Object 状态 */
export type ObjectState = 'Created' | 'Active' | 'Merged' | 'Archived';

/** Object 必填字段 */
export interface ObjectRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 对象类型 */
  type: ObjectType;
  /** 对象名称 */
  name: string;
  /** 状态 */
  state: ObjectState;
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/** Object 可选字段 */
export interface ObjectOptionalFields {
  /** 身份归一 ID */
  identity?: string;
  /** 别名列表 */
  aliases?: string[];
  /** 附加属性 */
  attributes?: Record<string, unknown>;
}

/** Object 完整接口 */
export interface BSPObject extends ObjectRequiredFields, ObjectOptionalFields {}
