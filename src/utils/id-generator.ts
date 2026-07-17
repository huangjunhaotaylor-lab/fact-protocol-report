/**
 * ID 生成器
 *
 * 按 BSP 规范生成带前缀的唯一 ID
 * 格式：PREFIX-XXXXXXXX（8位随机字符）
 */

const PREFIXES = {
  Evidence: 'EV',
  Fragment: 'FRG',
  Signal: 'SIG',
  Object: 'OBJ',
  Identity: 'IDT',
  Relation: 'REL',
  State: 'ST',
} as const;

type EntityType = keyof typeof PREFIXES;

/**
 * 生成带前缀的唯一 ID
 * @param type 实体类型
 * @returns 如 "EV-a1b2c3d4"
 */
export function generateId(type: EntityType): string {
  const prefix = PREFIXES[type];
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

/**
 * 生成带前缀的自定义 ID
 * @param prefix 前缀
 * @param name 名称（用于生成有意义的 ID）
 * @returns 如 "OBJ-INVENTORY-PROCESS"
 */
export function generateNamedId(prefix: string, name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${prefix}-${slug}`;
}
