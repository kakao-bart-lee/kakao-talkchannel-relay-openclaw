import { eq, lt } from 'drizzle-orm';
import { env } from '@/config/env';
import { db } from '@/db';
import { adminSessions } from '@/db/schema';
import { logger } from '@/utils/logger';

function getSessionSecret(): string {
  if (env.ADMIN_SESSION_SECRET) {
    return env.ADMIN_SESSION_SECRET;
  }

  if (env.NODE_ENV === 'production') {
    logger.error('ADMIN_SESSION_SECRET is required in production');
    throw new Error('ADMIN_SESSION_SECRET is required in production');
  }

  logger.warn('Using default admin session secret - NOT SAFE FOR PRODUCTION');
  return 'admin-dev-secret-do-not-use-in-prod';
}

const SESSION_SECRET = getSessionSecret();

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createAdminSession(maxAgeSeconds: number): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  await db.insert(adminSessions).values({
    tokenHash,
    expiresAt,
  });

  return token;
}

export async function validateAdminSession(token: string): Promise<boolean> {
  const tokenHash = await hashSessionToken(token);

  const result = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);

  const session = result[0];
  if (!session) {
    return false;
  }

  if (session.expiresAt < new Date()) {
    await db.delete(adminSessions).where(eq(adminSessions.id, session.id));
    return false;
  }

  return true;
}

export async function deleteAdminSession(token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
}

export async function cleanupExpiredAdminSessions(): Promise<number> {
  const result = await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, new Date()))
    .returning({ id: adminSessions.id });

  return result.length;
}
