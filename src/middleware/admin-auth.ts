import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import { constantTimeEqual } from '@/utils/crypto';

const SESSION_COOKIE_NAME = 'admin_session';
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const SESSION_MAX_AGE = ONE_DAY_IN_SECONDS;

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashSessionToken(token: string): Promise<string> {
  const secret = env.ADMIN_SESSION_SECRET || 'default-dev-secret-do-not-use-in-prod';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const activeSessions = new Map<string, { expiresAt: number }>();

export function adminAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!env.ADMIN_PASSWORD) {
      return c.json({ error: 'Admin not configured' }, HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
    if (sessionToken) {
      const sessionHash = await hashSessionToken(sessionToken);
      const session = activeSessions.get(sessionHash);
      if (session && session.expiresAt > Date.now()) {
        await next();
        return;
      }
      activeSessions.delete(sessionHash);
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

  const token = generateSessionToken();
  const hash = await hashSessionToken(token);
  activeSessions.set(hash, { expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });

  return token;
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

setInterval(() => {
  const now = Date.now();
  for (const [hash, session] of activeSessions) {
    if (session.expiresAt <= now) {
      activeSessions.delete(hash);
    }
  }
}, 60 * 1000);
