/**
 * AI 配置管理（Business Graph OS — AI 解读）
 *
 * - 持久化：data/ai-config.json（{base_url, api_key, model}），原子写
 * - 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL 优先于文件值
 * - 默认：base_url=https://api.openai.com/v1，model=gpt-4o-mini
 * - 安全约束：api_key 永不进日志、永不出现在任何 API 响应中
 *
 * 测试可用 BSP_AI_CONFIG_PATH 覆盖文件路径（避免污染真实 data/）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { ValidationError } from '../utils/errors';

export interface AIConfigFile {
  base_url?: string;
  api_key?: string;
  model?: string;
}

export interface AIConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface AIStatus {
  configured: boolean;
  base_url: string;
  model: string;
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o-mini';

/** 默认配置路径：<repo>/data/ai-config.json（src/ 与 dist/ 下均解析到仓库根） */
export function defaultAIConfigPath(): string {
  return path.resolve(__dirname, '..', '..', 'data', 'ai-config.json');
}

/** 解析配置路径：BSP_AI_CONFIG_PATH 优先（惰性解析，便于测试注入） */
export function resolveAIConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSP_AI_CONFIG_PATH ? path.resolve(env.BSP_AI_CONFIG_PATH) : defaultAIConfigPath();
}

/** 读取配置文件（不存在 / 损坏 → 空配置，不抛错） */
function readFileConfig(filePath: string): AIConfigFile {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AIConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 原子写配置文件 */
function writeFileConfig(filePath: string, cfg: AIConfigFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * 生效配置：环境变量 > 文件 > 默认值
 * 注意：返回值含 api_key，仅限服务端内部使用，禁止序列化进响应 / 日志
 */
export function getAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const file = readFileConfig(resolveAIConfigPath(env));
  return {
    base_url: env.AI_BASE_URL || file.base_url || DEFAULT_BASE_URL,
    api_key: env.AI_API_KEY || file.api_key || '',
    model: env.AI_MODEL || file.model || DEFAULT_MODEL,
  };
}

/** 状态（对外）：永不包含 api_key */
export function getAIStatus(env: NodeJS.ProcessEnv = process.env): AIStatus {
  const cfg = getAIConfig(env);
  return {
    configured: cfg.api_key.length > 0,
    base_url: cfg.base_url,
    model: cfg.model,
  };
}

/**
 * 更新配置并持久化到文件
 * - 仅接受非空字符串字段；base_url 必须是 http(s) URL
 * - 未提供的字段保留文件原值
 * @returns 更新后的对外状态（不含 key）
 */
export function updateAIConfig(
  updates: { base_url?: unknown; api_key?: unknown; model?: unknown },
  env: NodeJS.ProcessEnv = process.env,
): AIStatus {
  const filePath = resolveAIConfigPath(env);
  const file = readFileConfig(filePath);
  const next: AIConfigFile = { ...file };

  if (updates.base_url !== undefined) {
    if (typeof updates.base_url !== 'string' || !updates.base_url.trim()) {
      throw new ValidationError('base_url 必须是非空字符串', ['base_url']);
    }
    const url = updates.base_url.trim();
    if (!/^https?:\/\//.test(url)) {
      throw new ValidationError('base_url 必须以 http:// 或 https:// 开头', ['base_url']);
    }
    next.base_url = url.replace(/\/+$/, '');
  }
  if (updates.api_key !== undefined) {
    if (typeof updates.api_key !== 'string' || !updates.api_key.trim()) {
      throw new ValidationError('api_key 必须是非空字符串', ['api_key']);
    }
    next.api_key = updates.api_key.trim();
  }
  if (updates.model !== undefined) {
    if (typeof updates.model !== 'string' || !updates.model.trim()) {
      throw new ValidationError('model 必须是非空字符串', ['model']);
    }
    next.model = updates.model.trim();
  }

  writeFileConfig(filePath, next);
  return getAIStatus(env);
}
