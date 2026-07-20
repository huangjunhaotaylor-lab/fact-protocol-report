/**
 * BSP 1.1 Reality Layer — Express 应用
 */

import express, { Application } from 'express';
import { evidenceRoutes } from './routes/evidence.routes';
import { fragmentRoutes } from './routes/fragment.routes';
import { signalRoutes } from './routes/signal.routes';
import { objectRoutes } from './routes/object.routes';
import { relationRoutes } from './routes/relation.routes';
import { logger } from './utils/logger';

export function createApp(): Application {
  const app = express();

  app.use(express.json());

  // 健康检查
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.2.0', protocol: 'BSP 1.1' });
  });

  // API 路由
  app.use('/api/evidences', evidenceRoutes);
  app.use('/api/fragments', fragmentRoutes);
  app.use('/api/signals', signalRoutes);
  app.use('/api/objects', objectRoutes);
  app.use('/api/relations', relationRoutes);

  // 统一错误处理
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error({ err }, 'Unhandled error');
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    },
  );

  return app;
}
