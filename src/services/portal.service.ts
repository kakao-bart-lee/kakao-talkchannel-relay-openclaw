import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { accounts, type PortalUser, portalUsers } from '@/db/schema';
import { ErrorCodes, ServiceError } from '@/errors/service.error';
import { logger } from '@/utils/logger';

async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export interface SignupInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function signup(input: SignupInput): Promise<PortalUser> {
  const { email, password } = input;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db
    .select({ id: portalUsers.id })
    .from(portalUsers)
    .where(eq(portalUsers.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    throw new ServiceError(ErrorCodes.ALREADY_EXISTS, 'Email already registered', 409);
  }

  const passwordHash = await hashPassword(password);

  const [account] = await db
    .insert(accounts)
    .values({
      openclawUserId: `portal:${normalizedEmail}`,
      mode: 'relay',
    })
    .returning();

  if (!account) {
    throw new ServiceError(ErrorCodes.INTERNAL_ERROR, 'Failed to create account', 500);
  }

  const [user] = await db
    .insert(portalUsers)
    .values({
      email: normalizedEmail,
      passwordHash,
      accountId: account.id,
    })
    .returning();

  if (!user) {
    await db.delete(accounts).where(eq(accounts.id, account.id));
    throw new ServiceError(ErrorCodes.INTERNAL_ERROR, 'Failed to create user', 500);
  }

  logger.info('Portal user signed up', { userId: user.id, email: normalizedEmail });

  return user;
}

export async function login(input: LoginInput): Promise<PortalUser> {
  const { email, password } = input;
  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db
    .select()
    .from(portalUsers)
    .where(eq(portalUsers.email, normalizedEmail))
    .limit(1);

  if (!user) {
    throw new ServiceError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password', 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new ServiceError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password', 401);
  }

  await db.update(portalUsers).set({ lastLoginAt: sql`NOW()` }).where(eq(portalUsers.id, user.id));

  logger.info('Portal user logged in', { userId: user.id, email: normalizedEmail });

  return user;
}

export async function findUserById(id: string): Promise<PortalUser | null> {
  const [user] = await db.select().from(portalUsers).where(eq(portalUsers.id, id)).limit(1);

  return user || null;
}

export async function findUserByEmail(email: string): Promise<PortalUser | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const [user] = await db
    .select()
    .from(portalUsers)
    .where(eq(portalUsers.email, normalizedEmail))
    .limit(1);

  return user || null;
}
