/**
 * Signal API 路由
 *
 * POST   /api/signals                        — 从 Fragment 创建 Signal
 * GET    /api/signals                        — 获取所有 Signal
 * GET    /api/signals/:id                    — 获取 Signal
 * GET    /api/signals/by-object/:objectId    — 按 Object 查询 Signal
 * GET    /api/signals/by-fragment/:fragmentId — 按 Fragment 查询 Signal
 * POST   /api/signals/:id/verify             — 标记 Signal 为 Verified (Captured → Verified, 12.9)
 * POST   /api/signals/:id/invalid            — 标记 Signal 为 Invalid (Captured → Invalid, 12.10)
 * PATCH  /api/signals/:id/archive            — 归档 Signal (Verified → Archived)
 * GET    /api/signals/:id/fragments          — AC-009: 查看支撑 Signal 的 Fragment
 * GET    /api/signals/:id/trace              — 12.8: Signal → Fragment → Evidence 全链路追溯
 *
 * 注意：协议禁止物理删除 Signal (AC-011)，不提供 DELETE 端点
 */

import { Router, Request, Response } from 'express';
import { signalService } from '../services/signal.service';
import { traceQuery } from '../queries/trace.query';
import { BSPError } from '../utils/errors';

export const signalRoutes = Router();

// 从 Fragment 创建 Signal
signalRoutes.post('/', (req: Request, res: Response) => {
  try {
    const signal = signalService.create(req.body);
    res.status(201).json(signal);
  } catch (error) {
    if (error instanceof BSPError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
  }
});

// 获取所有 Signal
signalRoutes.get('/', (_req: Request, res: Response) => {
  res.json(signalService.getAll());
});

// 按 Object 查询 Signal
signalRoutes.get('/by-object/:objectId', (req: Request, res: Response) => {
  res.json(signalService.getByObject(req.params.objectId));
});

// 按 Fragment 查询 Signal
signalRoutes.get('/by-fragment/:fragmentId', (req: Request, res: Response) => {
  res.json(signalService.getByFragment(req.params.fragmentId));
});

// 获取 Signal
signalRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    res.json(signalService.getById(req.params.id));
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

// 标记 Signal 为 Verified (Captured → Verified)
signalRoutes.post('/:id/verify', (req: Request, res: Response) => {
  try {
    res.json(signalService.verify(req.params.id));
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

// 标记 Signal 为 Invalid (Captured → Invalid，保留不删除)
signalRoutes.post('/:id/invalid', (req: Request, res: Response) => {
  try {
    res.json(signalService.markInvalid(req.params.id));
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

// 归档 Signal (Verified → Archived)
signalRoutes.patch('/:id/archive', (req: Request, res: Response) => {
  try {
    res.json(signalService.archive(req.params.id));
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

// AC-009: 从 Signal 查看支撑它的 Fragment
signalRoutes.get('/:id/fragments', (req: Request, res: Response) => {
  try {
    res.json(traceQuery.getSignalFragments(req.params.id));
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

// 12.8: Signal → Fragment → Evidence 全链路追溯
signalRoutes.get('/:id/trace', (req: Request, res: Response) => {
  try {
    res.json(traceQuery.traceSignal(req.params.id));
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
