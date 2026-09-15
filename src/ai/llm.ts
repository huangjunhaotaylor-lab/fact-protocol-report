/**
 * LLM 调用层（OpenAI 兼容 chat completions）
 *
 * - POST {base_url}/chat/completions，Bearer 鉴权，30s 超时
 * - 失败包装为友好错误：401 → 配置鉴权问题 / 超时 / 其他
 * - callLLM 通过 setLLMCaller 可整体替换（测试注入假 LLM）
 * - 安全约束：错误信息与日志均不得包含 api_key
 */

import { BSPError } from '../utils/errors';
import { AIConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** AI 调用错误（友好信息，不带敏感数据） */
export class AICallError extends BSPError {
  constructor(message: string, code = 'AI_CALL_FAILED', statusCode = 502) {
    super(message, code, statusCode);
  }
}

/** 未配置错误（503，前端据此弹配置引导） */
export class AINotConfiguredError extends BSPError {
  constructor() {
    super('AI 服务未配置：请先设置 API Key（可点浮层右上角齿轮）', 'AI_NOT_CONFIGURED', 503);
  }
}

export type LLMCaller = (
  cfg: AIConfig,
  messages: ChatMessage[],
) => Promise<string>;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/** 默认实现：真实 HTTP 调用（30s 超时） */
const defaultCaller: LLMCaller = async (cfg, messages) => {
  const url = `${cfg.base_url.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new AICallError(
        `AI 服务鉴权失败（HTTP ${res.status}）：请检查 API Key 是否正确、是否过期`,
        'AI_AUTH_FAILED',
        502,
      );
    }
    if (!res.ok) {
      throw new AICallError(
        `AI 服务返回错误（HTTP ${res.status}），请稍后重试或检查配置`,
        'AI_HTTP_ERROR',
        502,
      );
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AICallError('AI 服务返回了空结果，请重试', 'AI_EMPTY_RESPONSE', 502);
    }
    return content;
  } catch (err) {
    if (err instanceof AICallError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AICallError('AI 服务响应超时（30s），请稍后重试', 'AI_TIMEOUT', 504);
    }
    throw new AICallError(
      `无法连接 AI 服务：${(err as Error).message}，请检查 base_url 与网络`,
      'AI_NETWORK_ERROR',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
};

let caller: LLMCaller = defaultCaller;

/** 替换 LLM 调用实现（传 null 恢复默认）—— 测试注入假 LLM 用 */
export function setLLMCaller(fn: LLMCaller | null): void {
  caller = fn ?? defaultCaller;
}

/** 调用 LLM，返回文本结果 */
export function callLLM(cfg: AIConfig, messages: ChatMessage[]): Promise<string> {
  return caller(cfg, messages);
}
