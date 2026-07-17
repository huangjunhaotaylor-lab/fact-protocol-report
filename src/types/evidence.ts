/**
 * Evidence — 原始证据
 *
 * 表示现实世界中的原始证据。
 * 来源可以是会议、PRD、邮件、ERP、飞书、Jira、表格、Agent 输出、AI 输出或人工输入。
 *
 * 规则：
 * - content 必须保存原文
 * - content 创建后不可被 AI 或用户改写
 * - checksum 用于校验原始内容是否变化
 * - version 表示证据版本
 * - chain_id 表示同一证据链
 *
 * 状态：Created → Archived
 */

/** Evidence 来源类型 */
export type EvidenceSource =
  | 'meeting'
  | 'prd'
  | 'email'
  | 'erp'
  | 'feishu'
  | 'jira'
  | 'spreadsheet'
  | 'agent'
  | 'ai'
  | 'manual'
  | 'other';

/** Evidence 状态 */
export type EvidenceState = 'Created' | 'Archived';

/** Evidence 必填字段 */
export interface EvidenceRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 来源类型 */
  source: EvidenceSource;
  /** 创建时间 */
  created_at: string;
  /** 原始内容（不可变） */
  content: string;
  /** 内容校验和 */
  checksum: string;
  /** 状态 */
  state: EvidenceState;
}

/** Evidence 可选字段 */
export interface EvidenceOptionalFields {
  /** 来源系统内的 ID */
  source_id?: string;
  /** 证据版本 */
  version?: number;
  /** 同一证据链 ID */
  chain_id?: string;
  /** 创建者 */
  creator?: string;
  /** 附件列表 */
  attachments?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** Evidence 完整接口 */
export interface Evidence extends EvidenceRequiredFields, EvidenceOptionalFields {}
