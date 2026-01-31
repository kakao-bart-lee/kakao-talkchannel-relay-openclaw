import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import { kakaoSignatureMiddleware } from '@/middleware/kakao-signature';
import { createOrUpdateMapping, findAccountById } from '@/services/account.service';
import { createInboundMessage } from '@/services/message.service';
import { kakaoWebhookRequestSchema } from '@/types/kakao';
import { logger } from '@/utils/logger';

export const kakaoRoutes = new Hono();

kakaoRoutes.use('/:accountId/webhook', kakaoSignatureMiddleware());

kakaoRoutes.post(
  '/:accountId/webhook',
  zValidator('json', kakaoWebhookRequestSchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid Kakao webhook request', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const accountId = c.req.param('accountId');

    const account = await findAccountById(accountId);
    if (!account) {
      return c.json({ error: 'Account not found' }, HTTP_STATUS.NOT_FOUND);
    }

    const body = c.req.valid('json');
    const { userRequest } = body;

    const kakaoUserKey = userRequest.user.id;
    const callbackUrl = userRequest.callbackUrl || null;

    const callbackExpiresAt = callbackUrl
      ? new Date(Date.now() + env.CALLBACK_TTL_SECONDS * 1000)
      : null;

    try {
      await createOrUpdateMapping(account.id, kakaoUserKey);

      await createInboundMessage({
        accountId: account.id,
        kakaoPayload: body,
        callbackUrl,
        callbackExpiresAt,
      });

      logger.info('Received Kakao webhook', {
        accountId: account.id,
        kakaoUserKey,
        hasCallback: !!callbackUrl,
        callbackExpiresAt: callbackExpiresAt?.toISOString(),
        utterance: userRequest.utterance.substring(0, 50),
      });

      return c.json(
        {
          version: '2.0' as const,
          useCallback: true as const,
        },
        HTTP_STATUS.OK
      );
    } catch (error) {
      logger.error('Failed to process Kakao webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        accountId: account.id,
        kakaoUserKey,
      });

      return c.json(
        {
          version: '2.0' as const,
          useCallback: true as const,
        },
        HTTP_STATUS.OK
      );
    }
  }
);
