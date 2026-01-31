import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { ServiceError } from '@/errors/service.error';
import { authMiddleware } from '@/middleware/auth';
import { rateLimitMiddleware } from '@/middleware/rate-limit';
import {
  createOutboundMessage,
  findInboundMessageById,
  getQueuedMessages,
} from '@/services/message.service';
import { waitForMessages } from '@/services/polling.service';
import { kakaoCallbackResponseSchema } from '@/types/kakao';
import { logger } from '@/utils/logger';

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  wait: z.coerce.number().int().min(0).max(30).optional().default(0),
});

const replyBodySchema = z.object({
  messageId: z.string().uuid(),
  response: kakaoCallbackResponseSchema,
});

export const openclawRoutes = new Hono();

// Apply middleware to all routes
openclawRoutes.use('*', authMiddleware(), rateLimitMiddleware());

openclawRoutes.get(
  '/messages',
  zValidator('query', messagesQuerySchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid query parameters', { errors: result.error });
      return c.json({ error: 'Invalid query parameters' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { limit, wait } = c.req.valid('query');

    try {
      const messages =
        wait > 0
          ? await waitForMessages(account.id, { timeoutSeconds: wait, limit })
          : await getQueuedMessages(account.id, limit);

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        payload: msg.kakaoPayload,
        callbackUrl: msg.callbackUrl,
        callbackExpiresAt: msg.callbackExpiresAt?.toISOString() || null,
        createdAt: msg.createdAt.toISOString(),
      }));

      return c.json(
        {
          messages: formattedMessages,
          hasMore: messages.length === limit,
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      logger.error('Failed to fetch messages', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

openclawRoutes.post(
  '/reply',
  zValidator('json', replyBodySchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid request body', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { messageId, response } = c.req.valid('json');

    try {
      const inboundMessage = await findInboundMessageById(messageId);
      if (!inboundMessage) {
        return c.json({ error: 'Message not found' }, HTTP_STATUS.NOT_FOUND);
      }
      if (inboundMessage.accountId !== account.id) {
        logger.warn('Unauthorized reply attempt', {
          messageId,
          messageAccountId: inboundMessage.accountId,
          requestAccountId: account.id,
        });
        return c.json({ error: 'Message not found' }, HTTP_STATUS.NOT_FOUND);
      }

      const outbound = await createOutboundMessage({
        accountId: account.id,
        inboundMessageId: messageId,
        kakaoTarget: {},
        responsePayload: response,
      });

      logger.info('Reply created', {
        outboundId: outbound.id,
        messageId,
        accountId: account.id,
      });

      return c.json(
        {
          success: true,
          outboundMessageId: outbound.id,
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      if (error instanceof ServiceError) {
        const statusCode = error.statusCode as 400 | 401 | 403 | 404 | 500;
        return c.json({ error: error.message }, statusCode);
      }

      logger.error('Failed to send reply', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId,
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);
