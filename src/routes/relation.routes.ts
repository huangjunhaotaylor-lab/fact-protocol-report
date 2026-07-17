/**
 * Relation API 路由
 *
 * POST   /api/relations            — 创建 Relation
 * GET    /api/relations            — 获取所有 Relation
 * GET    /api/relations/:id        — 获取 Relation
 * GET    /api/relations/by-object/:objectId — 按 Object 查询关联的 Relation
 * GET    /api/relations/:id/signal — AC-013: 查看 Relation 的 derived_from Signal
 */

import { Router, Request, Response } from 'express';
import { relationService } from '../services/relation.service';
import { BSPError } from '../utils/errors';

export const relationRoutes = Router();

// 创建 Relation
relationRoutes.post('/', (req: Request, res: Response) => {
  try {
    const relation = relationService.create(req.body);
    res.status(201).json(relation);
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
  }
});

// 获取所有 Relation
relationRoutes.get('/', (_req: Request, res: Response) => {
  res.json(relationService.getAll());
});

// 按 Object 查询关联的 Relation
relationRoutes.get('/by-object/:objectId', (req: Request, res: Response) => {
  res.json(relationService.getByObject(req.params.objectId));
});

// 获取 Relation
relationRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    res.json(relationService.getById(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// AC-013: Relation 必须能追溯到 derived_from Signal
relationRoutes.get('/:id/signal', (req: Request, res: Response) => {
  try {
    res.json(relationService.getDerivedFromSignal(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});
