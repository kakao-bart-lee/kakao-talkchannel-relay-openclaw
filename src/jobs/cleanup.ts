import { markExpiredMessages } from '@/services/message.service';
import { cleanupExpiredSessions } from '@/services/session.service';
import { logger } from '@/utils/logger';

const CLEANUP_INTERVAL_MS = 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

async function runCleanup(): Promise<void> {
  try {
    const [expiredMessages, expiredSessions] = await Promise.all([
      markExpiredMessages(),
      cleanupExpiredSessions(),
    ]);

    if (expiredMessages > 0 || expiredSessions > 0) {
      logger.info('Cleanup completed', { expiredMessages, expiredSessions });
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
