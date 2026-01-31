import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import type { ConversationMapping } from '@/db/schema';
import { kakaoSignatureMiddleware } from '@/middleware/kakao-signature';
import { buildConversationKey, findOrCreateConversation } from '@/services/conversation.service';
import { createInboundMessage } from '@/services/message.service';
import { unpairConversation, verifyPairingCode } from '@/services/pairing.service';
import { type KakaoWebhookRequest, kakaoWebhookRequestSchema } from '@/types/kakao';
import { logger } from '@/utils/logger';

export const kakaoRoutes = new Hono();

kakaoRoutes.use('/webhook', kakaoSignatureMiddleware());

interface Command {
  type: 'PAIR' | 'UNPAIR' | 'STATUS' | 'HELP';
  code?: string;
}

function parseCommand(utterance: string): Command | null {
  const trimmed = utterance.trim();

  if (trimmed.startsWith('/pair ')) {
    const code = trimmed.slice(6).trim().toUpperCase();
    if (code.length > 0) {
      return { type: 'PAIR', code };
    }
  }

  if (trimmed === '/unpair') {
    return { type: 'UNPAIR' };
  }

  if (trimmed === '/status') {
    return { type: 'STATUS' };
  }

  if (trimmed === '/help') {
    return { type: 'HELP' };
  }

  return null;
}

function createTextResponse(text: string) {
  return {
    version: '2.0' as const,
    template: {
      outputs: [{ simpleText: { text } }],
    },
  };
}

function createCallbackResponse() {
  return {
    version: '2.0' as const,
    useCallback: true as const,
  };
}

async function handleCommand(
  command: Command,
  conversation: ConversationMapping,
  conversationKey: string
): Promise<{ version: '2.0'; template: { outputs: { simpleText: { text: string } }[] } }> {
  switch (command.type) {
    case 'PAIR': {
      if (!command.code) {
        return createTextResponse('페어링 코드를 입력해주세요.\n\n예: /pair ABCD-1234');
      }

      if (conversation.state === 'paired') {
        return createTextResponse(
          '이미 OpenClaw에 연결되어 있습니다.\n\n' +
            '다른 봇에 연결하려면 먼저 /unpair 로 연결을 해제하세요.'
        );
      }

      const result = await verifyPairingCode(command.code, conversationKey);

      if (!result.success) {
        const errorMessages: Record<string, string> = {
          INVALID_CODE:
            '❌ 유효하지 않은 코드입니다.\n\n코드를 다시 확인하거나 관리자에게 새 코드를 요청하세요.',
          EXPIRED_CODE: '⏰ 코드가 만료되었습니다.\n\n관리자에게 새 코드를 요청하세요.',
          ALREADY_USED: '❌ 이미 사용된 코드입니다.\n\n관리자에게 새 코드를 요청하세요.',
        };
        return createTextResponse(
          (result.error && errorMessages[result.error]) || '페어링에 실패했습니다.'
        );
      }

      return createTextResponse(
        '✅ OpenClaw에 연결되었습니다!\n\n이제 자유롭게 대화를 시작하세요.'
      );
    }

    case 'UNPAIR': {
      if (conversation.state !== 'paired') {
        return createTextResponse('연결된 OpenClaw가 없습니다.');
      }

      await unpairConversation(conversationKey);
      return createTextResponse(
        '연결이 해제되었습니다.\n\n다시 연결하려면 /pair <코드>를 사용하세요.'
      );
    }

    case 'STATUS': {
      if (conversation.state === 'paired' && conversation.accountId) {
        return createTextResponse(
          `✅ 연결됨\n\n` +
            `연결 시간: ${conversation.pairedAt?.toLocaleString('ko-KR') || '알 수 없음'}`
        );
      }
      return createTextResponse('❌ 연결되지 않음\n\n/pair <코드>로 연결하세요.');
    }

    case 'HELP': {
      return createTextResponse(
        '📖 도움말\n\n' +
          '이 봇은 OpenClaw AI 에이전트와 연결하는 중계 서비스입니다.\n\n' +
          '명령어:\n' +
          '• /pair <코드> - OpenClaw에 연결\n' +
          '• /unpair - 연결 해제\n' +
          '• /status - 연결 상태 확인\n' +
          '• /help - 이 도움말\n\n' +
          '페어링 코드는 OpenClaw 관리자에게 요청하세요.'
      );
    }

    default:
      return createTextResponse('알 수 없는 명령어입니다. /help를 입력해 도움말을 확인하세요.');
  }
}

kakaoRoutes.post(
  '/webhook',
  zValidator('json', kakaoWebhookRequestSchema, (result, c) => {
    if (!result.success) {
      logger.warn('Invalid Kakao webhook request', { errors: result.error });
      return c.json({ error: 'Invalid request body' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const body = c.req.valid('json') as KakaoWebhookRequest;
    const { userRequest, bot } = body;

    const kakaoChannelId = bot?.id || 'default';
    const plusfriendUserKey =
      (userRequest.user.properties?.plusfriendUserKey as string) || userRequest.user.id;
    const utterance = userRequest.utterance;
    const callbackUrl = userRequest.callbackUrl || null;
    const callbackExpiresAt = callbackUrl
      ? new Date(Date.now() + env.CALLBACK_TTL_SECONDS * 1000)
      : null;

    const conversationKey = buildConversationKey(kakaoChannelId, plusfriendUserKey);

    logger.info('Received Kakao webhook', {
      conversationKey,
      utterance: utterance.substring(0, 50),
      hasCallback: !!callbackUrl,
    });

    try {
      const conversation = await findOrCreateConversation(
        kakaoChannelId,
        plusfriendUserKey,
        callbackUrl,
        callbackExpiresAt
      );

      const command = parseCommand(utterance);

      if (command) {
        const response = await handleCommand(command, conversation, conversationKey);
        return c.json(response, HTTP_STATUS.OK);
      }

      if (conversation.state !== 'paired' || !conversation.accountId) {
        return c.json(
          createTextResponse(
            'OpenClaw에 연결되지 않았습니다.\n\n' +
              '연결하려면 봇 관리자에게 페어링 코드를 요청한 후:\n' +
              '/pair <코드>\n\n' +
              '를 입력해주세요.\n\n' +
              '도움말: /help'
          ),
          HTTP_STATUS.OK
        );
      }

      await createInboundMessage({
        accountId: conversation.accountId,
        conversationKey,
        kakaoPayload: body,
        callbackUrl,
        callbackExpiresAt,
        normalizedMessage: {
          userId: plusfriendUserKey,
          text: utterance,
          channelId: kakaoChannelId,
        },
      });

      return c.json(createCallbackResponse(), HTTP_STATUS.OK);
    } catch (error) {
      logger.error('Failed to process Kakao webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationKey,
      });

      return c.json(createCallbackResponse(), HTTP_STATUS.OK);
    }
  }
);
