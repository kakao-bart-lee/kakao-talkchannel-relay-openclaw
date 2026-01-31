import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { env } from '@/config/env';
import { db } from '@/db';
import {
  type InboundMessage,
  inboundMessages,
  type OutboundMessage,
  outboundMessages,
} from '@/db/schema';
import { ErrorCodes, ServiceError } from '@/errors/service.error';
import { logger } from '@/utils/logger';

export interface CreateInboundMessageInput {
  accountId: string;
  conversationKey: string;
  kakaoPayload: Record<string, unknown>;
  callbackUrl: string | null;
  callbackExpiresAt: Date | null;
  normalizedMessage?: Record<string, unknown>;
  sourceEventId?: string;
}

export interface CreateOutboundMessageInput {
  accountId: string;
  conversationKey: string;
  inboundMessageId?: string;
  kakaoTarget: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}

export async function createInboundMessage(
  data: CreateInboundMessageInput
): Promise<InboundMessage> {
  logger.info('Creating inbound message', {
    accountId: data.accountId,
    hasCallback: !!data.callbackUrl,
  });

  const [message] = await db
    .insert(inboundMessages)
    .values({
      accountId: data.accountId,
      conversationKey: data.conversationKey,
      kakaoPayload: data.kakaoPayload,
      callbackUrl: data.callbackUrl,
      callbackExpiresAt: data.callbackExpiresAt,
      normalizedMessage: data.normalizedMessage,
      sourceEventId: data.sourceEventId,
      status: 'queued',
    })
    .returning();

  if (!message) {
    throw new ServiceError(ErrorCodes.MESSAGE_NOT_FOUND, 'Failed to create inbound message', 500);
  }

  logger.info('Inbound message created', {
    messageId: message.id,
    accountId: message.accountId,
  });

  return message;
}

export async function findInboundMessageById(id: string): Promise<InboundMessage | null> {
  const [message] = await db
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, id))
    .limit(1);

  return message || null;
}

export async function getQueuedMessages(
  accountId: string,
  limit: number = 20
): Promise<InboundMessage[]> {
  logger.debug('Fetching queued messages', { accountId, limit });

  const messages = await db
    .select()
    .from(inboundMessages)
    .where(and(eq(inboundMessages.status, 'queued'), eq(inboundMessages.accountId, accountId)))
    .orderBy(asc(inboundMessages.createdAt))
    .limit(limit);

  logger.debug('Queued messages fetched', {
    accountId,
    count: messages.length,
  });

  return messages;
}

export async function markMessageDelivered(id: string): Promise<InboundMessage> {
  logger.info('Marking message as delivered', { messageId: id });

  const [message] = await db
    .update(inboundMessages)
    .set({
      status: 'delivered',
      deliveredAt: sql`NOW()`,
    })
    .where(eq(inboundMessages.id, id))
    .returning();

  if (!message) {
    logger.warn('Message not found for delivery', { messageId: id });
    throw new ServiceError(ErrorCodes.MESSAGE_NOT_FOUND, 'Message not found', 404, {
      messageId: id,
    });
  }

  logger.info('Message marked as delivered', {
    messageId: message.id,
    deliveredAt: message.deliveredAt,
  });

  return message;
}

export async function markExpiredMessages(): Promise<number> {
  logger.info('Marking expired messages', {
    ttlSeconds: env.QUEUE_TTL_SECONDS,
  });

  const result = await db
    .update(inboundMessages)
    .set({
      status: 'expired',
    })
    .where(
      and(
        eq(inboundMessages.status, 'queued'),
        lt(inboundMessages.createdAt, sql`NOW() - INTERVAL '1 second' * ${env.QUEUE_TTL_SECONDS}`)
      )
    );

  const count = (result as unknown as { rowCount: number }).rowCount ?? 0;

  logger.info('Expired messages marked', { count });

  return count;
}

export async function createOutboundMessage(
  data: CreateOutboundMessageInput
): Promise<OutboundMessage> {
  logger.info('Creating outbound message', {
    accountId: data.accountId,
    inboundMessageId: data.inboundMessageId,
  });

  const [message] = await db
    .insert(outboundMessages)
    .values({
      accountId: data.accountId,
      conversationKey: data.conversationKey,
      inboundMessageId: data.inboundMessageId,
      kakaoTarget: data.kakaoTarget,
      responsePayload: data.responsePayload,
      status: 'pending',
    })
    .returning();

  if (!message) {
    throw new ServiceError(ErrorCodes.MESSAGE_NOT_FOUND, 'Failed to create outbound message', 500);
  }

  logger.info('Outbound message created', {
    messageId: message.id,
    accountId: message.accountId,
  });

  return message;
}

export async function markOutboundSent(id: string): Promise<OutboundMessage> {
  logger.info('Marking outbound message as sent', { messageId: id });

  const [message] = await db
    .update(outboundMessages)
    .set({
      status: 'sent',
      sentAt: sql`NOW()`,
    })
    .where(eq(outboundMessages.id, id))
    .returning();

  if (!message) {
    logger.warn('Outbound message not found', { messageId: id });
    throw new ServiceError(ErrorCodes.MESSAGE_NOT_FOUND, 'Outbound message not found', 404, {
      messageId: id,
    });
  }

  logger.info('Outbound message marked as sent', {
    messageId: message.id,
    sentAt: message.sentAt,
  });

  return message;
}

export async function markOutboundFailed(
  id: string,
  errorMessage: string
): Promise<OutboundMessage> {
  logger.info('Marking outbound message as failed', {
    messageId: id,
    error: errorMessage,
  });

  const [message] = await db
    .update(outboundMessages)
    .set({
      status: 'failed',
      errorMessage,
    })
    .where(eq(outboundMessages.id, id))
    .returning();

  if (!message) {
    logger.warn('Outbound message not found', { messageId: id });
    throw new ServiceError(ErrorCodes.MESSAGE_NOT_FOUND, 'Outbound message not found', 404, {
      messageId: id,
    });
  }

  logger.info('Outbound message marked as failed', {
    messageId: message.id,
    errorMessage: message.errorMessage,
  });

  return message;
}

export async function acknowledgeMessages(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;

  logger.info('Acknowledging messages', { count: messageIds.length });

  const result = await db
    .update(inboundMessages)
    .set({
      status: 'acked',
      ackedAt: sql`NOW()`,
    })
    .where(
      and(sql`${inboundMessages.id} = ANY(${messageIds})`, eq(inboundMessages.status, 'delivered'))
    );

  const count = (result as unknown as { rowCount: number }).rowCount ?? 0;

  logger.info('Messages acknowledged', { count });

  return count;
}
