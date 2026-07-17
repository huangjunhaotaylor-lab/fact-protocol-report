/**
 * Object API 路由
 *
 * POST   /api/objects              — 创建 Object
 * GET    /api/objects              — 获取所有 Object
 * GET    /api/objects/:id          — 获取 Object
 * PATCH  /api/objects/:id/activate — 激活 Object
 * PATCH  /api/objects/:id/archive  — 归档 Object
 * POST   /api/objects/:id/merge    — 合并 Object
 * GET    /api/objects/:id/signals  — 获取 Object 关联的 Signal (AC-012)
 * GET    /api/objects/:id/timeline — 获取 Object 的 Timeline (AC-014)
 */

import { Router, Request, Response } from 'express';
import { objectService } from '../services/object.service';
import { objectSignalsQuery } from '../queries/object-signals.query';
import { timelineQuery } from '../queries/timeline.query';
import { BSPError } from '../utils/errors';

export const objectRoutes = Router();

// 创建 Object
objectRoutes.post('/', (req: Request, res: Response) => {
  try {
    const obj = objectService.create(req.body);
    res.status(201).json(obj);
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
  }
});

// 获取所有 Object
objectRoutes.get('/', (_req: Request, res: Response) => {
  res.json(objectService.getAll());
});

// 获取 Object
objectRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    res.json(objectService.getById(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// 激活 Object
objectRoutes.patch('/:id/activate', (req: Request, res: Response) => {
  try {
    res.json(objectService.activate(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// 归档 Object
objectRoutes.patch('/:id/archive', (req: Request, res: Response) => {
  try {
    res.json(objectService.archive(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// 合并 Object
objectRoutes.post('/:id/merge', (req: Request, res: Response) => {
  try {
    const { merge_into } = req.body;
    res.json(objectService.merge(req.params.id, merge_into));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// AC-012: Object 可以关联多个 Signal
// 12.11: 查看 Object 关联的 Signal 列表
objectRoutes.get('/:id/signals', (req: Request, res: Response) => {
  try {
    res.json(objectSignalsQuery.getByObject(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});

// AC-014: Timeline 只能由 Signal 生成
objectRoutes.get('/:id/timeline', (req: Request, res: Response) => {
  try {
    res.json(timelineQuery.getTimelineWithSignals(req.params.id));
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
    }
  }
});
