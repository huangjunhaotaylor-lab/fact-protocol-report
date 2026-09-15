/**
 * Domain API 路由（业务板块 — G0 批次，G3 扩充）
 *
 * GET /api/domains — 板块字典 + 计数
 *   返回 { domains: [{ name, keywords, signal_count, object_count }...], unclassified_signals }
 *   含当前生效字典全部板块 + 数据里出现过的其他板块名
 *
 * GET /api/domains/:name/keywords — G3：读取某板块关键词（字典外板块返回空数组）
 * PUT /api/domains/:name/keywords — G3：整体替换该板块关键词数组
 *   body { keywords: string[] }（非空字符串数组），持久化到 data/domain-dictionary.json
 *
 * POST /api/classify-preview — G3：分类实时预览（不落库）
 *   body { body: string } → { domains, primary_domain, domain_scores }
 */

import { Router, Request, Response } from 'express';
import { domainService } from '../services/domain.service';
import { classifyDomains } from '../domain/classifier';
import { BSPError, ValidationError } from '../utils/errors';

export const domainRoutes = Router();

/** 统一错误响应 */
function handleError(error: unknown, res: Response): void {
  if (error instanceof BSPError) {
    res.status(error.statusCode).json(error.toJSON());
  } else {
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
  }
}

// 板块字典 + 计数
domainRoutes.get('/', (_req: Request, res: Response) => {
  res.json(domainService.listDomains());
});

// G3：读取某板块关键词
domainRoutes.get('/:name/keywords', (req: Request, res: Response) => {
  try {
    res.json(domainService.getKeywords(req.params.name));
  } catch (error) {
    handleError(error, res);
  }
});

// G3：整体替换某板块关键词数组（持久化到 data/domain-dictionary.json）
domainRoutes.put('/:name/keywords', (req: Request, res: Response) => {
  try {
    const { keywords } = req.body ?? {};
    res.json(domainService.updateKeywords(req.params.name, keywords));
  } catch (error) {
    handleError(error, res);
  }
});

/**
 * G3：分类实时预览（不落库）— 供录入台输入时即时反馈
 * 挂在 /api 下：POST /api/classify-preview
 */
export const classifyPreviewRoute = Router();

classifyPreviewRoute.post('/classify-preview', (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}).body;
    if (typeof body !== 'string') {
      throw new ValidationError('body must be a string', ['body']);
    }
    res.json(classifyDomains(body));
  } catch (error) {
    handleError(error, res);
  }
});
