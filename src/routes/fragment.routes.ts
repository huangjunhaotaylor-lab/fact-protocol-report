/**
 * Fragment API 路由
 *
 * POST   /api/fragments                       — 从 Evidence 创建 Fragment
 * GET    /api/fragments/:id                   — 获取 Fragment
 * GET    /api/fragments/by-evidence/:evidenceId — 获取 Evidence 的所有 Fragment
 * GET    /api/fragments/:id/location          — 查看 Fragment 在 Evidence 中的位置 (12.4)
 * GET    /api/fragments/:id/verify            — 验证 Fragment 内容校验和
 * PATCH  /api/fragments/:id/archive           — 归档 Fragment (Created → Archived)
 *
 * 注意：Fragment.content 创建后不可修改，不提供 content 更新端点
 */

import { Router, Request, Response } from 'express';
import { fragmentService } from '../services/fragment.service';
import { BSPError } from '../utils/errors';

export const fragmentRoutes = Router();

// 从 Evidence 创建 Fragment
fragmentRoutes.post('/', (req: Request, res: Response) => {
  try {
    const fragment = fragmentService.create(req.body);
    res.status(201).json(fragment);
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
  }
});

// 获取 Evidence 的所有 Fragment
fragmentRoutes.get('/by-evidence/:evidenceId', (req: Request, res: Response) => {
  res.json(fragmentService.getByEvidenceId(req.params.evidenceId));
});

// 获取 Fragment
fragmentRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    res.json(fragmentService.getById(req.params.id));
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

// 12.4: 查看 Fragment 在 Evidence 中的位置
fragmentRoutes.get('/:id/location', (req: Request, res: Response) => {
  try {
    res.json(fragmentService.getLocation(req.params.id));
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

// 验证 Fragment 内容校验和
fragmentRoutes.get('/:id/verify', (req: Request, res: Response) => {
  try {
    res.json({ id: req.params.id, integrity: fragmentService.verifyIntegrity(req.params.id) });
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

// 归档 Fragment (Created → Archived)
fragmentRoutes.patch('/:id/archive', (req: Request, res: Response) => {
  try {
    res.json(fragmentService.archive(req.params.id));
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
