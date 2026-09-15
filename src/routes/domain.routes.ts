/**
 * Domain API 路由（业务板块 — G0 批次）
 *
 * GET /api/domains — 板块字典 + 计数
 *   返回 { domains: [{ name, keywords, signal_count, object_count }...], unclassified_signals }
 *   含 7 个内置板块 + 数据里出现过的其他板块名
 */

import { Router, Request, Response } from 'express';
import { domainService } from '../services/domain.service';

export const domainRoutes = Router();

// 板块字典 + 计数
domainRoutes.get('/', (_req: Request, res: Response) => {
  res.json(domainService.listDomains());
});
