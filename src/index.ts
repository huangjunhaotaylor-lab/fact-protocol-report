/**
 * BSP 1.1 Reality Layer — 应用入口
 *
 * 启动 Express API 服务器
 */

import { createApp } from './app';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = createApp();

app.listen(PORT, () => {
  logger.info(`BSP 1.1 Reality Layer server running on http://localhost:${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});
