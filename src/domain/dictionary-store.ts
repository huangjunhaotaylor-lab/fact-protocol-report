/**
 * 板块关键词字典持久化 — G3 批次
 *
 * 职责：板块关键词字典的「读取（带缓存）/ 写入（整体替换某板块关键词）」
 *
 * 存储：
 * - 文件 `data/domain-dictionary.json`（可用 BSP_DOMAIN_DICTIONARY_PATH 覆盖）
 * - 文件格式为纯映射 `{ [板块名]: 关键词[] }`，便于人工直接编辑
 * - 写入原子落盘：临时文件 + rename（与 JsonFileStore 同一约定）
 *
 * 读取优先级（classifier / domain.service 统一走 loadDictionary）：
 * 1. 内存缓存（写入后失效）
 * 2. 持久化文件（不存在 → 用内置字典初始化并尝试落盘；损坏 → 回退内置 + 告警）
 * 3. 内置字典 dictionary.ts
 *
 * 测试环境（VITEST / NODE_ENV=test）且未显式指定 BSP_DOMAIN_DICTIONARY_PATH：
 * 纯内存读写，不触碰真实文件（与 repositories 的持久化开关同一约定）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { DOMAIN_DICTIONARY } from './dictionary';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

/** 默认字典路径：<repo>/data/domain-dictionary.json（src/ 与 dist/ 下均解析到仓库根） */
export function defaultDictionaryPath(): string {
  return path.resolve(__dirname, '..', '..', 'data', 'domain-dictionary.json');
}

/** 解析字典路径：BSP_DOMAIN_DICTIONARY_PATH 优先，其次默认路径 */
export function resolveDictionaryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSP_DOMAIN_DICTIONARY_PATH
    ? path.resolve(env.BSP_DOMAIN_DICTIONARY_PATH)
    : defaultDictionaryPath();
}

/** 是否应落盘：非测试环境；或测试环境但显式指定了路径（用于持久化行为测试） */
function shouldPersist(env: NodeJS.ProcessEnv = process.env): boolean {
  const isTestEnv = Boolean(env.VITEST) || env.NODE_ENV === 'test';
  return !isTestEnv || Boolean(env.BSP_DOMAIN_DICTIONARY_PATH);
}

/** 内存缓存（null = 未加载 / 已失效） */
let cache: Record<string, string[]> | null = null;

/** 深拷贝内置字典 */
function cloneBuiltin(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, keywords] of Object.entries(DOMAIN_DICTIONARY)) {
    out[name] = [...keywords];
  }
  return out;
}

/** 校验并规范化一份字典映射；非法返回 null */
function parseDictionary(raw: unknown): Record<string, string[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [name, keywords] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim()) return null;
    if (!Array.isArray(keywords) || keywords.some((k) => typeof k !== 'string' || !k.trim())) {
      return null;
    }
    out[name] = (keywords as string[]).map((k) => k.trim());
  }
  return out;
}

/** 原子落盘（临时文件 + rename） */
function writeDictionaryFile(file: string, dict: Record<string, string[]>): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(dict, null, 2), 'utf8');
  fs.renameSync(tmpPath, file);
}

/**
 * 读取当前生效字典（带缓存）
 * - 缓存命中直接返回
 * - 文件存在且合法 → 用文件内容
 * - 文件不存在 → 内置字典初始化（非测试环境尝试落盘，生成可编辑的初始文件）
 * - 文件损坏 → 回退内置 + 告警（不覆盖原文件，留待人工处理）
 */
export function loadDictionary(): Record<string, string[]> {
  if (cache) return cache;

  const file = resolveDictionaryPath();
  if (fs.existsSync(file)) {
    try {
      const parsed = parseDictionary(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (parsed) {
        cache = parsed;
        return cache;
      }
      logger.warn(`DictionaryStore: file ${file} has invalid shape, falling back to builtin`);
    } catch (err) {
      logger.warn({ err }, `DictionaryStore: file ${file} is corrupted, falling back to builtin`);
    }
    cache = cloneBuiltin();
    return cache;
  }

  // 文件不存在：内置字典初始化
  cache = cloneBuiltin();
  if (shouldPersist()) {
    try {
      writeDictionaryFile(file, cache);
      logger.info(`DictionaryStore: initialized dictionary file at ${file} from builtin`);
    } catch (err) {
      // 落盘失败不影响运行（下次启动重试初始化）
      logger.error({ err }, `DictionaryStore: failed to initialize dictionary file ${file}`);
    }
  }
  return cache;
}

/** 使缓存失效（写入后 / 测试隔离用） */
export function invalidateDictionaryCache(): void {
  cache = null;
}

/**
 * 整体替换某板块的关键词数组（upsert）
 * - name：非空字符串（板块名，允许字典外新板块）
 * - keywords：非空字符串数组（元素去空白、去重；至少 1 个）
 * - 写入后缓存失效并原子落盘（测试环境未指定路径时仅更新内存）
 * @returns 该板块最终生效的关键词数组
 */
export function setDomainKeywords(name: unknown, keywords: unknown): string[] {
  if (typeof name !== 'string' || !name.trim()) {
    throw new ValidationError('domain name must be a non-empty string', ['name']);
  }
  const domain = name.trim();

  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new ValidationError('keywords must be a non-empty array of non-empty strings', [
      'keywords',
    ]);
  }
  if (keywords.some((k) => typeof k !== 'string' || !k.trim())) {
    throw new ValidationError('keywords must be a non-empty array of non-empty strings', [
      'keywords',
    ]);
  }
  const cleaned = Array.from(new Set((keywords as string[]).map((k) => k.trim())));

  const dict = loadDictionary();
  dict[domain] = cleaned;

  if (shouldPersist()) {
    writeDictionaryFile(resolveDictionaryPath(), dict);
  }
  invalidateDictionaryCache();
  logger.info(`DictionaryStore: keywords updated for domain ${domain} (${cleaned.length} keywords)`);
  return cleaned;
}
