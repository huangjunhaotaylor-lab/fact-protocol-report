/**
 * Signal Body 内容校验器
 *
 * 校验 Signal body 是否为合法的事实观察。
 *
 * 规则（文档第 10 节）：
 * - Signal body 不应包含判断类表达
 * - 禁止词汇：存在严重问题、风险较高、建议、应该、需要优化、可能导致、必须改进、不合理、落后、低效
 * - 合法 Signal 应为：主体 + 当前行为 / 当前状态 / 已发生事实
 *
 * 对应需求：10, AC-008
 */

/** 禁止的判断类表达 */
const FORBIDDEN_TERMS: string[] = [
  '存在严重问题',
  '风险较高',
  '建议',
  '应该',
  '需要优化',
  '可能导致',
  '必须改进',
  '不合理',
  '落后',
  '低效',
];

/** 校验结果 */
export interface SignalBodyValidationResult {
  /** 是否通过校验 */
  valid: boolean;
  /** 不通过的原因 */
  reason?: string;
  /** 检测到的禁止词汇 */
  detectedTerms?: string[];
}

/**
 * 校验 Signal body
 *
 * AC-008: Signal body 包含明显建议、风险、结论类表达时，系统必须拒绝或标记为待人工确认
 *
 * @param body Signal body 内容
 * @returns 校验结果
 */
export function validateSignalBody(body: string): SignalBodyValidationResult {
  if (!body || body.trim().length === 0) {
    return {
      valid: false,
      reason: 'Signal body is empty',
    };
  }

  // 检测禁止词汇
  const detectedTerms: string[] = [];
  for (const term of FORBIDDEN_TERMS) {
    if (body.includes(term)) {
      detectedTerms.push(term);
    }
  }

  if (detectedTerms.length > 0) {
    return {
      valid: false,
      reason: `Signal body contains judgmental expressions which are forbidden. ` +
        `Signal must express facts only, not judgments, suggestions, or conclusions.`,
      detectedTerms,
    };
  }

  // 合法：主体 + 当前行为 / 当前状态 / 已发生事实
  return {
    valid: true,
  };
}

/**
 * 获取禁止词汇列表
 */
export function getForbiddenTerms(): string[] {
  return [...FORBIDDEN_TERMS];
}
