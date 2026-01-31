import { ErrorCodes, ServiceError } from '@/errors/service.error';
import { logger } from '@/utils/logger';

const CALLBACK_TIMEOUT_MS = 5000;

const ALLOWED_CALLBACK_HOSTS = ['.kakao.com', '.kakaocdn.net', '.kakaoenterprise.com'];

function isValidCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    return ALLOWED_CALLBACK_HOSTS.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export interface KakaoResponseTemplate {
  outputs: Array<{
    simpleText?: { text: string };
    simpleImage?: { imageUrl: string; altText?: string };
    basicCard?: Record<string, unknown>;
  }>;
  quickReplies?: Array<{
    label: string;
    action: string;
    messageText?: string;
  }>;
}

export interface KakaoResponse {
  version: '2.0';
  template?: KakaoResponseTemplate;
  context?: {
    values: Array<{
      name: string;
      lifeSpan: number;
      params?: Record<string, string>;
    }>;
  };
  data?: Record<string, unknown>;
}

export async function sendCallback(callbackUrl: string, payload: KakaoResponse): Promise<void> {
  if (!isValidCallbackUrl(callbackUrl)) {
    logger.warn('Invalid callback URL rejected', { url: callbackUrl });
    throw new ServiceError(ErrorCodes.CALLBACK_FAILED, 'Invalid callback URL', 400, {
      url: callbackUrl,
    });
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

  try {
    logger.info('Sending callback to Kakao', {
      url: callbackUrl,
      payloadVersion: payload.version,
    });

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      logger.error('Kakao callback failed', {
        url: callbackUrl,
        status: response.status,
        elapsed,
      });
      throw new ServiceError(
        ErrorCodes.CALLBACK_FAILED,
        `Kakao callback failed with status ${response.status}`,
        502,
        { status: response.status, url: callbackUrl }
      );
    }

    logger.info('Kakao callback successful', {
      url: callbackUrl,
      status: response.status,
      elapsed,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }

    const elapsed = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    logger.error('Kakao callback error', {
      url: callbackUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
      isTimeout,
      elapsed,
    });

    throw new ServiceError(
      ErrorCodes.CALLBACK_FAILED,
      isTimeout ? 'Kakao callback timed out' : 'Kakao callback failed',
      502,
      { url: callbackUrl, isTimeout }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
