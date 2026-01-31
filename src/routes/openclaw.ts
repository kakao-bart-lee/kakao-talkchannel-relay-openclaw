import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { ServiceError } from '@/errors/service.error';
import { authMiddleware } from '@/middleware/auth';
import { rateLimitMiddleware } from '@/middleware/rate-limit';
import { listConversationsByAccount } from '@/services/conversation.service';
import { sendCallback } from '@/services/kakao.service';
import {
  acknowledgeMessages,
  createOutboundMessage,
  findInboundMessageById,
  getQueuedMessages,
  markOutboundFailed,
  markOutboundSent,
} from '@/services/message.service';
import { createPairingCode, unpairConversation } from '@/services/pairing.service';
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

const generatePairingCodeSchema = z.object({
  expirySeconds: z.coerce.number().int().min(60).max(86400).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const pairingListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const unpairBodySchema = z.object({
  conversationKey: z.string().min(1),
});

const ackBodySchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(100),
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

      const { callbackUrl, callbackExpiresAt } = inboundMessage;
      const hasValidCallback =
        callbackUrl && (!callbackExpiresAt || callbackExpiresAt > new Date());

      if (!hasValidCallback) {
        logger.warn('No valid callback URL for reply', {
          messageId,
          hasCallbackUrl: !!callbackUrl,
          callbackExpired: callbackExpiresAt ? callbackExpiresAt <= new Date() : false,
        });
        return c.json({ error: 'Callback URL expired or not available' }, HTTP_STATUS.BAD_REQUEST);
      }

      const outbound = await createOutboundMessage({
        accountId: account.id,
        conversationKey: inboundMessage.conversationKey,
        inboundMessageId: messageId,
        kakaoTarget: {},
        responsePayload: response,
      });

      try {
        await sendCallback(callbackUrl, response);
        await markOutboundSent(outbound.id);

        logger.info('Reply sent to Kakao', {
          outboundId: outbound.id,
          messageId,
          accountId: account.id,
        });

        return c.json(
          {
            success: true,
            outboundMessageId: outbound.id,
            callbackSent: true,
          },
          HTTP_STATUS.OK
        );
      } catch (callbackError) {
        const errorMessage =
          callbackError instanceof Error ? callbackError.message : 'Callback failed';
        await markOutboundFailed(outbound.id, errorMessage);

        logger.error('Failed to send callback to Kakao', {
          outboundId: outbound.id,
          messageId,
          error: errorMessage,
        });

        return c.json(
          {
            success: false,
            outboundMessageId: outbound.id,
            error: 'Failed to send callback to Kakao',
          },
          HTTP_STATUS.BAD_GATEWAY
        );
      }
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

// ============================================================================
// Pairing endpoints
// ============================================================================

openclawRoutes.post(
  '/pairing/generate',
  zValidator('json', generatePairingCodeSchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid request body', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { expirySeconds, metadata } = c.req.valid('json');

    try {
      const pairingCode = await createPairingCode(account.id, expirySeconds, metadata);

      return c.json(
        {
          code: pairingCode.code,
          expiresAt: pairingCode.expiresAt.toISOString(),
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      if (error instanceof ServiceError) {
        const statusCode = error.statusCode as 400 | 429 | 500;
        return c.json({ error: error.message }, statusCode);
      }

      logger.error('Failed to generate pairing code', {
        error: error instanceof Error ? error.message : 'Unknown error',
        accountId: account.id,
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

openclawRoutes.get(
  '/pairing/list',
  zValidator('query', pairingListQuerySchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid query parameters', { errors: result.error });
      return c.json({ error: 'Invalid query parameters' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { limit, offset } = c.req.valid('query');

    try {
      const { conversations, total } = await listConversationsByAccount(account.id, limit, offset);

      const formatted = conversations.map((conv) => ({
        conversationKey: conv.conversationKey,
        state: conv.state,
        pairedAt: conv.pairedAt?.toISOString() || null,
        lastSeenAt: conv.lastSeenAt?.toISOString() || null,
      }));

      return c.json(
        {
          conversations: formatted,
          total,
          hasMore: offset + conversations.length < total,
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      logger.error('Failed to list paired conversations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        accountId: account.id,
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

openclawRoutes.post(
  '/pairing/unpair',
  zValidator('json', unpairBodySchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid request body', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { conversationKey } = c.req.valid('json');

    try {
      const result = await unpairConversation(conversationKey);

      if (!result) {
        return c.json({ error: 'Conversation not found' }, HTTP_STATUS.NOT_FOUND);
      }

      logger.info('Conversation unpaired', {
        conversationKey,
        accountId: account.id,
      });

      return c.json({ success: true }, HTTP_STATUS.OK);
    } catch (error) {
      if (error instanceof ServiceError) {
        const statusCode = error.statusCode as 400 | 404 | 500;
        return c.json({ error: error.message }, statusCode);
      }

      logger.error('Failed to unpair conversation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationKey,
        accountId: account.id,
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

// ============================================================================
// Message ACK endpoint
// ============================================================================

openclawRoutes.post(
  '/messages/ack',
  zValidator('json', ackBodySchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid request body', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const account = c.get('account');
    const { messageIds } = c.req.valid('json');

    try {
      const ackedCount = await acknowledgeMessages(messageIds);

      logger.info('Messages acknowledged', {
        accountId: account.id,
        requested: messageIds.length,
        acknowledged: ackedCount,
      });

      return c.json(
        {
          acknowledged: ackedCount,
          requested: messageIds.length,
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      logger.error('Failed to acknowledge messages', {
        error: error instanceof Error ? error.message : 'Unknown error',
        accountId: account.id,
        messageIds,
      });
      return c.json({ error: 'Internal server error' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);
