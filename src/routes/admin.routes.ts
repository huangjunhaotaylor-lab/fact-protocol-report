/**
 * Admin API 路由（管理操作 — G0 批次）
 *
 * POST /api/admin/reclassify — 存量回填：
 *   对所有 domain_manual !== true 的信号重跑板块分类器，再重算全部 Object 传导。
 *   幂等；返回 { reclassified, skipped_manual, distribution }
 */

import { Router, Request, Response } from 'express';
import { domainService } from '../services/domain.service';
import { BSPError } from '../utils/errors';

export const adminRoutes = Router();

// 存量板块回填（幂等）
adminRoutes.post('/reclassify', (_req: Request, res: Response) => {
  try {
    res.json(domainService.reclassifyAll());
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});
