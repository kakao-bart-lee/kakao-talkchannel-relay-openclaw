import { app } from './app';
import { env } from './config/env';
import { closeDatabase } from './db';
import { startCleanupJob, stopCleanupJob } from './jobs/cleanup';
import { logger } from './utils/logger';

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

startCleanupJob();

logger.info('Server started', {
  port: env.PORT,
  env: env.NODE_ENV,
  url: `http://localhost:${env.PORT}`,
});

async function shutdown() {
  logger.info('Shutting down...');
  stopCleanupJob();
  await closeDatabase();
  server.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
