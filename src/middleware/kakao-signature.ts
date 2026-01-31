import type { MiddlewareHandler } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import { constantTimeEqual, toHex } from '@/utils/crypto';
import { logger } from '@/utils/logger';

declare module 'hono' {
  interface ContextVariableMap {
    kakaoBody: unknown;
  }
}

async function verifyHmacSignature(
  secret: string,
  body: string,
  signature: string
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computedSignature = toHex(signatureBuffer);

  return constantTimeEqual(computedSignature, signature);
}

/**
 * Optional HMAC signature verification for Kakao webhooks.
 *
 * NOTE: This is NOT an official Kakao feature. Kakao does not provide built-in
 * webhook signature verification. This middleware enables custom authentication
 * using Kakao's "헤더값 입력" (Header Value Input) skill setting.
 *
 * Setup (if desired):
 * 1. Generate a secret and set KAKAO_SIGNATURE_SECRET env var
 * 2. In Kakao i Builder skill settings, add header: X-Kakao-Signature
 * 3. Compute HMAC-SHA256(secret, request_body) and set as header value
 *
 * Behavior:
 * - If KAKAO_SIGNATURE_SECRET is not set: passes all requests (no verification)
 * - If set: requires valid X-Kakao-Signature header, returns 401 if invalid
 */
export function kakaoSignatureMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Skip verification if secret is not configured
    if (!env.KAKAO_SIGNATURE_SECRET) {
      await next();
      return;
    }

    // Get signature from header
    const signature = c.req.header('X-Kakao-Signature');
    if (!signature) {
      logger.warn('Missing Kakao signature header');
      return c.json({ error: 'Missing signature' }, HTTP_STATUS.UNAUTHORIZED);
    }

    try {
      // Get raw body for signature verification
      const body = await c.req.text();

      // Verify the signature
      const isValid = await verifyHmacSignature(env.KAKAO_SIGNATURE_SECRET, body, signature);

      if (!isValid) {
        logger.warn('Invalid Kakao signature');
        return c.json({ error: 'Invalid signature' }, HTTP_STATUS.UNAUTHORIZED);
      }

      // Parse and store body for downstream handlers
      const parsed = JSON.parse(body);
      c.set('kakaoBody', parsed);

      await next();
    } catch (error) {
      logger.error('Signature verification error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return c.json({ error: 'Signature verification failed' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  };
}
