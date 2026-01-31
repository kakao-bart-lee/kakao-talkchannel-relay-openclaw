import { env } from '@/config/env';
import type { InboundMessage } from '@/db/schema';
import { getQueuedMessages, markMessageDelivered } from '@/services/message.service';
import { logger } from '@/utils/logger';

export interface PollOptions {
  timeoutSeconds?: number;
  limit?: number;
}

export async function waitForMessages(
  accountId: string,
  options?: PollOptions
): Promise<InboundMessage[]> {
  const timeoutMs = (options?.timeoutSeconds ?? env.MAX_POLL_WAIT_SECONDS) * 1000;
  const limit = options?.limit ?? 20;

  logger.info('Starting long poll', { accountId, timeoutMs, limit });

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const messages = await getQueuedMessages(accountId, limit);

    if (messages.length > 0) {
      logger.info('Messages found', { accountId, count: messages.length });

      for (const msg of messages) {
        await markMessageDelivered(msg.id);
      }

      return messages.map((msg) => ({
        ...msg,
        status: 'delivered' as const,
        deliveredAt: new Date(),
      }));
    }

    await Bun.sleep(500);
  }

  const elapsed = Date.now() - startTime;
  logger.debug('Poll timeout', { accountId, elapsed });

  return [];
}
