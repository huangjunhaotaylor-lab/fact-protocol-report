/**
 * AI 解读结果缓存
 *
 * - 持久化：data/ai-cache.json（key → 完整响应），原子写
 * - key = sha256( scope + model + 上下文指纹 )，指纹即组装后的上下文文本，
 *   上下文任何字段变化都会改变指纹，从而自然失效
 * - 命中由路由层标记 cached: true
 * - 容量保护：最多 200 条，超出按写入时间淘汰最旧
 *
 * 测试可用 BSP_AI_CACHE_PATH 覆盖文件路径（避免污染真实 data/）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface CachedInterpretation {
  interpretation: string;
  context: { node_count: number; evidence_ids: string[]; signal_ids: string[] };
  truncated?: boolean;
  model: string;
  created_at: string;
}

interface CacheFile {
  entries: Record<string, CachedInterpretation>;
}

const MAX_ENTRIES = 200;

function defaultCachePath(): string {
  return path.resolve(__dirname, '..', '..', 'data', 'ai-cache.json');
}

function resolveCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSP_AI_CACHE_PATH ? path.resolve(env.BSP_AI_CACHE_PATH) : defaultCachePath();
}

function readCache(filePath: string): CacheFile {
  if (!fs.existsSync(filePath)) return { entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<CacheFile>;
    return { entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {} };
  } catch {
    return { entries: {} };
  }
}

function writeCache(filePath: string, cache: CacheFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/** 计算缓存 key：scope（node:{kind}:{id} / view:lens）+ model + 上下文指纹 */
export function aiCacheKey(scope: string, model: string, fingerprint: string): string {
  return createHash('sha256').update(`${scope}\n${model}\n${fingerprint}`).digest('hex');
}

export function getAICache(key: string, env: NodeJS.ProcessEnv = process.env): CachedInterpretation | undefined {
  return readCache(resolveCachePath(env)).entries[key];
}

export function setAICache(
  key: string,
  value: CachedInterpretation,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const filePath = resolveCachePath(env);
  const cache = readCache(filePath);
  cache.entries[key] = value;
  // 容量保护：淘汰最旧
  const keys = Object.keys(cache.entries);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.sort(
      (a, b) =>
        String(cache.entries[a].created_at).localeCompare(String(cache.entries[b].created_at)),
    );
    for (const k of sorted.slice(0, keys.length - MAX_ENTRIES)) {
      delete cache.entries[k];
    }
  }
  writeCache(filePath, cache);
}
