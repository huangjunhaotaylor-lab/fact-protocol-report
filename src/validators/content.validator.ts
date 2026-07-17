/**
 * 内容校验器
 *
 * 校验 Fragment.content 是否来自 Evidence 原文
 */

/**
 * 校验 Fragment 内容是否来自 Evidence 原文
 */
export function validateFragmentFromEvidence(
  fragmentContent: string,
  evidenceContent: string,
): boolean {
  return evidenceContent.includes(fragmentContent);
}

/**
 * 校验内容是否被 AI 改写
 * 通过与原始内容对比来判断
 */
export function validateNotAIRewritten(
  content: string,
  originalContent: string,
): boolean {
  return content === originalContent;
}
