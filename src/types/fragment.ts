/**
 * Fragment — 证据片段
 *
 * 表示 Evidence 中可定位、可引用、可复用的证据片段。
 *
 * 规则：
 * - Fragment 必须属于一个 Evidence
 * - Fragment.content 必须来自 Evidence 原文或原始附件
 * - Fragment 不允许保存 AI 改写后的内容
 * - 一个 Evidence 可以生成多个 Fragment
 * - 一个 Fragment 可以支撑多个 Signal
 *
 * 状态：Created → Archived
 */

/** Fragment 类型 */
export type FragmentType =
  | 'Speech'
  | 'Text'
  | 'Table'
  | 'Image'
  | 'Document'
  | 'Data'
  | 'Code'
  | 'Other';

/** Fragment 状态 */
export type FragmentState = 'Created' | 'Archived';

/** Fragment 必填字段 */
export interface FragmentRequiredFields {
  /** 唯一标识 */
  id: string;
  /** 所属 Evidence ID */
  evidence_id: string;
  /** 片段类型 */
  type: FragmentType;
  /** 片段内容（来自 Evidence 原文，不可变） */
  content: string;
  /** 内容校验和 */
  checksum: string;
  /** 状态 */
  state: FragmentState;
}

/** Fragment 可选字段（定位信息） */
export interface FragmentOptionalFields {
  /** 说话人 */
  speaker?: string;
  /** 文本起始偏移量 */
  start_offset?: number;
  /** 文本结束偏移量 */
  end_offset?: number;
  /** 音视频起始时间戳 */
  timestamp_start?: string;
  /** 音视频结束时间戳 */
  timestamp_end?: string;
  /** 页码 */
  page?: number;
  /** 章节 */
  section?: string;
  /** 行号 */
  row?: number;
  /** 列号 */
  column?: number;
  /** 附件 ID */
  attachment_id?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** Fragment 完整接口 */
export interface Fragment extends FragmentRequiredFields, FragmentOptionalFields {}
