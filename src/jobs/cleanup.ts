import { markExpiredMessages } from '@/services/message.service';
import { logger } from '@/utils/logger';

const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

async function runCleanup(): Promise<void> {
  try {
    const expiredCount = await markExpiredMessages();
    if (expiredCount > 0) {
      logger.info('Cleanup completed', { expiredCount });
    }
  } catch (error) {
    logger.error('Cleanup job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export function startCleanupJob(): void {
  if (cleanupTimer) {
    logger.warn('Cleanup job already running');
    return;
  }

  logger.info('Starting cleanup job', { intervalMs: CLEANUP_INTERVAL_MS });

  // Run immediately on startup
  runCleanup();

  // Then run every minute
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info('Cleanup job stopped');
  }
}
