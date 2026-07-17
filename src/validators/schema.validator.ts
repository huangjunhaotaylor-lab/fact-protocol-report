/**
 * Schema 校验器
 *
 * 校验各协议对象必填字段是否齐全、字段类型是否正确、枚举值是否合法。
 *
 * 拒绝场景（文档第 10 节）：
 * 1. 创建无 Evidence 的 Fragment
 * 2. 创建无 Fragment 的 Signal
 * 3. 创建无 Object Anchor 的 Signal
 * 4. 创建无法追溯来源的 Relation
 * 5. 修改 Evidence.content
 * 6. 修改 Fragment.content
 * 7. 物理删除 Invalid Signal
 * 8. 在 BSP 层创建 Risk / Issue / Decision
 *
 * 对应需求：10, AC-006, AC-007, AC-013
 */

import { ValidationError } from '../utils/errors';
import {
  EvidenceSource,
  EvidenceState,
  FragmentType,
  FragmentState,
  SignalType,
  SignalState,
  ObjectType,
  ObjectState,
  RelationType,
} from '../types';

/** 校验必填字段 */
export function validateRequired(
  data: Record<string, unknown>,
  requiredFields: string[],
  entityName: string,
): void {
  const missing: string[] = [];
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError(
      `${entityName} validation failed: missing required fields: ${missing.join(', ')}`,
      missing,
    );
  }
}

/** 校验枚举值 */
export function validateEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
): void {
  if (value !== undefined && !allowedValues.includes(value as T)) {
    throw new ValidationError(
      `Invalid value for ${fieldName}: "${value}". Allowed: ${allowedValues.join(', ')}`,
    );
  }
}

/** Evidence 必填字段 */
export const EVIDENCE_REQUIRED_FIELDS = [
  'id', 'source', 'created_at', 'content', 'checksum', 'state',
] as const;

/** Evidence 枚举校验 */
export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  'meeting', 'prd', 'email', 'erp', 'feishu', 'jira', 'spreadsheet', 'agent', 'ai', 'manual', 'other',
] as const;

export const EVIDENCE_STATES: readonly EvidenceState[] = ['Created', 'Archived'] as const;

/** Fragment 必填字段 */
export const FRAGMENT_REQUIRED_FIELDS = [
  'id', 'evidence_id', 'type', 'content', 'checksum', 'state',
] as const;

export const FRAGMENT_TYPES: readonly FragmentType[] = [
  'Speech', 'Text', 'Table', 'Image', 'Document', 'Data', 'Code', 'Other',
] as const;

export const FRAGMENT_STATES: readonly FragmentState[] = ['Created', 'Archived'] as const;

/** Signal 必填字段 */
export const SIGNAL_REQUIRED_FIELDS = [
  'id', 'type', 'body', 'fragments', 'anchors', 'context', 'state', 'captured_at', 'confidence',
] as const;

export const SIGNAL_TYPES: readonly SignalType[] = [
  'observation', 'event', 'change', 'status', 'action',
] as const;

export const SIGNAL_STATES: readonly SignalState[] = [
  'Captured', 'Verified', 'Invalid', 'Archived',
] as const;

/** Object 必填字段 */
export const OBJECT_REQUIRED_FIELDS = [
  'id', 'type', 'name', 'state', 'created_at', 'updated_at',
] as const;

export const OBJECT_TYPES: readonly ObjectType[] = [
  'Project', 'System', 'Department', 'Customer', 'Product',
  'Document', 'Process', 'Person', 'Organization', 'Task',
] as const;

export const OBJECT_STATES: readonly ObjectState[] = [
  'Created', 'Active', 'Merged', 'Archived',
] as const;

/** Relation 必填字段 */
export const RELATION_REQUIRED_FIELDS = [
  'id', 'source', 'target', 'type', 'derived_from', 'confidence', 'created_at',
] as const;

export const RELATION_TYPES: readonly RelationType[] = [
  'references', 'belongs_to', 'implements', 'depends_on',
  'causes', 'blocks', 'affects', 'supersedes',
] as const;

/** 禁止在 BSP 层创建的实体类型 */
export const FORBIDDEN_BSP_ENTITY_TYPES = [
  'Issue', 'Risk', 'Decision', 'Suggestion', 'KPI', 'Workflow',
] as const;

/**
 * 校验是否尝试在 BSP 层创建禁止的实体类型
 * 对应需求：10, AC-015
 */
export function validateNotForbiddenEntity(entityType: string): void {
  if ((FORBIDDEN_BSP_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new ValidationError(
      `Cannot create "${entityType}" in BSP Reality Layer. ` +
        `BSP only allows: Evidence, Fragment, Signal, Object, Identity, Relation, State, Context. ` +
        `(AC-015)`,
    );
  }
}
