import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import {
  cleanupExpiredAdminSessions,
  createAdminSession,
  deleteAdminSession,
  validateAdminSession,
} from '@/services/admin-session.service';
import { constantTimeEqual } from '@/utils/crypto';
import { logger } from '@/utils/logger';

const SESSION_COOKIE_NAME = 'admin_session';
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const SESSION_MAX_AGE = ONE_DAY_IN_SECONDS;

export function adminAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!env.ADMIN_PASSWORD) {
      return c.json({ error: 'Admin not configured' }, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
    if (sessionToken) {
      const isValid = await validateAdminSession(sessionToken);
      if (isValid) {
        await next();
        return;
      }
    }

    return c.json({ error: 'Unauthorized' }, HTTP_STATUS.UNAUTHORIZED);
  };
}

export async function adminLogin(password: string): Promise<string | null> {
  if (!env.ADMIN_PASSWORD) {
    return null;
  }

  if (!constantTimeEqual(password, env.ADMIN_PASSWORD)) {
    return null;
  }

  const token = await createAdminSession(SESSION_MAX_AGE);
  return token;
}

export async function adminLogout(token: string): Promise<void> {
  await deleteAdminSession(token);
}

export function setAdminSessionCookie(c: Parameters<MiddlewareHandler>[0], token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE,
    path: '/admin',
  });
}

export function clearAdminSessionCookie(c: Parameters<MiddlewareHandler>[0]): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/admin' });
}

// Cleanup expired sessions every 5 minutes
setInterval(
  async () => {
    try {
      const count = await cleanupExpiredAdminSessions();
      if (count > 0) {
        logger.info('Cleaned up expired admin sessions', { count });
      }
    } catch (error) {
      logger.error('Failed to cleanup expired admin sessions', { error });
    }
  },
  5 * 60 * 1000
);
