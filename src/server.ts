/**
 * FreeLLM Hub v2 server entry
 */
import { buildApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './util/logger.js';
import { startBackgroundJobs, stopBackgroundJobs } from './services/backgroundJobs.js';
import { closeDb } from './db/connection.js';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`FreeLLM Hub v2 listening on http://${config.host}:${config.port}`);
    startBackgroundJobs();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }

  // 优雅停机: 收到 SIGTERM/SIGINT 后先停止接受新请求,
  // 等待进行中的请求完成, 再关闭后台任务和数据库连接
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');

    stopBackgroundJobs();

    try {
      await app.close();
      logger.info('HTTP server closed');
    } catch (e: any) {
      logger.error({ e }, 'Error closing HTTP server');
    }

    closeDb();
    logger.info('Database closed');
    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
