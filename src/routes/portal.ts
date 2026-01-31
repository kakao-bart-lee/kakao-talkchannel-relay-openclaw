import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';
import { ServiceError } from '@/errors/service.error';
import { listConversationsByAccount } from '@/services/conversation.service';
import { createPairingCode } from '@/services/pairing.service';
import { login, signup } from '@/services/portal.service';
import { createSession, deleteSession, validateSession } from '@/services/session.service';
import { logger } from '@/utils/logger';

const SESSION_COOKIE_NAME = 'portal_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE,
    path: '/portal',
  });
}

const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

const generateCodeSchema = z.object({
  expirySeconds: z.coerce.number().int().min(60).max(86400).optional(),
});

export const portalRoutes = new Hono();

portalRoutes.post(
  '/api/signup',
  zValidator('json', signupSchema, (result, c) => {
    if (!result.success) {
      const errors = result.error.issues.map((e) => e.message).join(', ');
      return c.json({ error: errors || 'Invalid input' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid('json');

    try {
      const user = await signup({ email, password });
      const token = await createSession(user.id, SESSION_MAX_AGE);
      setSessionCookie(c, token);

      return c.json(
        { success: true, user: { id: user.id, email: user.email } },
        HTTP_STATUS.CREATED
      );
    } catch (error) {
      if (error instanceof ServiceError) {
        return c.json({ error: error.message }, error.statusCode as 400 | 409 | 500);
      }
      logger.error('Signup failed', { error });
      return c.json({ error: 'Signup failed' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

portalRoutes.post(
  '/api/login',
  zValidator('json', loginSchema, (result, c) => {
    if (!result.success) {
      const errors = result.error.issues.map((e) => e.message).join(', ');
      return c.json({ error: errors || 'Invalid input' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid('json');

    try {
      const user = await login({ email, password });
      const token = await createSession(user.id, SESSION_MAX_AGE);
      setSessionCookie(c, token);

      return c.json({ success: true, user: { id: user.id, email: user.email } });
    } catch (error) {
      if (error instanceof ServiceError) {
        return c.json({ error: error.message }, error.statusCode as 401 | 500);
      }
      logger.error('Login failed', { error });
      return c.json({ error: 'Login failed' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

portalRoutes.post('/api/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) {
    await deleteSession(token);
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/portal' });
  return c.json({ success: true });
});

async function getSessionUser(c: Parameters<typeof getCookie>[0]) {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) return null;

  return validateSession(token);
}

portalRoutes.get('/api/me', async (c) => {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json({ error: 'Not authenticated' }, HTTP_STATUS.UNAUTHORIZED);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      accountId: user.accountId,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

portalRoutes.post(
  '/api/pairing/generate',
  zValidator('json', generateCodeSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Invalid input' }, HTTP_STATUS.BAD_REQUEST);
    }
  }),
  async (c) => {
    const user = await getSessionUser(c);
    if (!user) {
      return c.json({ error: 'Not authenticated' }, HTTP_STATUS.UNAUTHORIZED);
    }

    const { expirySeconds } = c.req.valid('json');

    try {
      const code = await createPairingCode(user.accountId, expirySeconds);
      return c.json({
        code: code.code,
        expiresAt: code.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return c.json({ error: error.message }, error.statusCode as 429 | 500);
      }
      logger.error('Failed to generate pairing code', { error });
      return c.json({ error: 'Failed to generate code' }, HTTP_STATUS.INTERNAL_ERROR);
    }
  }
);

portalRoutes.get('/api/connections', async (c) => {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json({ error: 'Not authenticated' }, HTTP_STATUS.UNAUTHORIZED);
  }

  try {
    const { conversations, total } = await listConversationsByAccount(user.accountId);

    const formatted = conversations.map((conv) => ({
      conversationKey: conv.conversationKey,
      state: conv.state,
      pairedAt: conv.pairedAt?.toISOString() || null,
      lastSeenAt: conv.lastSeenAt?.toISOString() || null,
    }));

    return c.json({ connections: formatted, total });
  } catch (error) {
    logger.error('Failed to list connections', { error });
    return c.json({ error: 'Failed to list connections' }, HTTP_STATUS.INTERNAL_ERROR);
  }
});
