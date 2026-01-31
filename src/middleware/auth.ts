import type { Context, MiddlewareHandler } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import type { Account } from '@/db/schema';
import { findAccountByTokenHash } from '@/services/account.service';
import { hashToken } from '@/utils/crypto';
import { logger } from '@/utils/logger';

declare module 'hono' {
  interface ContextVariableMap {
    account: Account;
  }
}

export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Extract token from query param or Authorization header
    const token = c.req.query('token') || extractBearerToken(c);

    if (!token) {
      return c.json({ error: 'Missing authentication token' }, HTTP_STATUS.UNAUTHORIZED);
    }

    try {
      const tokenHash = await hashToken(token);
      const account = await findAccountByTokenHash(tokenHash);

      if (!account) {
        logger.warn('Invalid token attempt');
        return c.json({ error: 'Invalid token' }, HTTP_STATUS.UNAUTHORIZED);
      }

      // Set account on context for downstream handlers
      c.set('account', account);

      await next();
    } catch (error) {
      logger.error('Auth middleware error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return c.json({ error: 'Authentication failed' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  };
}

function extractBearerToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
