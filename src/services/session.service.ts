import { eq, lt } from 'drizzle-orm';
import { env } from '@/config/env';
import { db } from '@/db';
import { portalSessions, portalUsers } from '@/db/schema';

const SESSION_SECRET = env.PORTAL_SESSION_SECRET || 'portal-dev-secret-do-not-use-in-prod';

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

export async function createSession(userId: string, maxAgeSeconds: number): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  await db.insert(portalSessions).values({
    tokenHash,
    userId,
    expiresAt,
  });

  return token;
}

export async function validateSession(token: string) {
  const tokenHash = await hashSessionToken(token);

  const result = await db
    .select({
      session: portalSessions,
      user: portalUsers,
    })
    .from(portalSessions)
    .innerJoin(portalUsers, eq(portalSessions.userId, portalUsers.id))
    .where(eq(portalSessions.tokenHash, tokenHash))
    .limit(1);

  const row = result[0];
  if (!row) {
    return null;
  }

  const { session, user } = row;

  if (session.expiresAt < new Date()) {
    await db.delete(portalSessions).where(eq(portalSessions.id, session.id));
    return null;
  }

  return user;
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await db.delete(portalSessions).where(eq(portalSessions.tokenHash, tokenHash));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.delete(portalSessions).where(eq(portalSessions.userId, userId));
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db
    .delete(portalSessions)
    .where(lt(portalSessions.expiresAt, new Date()))
    .returning({ id: portalSessions.id });

  return result.length;
}
