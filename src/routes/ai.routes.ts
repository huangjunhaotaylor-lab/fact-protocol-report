/**
 * AI 解读 API 路由（Business Graph OS — AI 解读）
 *
 * GET  /api/ai/status          — 配置状态（永不返回 api_key）
 * PUT  /api/ai/config          — 更新配置 {base_url?, api_key?, model?}（持久化到 data/ai-config.json）
 * POST /api/ai/interpret       — 单节点解读 {kind, id}
 * POST /api/ai/interpret-view  — 视图级解读 {node_ids, lens?}
 *
 * 解读结果缓存于 data/ai-cache.json（key = scope+model+上下文指纹），命中标 cached: true。
 * 纯增量路由：只读五个 Repository，不改动任何现有路由。
 */

import { Router, Request, Response } from 'express';
import { getAIConfig, getAIStatus, updateAIConfig } from '../ai/config';
import { AINotConfiguredError, callLLM } from '../ai/llm';
import { buildNodeContext, buildViewContext, AssembledContext, ViewLens } from '../ai/context';
import { AI_SYSTEM_PROMPT } from '../ai/prompt';
import { aiCacheKey, getAICache, setAICache, CachedInterpretation } from '../ai/cache';
import { BSPError } from '../utils/errors';

export const aiRoutes = Router();

// 配置状态（永不回显 key）
aiRoutes.get('/status', (_req: Request, res: Response) => {
  res.json(getAIStatus());
});

// 更新配置
aiRoutes.put('/config', (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { base_url?: unknown; api_key?: unknown; model?: unknown };
    res.json(updateAIConfig(body));
  } catch (error) {
    handleError(error, res);
  }
});

interface InterpretResponse extends CachedInterpretation {
  cached?: boolean;
}

/**
 * 解读主流程：组装上下文 → 查缓存 → 调 LLM → 写缓存
 */
async function runInterpretation(
  scope: string,
  userPrompt: string,
  assembled: AssembledContext,
): Promise<InterpretResponse> {
  const cfg = getAIConfig();
  if (!cfg.api_key) throw new AINotConfiguredError();

  const key = aiCacheKey(scope, cfg.model, assembled.fingerprint);
  const cached = getAICache(key);
  if (cached) {
    return { ...cached, cached: true };
  }

  const interpretation = await callLLM(cfg, [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);

  const result: CachedInterpretation = {
    interpretation,
    context: {
      node_count: assembled.node_count,
      evidence_ids: assembled.evidence_ids,
      signal_ids: assembled.signal_ids,
    },
    ...(assembled.truncated ? { truncated: true } : {}),
    model: cfg.model,
    created_at: new Date().toISOString(),
  };
  setAICache(key, result);
  return { ...result };
}

// 单节点解读
aiRoutes.post('/interpret', async (req: Request, res: Response) => {
  try {
    const { kind, id } = (req.body ?? {}) as { kind?: unknown; id?: unknown };
    if (typeof kind !== 'string' || typeof id !== 'string' || !id) {
      res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'body 必须包含 kind 与 id（字符串）' },
      });
      return;
    }
    const assembled = buildNodeContext(kind, id);
    const userPrompt = `请解读以下 BSP 图节点（${kind} ${id}）及其证据链材料：\n\n${assembled.text}`;
    res.json(await runInterpretation(`node:${kind}:${id}`, userPrompt, assembled));
  } catch (error) {
    handleError(error, res);
  }
});

// 视图级解读
aiRoutes.post('/interpret-view', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { node_ids?: unknown; lens?: unknown };
    if (!Array.isArray(body.node_ids) || body.node_ids.length === 0) {
      res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'body.node_ids 必须是非空字符串数组' },
      });
      return;
    }
    const nodeIds = body.node_ids.filter((x): x is string => typeof x === 'string');
    const lens = sanitizeLens(body.lens);
    const assembled = buildViewContext(nodeIds, lens);
    const userPrompt = `请解读以下 BSP 图当前视图（共 ${assembled.node_count} 个节点）的整体材料：\n\n${assembled.text}`;
    const scope = `view:${lens?.domain ?? ''}:${lens?.time_window ? lens.time_window.join('-') : ''}`;
    res.json(await runInterpretation(scope, userPrompt, assembled));
  } catch (error) {
    handleError(error, res);
  }
});

function sanitizeLens(raw: unknown): ViewLens | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const lens: ViewLens = {};
  if (typeof obj.domain === 'string' && obj.domain) lens.domain = obj.domain;
  if (
    Array.isArray(obj.time_window) &&
    obj.time_window.length === 2 &&
    obj.time_window.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    lens.time_window = [obj.time_window[0] as number, obj.time_window[1] as number];
  }
  return lens;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof BSPError) {
    res.status(error.statusCode).json(error.toJSON());
  } else {
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
  }
}
