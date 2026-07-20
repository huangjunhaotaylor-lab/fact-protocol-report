/**
 * Evidence API 路由
 *
 * POST   /api/evidences              — 创建 Evidence
 * GET    /api/evidences              — 获取所有 Evidence
 * GET    /api/evidences/:id          — 获取 Evidence 原文 (12.2)
 * PATCH  /api/evidences/:id/archive  — 归档 Evidence (Created → Archived)
 * GET    /api/evidences/:id/verify   — 验证 Evidence 内容校验和
 * PATCH  /api/evidences/:id/metadata — 更新可选元数据（不涉及 content）
 *
 * 注意：Evidence.content 创建后不可修改 (AC-002)，不提供 content 更新端点
 */

import { Router, Request, Response } from 'express';
import { evidenceService } from '../services/evidence.service';
import { BSPError } from '../utils/errors';

export const evidenceRoutes = Router();

// 创建 Evidence
evidenceRoutes.post('/', (req: Request, res: Response) => {
  try {
    const evidence = evidenceService.create(req.body);
    res.status(201).json(evidence);
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
  }
});

// 获取所有 Evidence
evidenceRoutes.get('/', (_req: Request, res: Response) => {
  res.json(evidenceService.getAll());
});

// 获取 Evidence 原文
evidenceRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    res.json(evidenceService.getById(req.params.id));
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

// 归档 Evidence (Created → Archived)
evidenceRoutes.patch('/:id/archive', (req: Request, res: Response) => {
  try {
    res.json(evidenceService.archive(req.params.id));
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

// 验证 Evidence 内容校验和
evidenceRoutes.get('/:id/verify', (req: Request, res: Response) => {
  try {
    res.json({ id: req.params.id, integrity: evidenceService.verifyIntegrity(req.params.id) });
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

// 更新可选元数据（不涉及 content，AC-002）
evidenceRoutes.patch('/:id/metadata', (req: Request, res: Response) => {
  try {
    res.json(evidenceService.updateMetadata(req.params.id, req.body));
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
