/**
 * Identity — 对象身份归一
 *
 * Identity 解决同一 Object 多名称问题。
 *
 * 规则：
 * - Identity 只表达命名归一，不表达业务判断
 * - Identity 可以演化
 * - 合并必须保留 merged_from
 */

/** Identity 必填字段 */
export interface IdentityRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 规范名称 */
  canonical_name: string;
  /** 别名列表 */
  aliases: string[];
  /** 置信度 (0-1) */
  confidence: number;
}

/** Identity 可选字段 */
export interface IdentityOptionalFields {
  /** 合并来源 ID */
  merged_from?: string[];
}

/** Identity 完整接口 */
export interface Identity extends IdentityRequiredFields, IdentityOptionalFields {}
