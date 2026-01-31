import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import type { Account, Mapping } from '@/db/schema';
import { accounts, mappings } from '@/db/schema';
import { ErrorCodes, ServiceError } from '@/errors/service.error';
import { generateToken, hashToken } from '@/utils/crypto';
import { logger } from '@/utils/logger';

export interface AccountSettings {
  mode?: 'direct' | 'relay';
  rateLimitPerMinute?: number;
}

export async function createAccount(
  openclawUserId?: string
): Promise<{ account: Account; token: string }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);

  const [account] = await db
    .insert(accounts)
    .values({
      openclawUserId,
      relayTokenHash: tokenHash,
      relayToken: null,
      mode: 'relay',
      rateLimitPerMinute: 60,
    })
    .returning();

  if (!account) {
    logger.error('Account creation returned no result', { openclawUserId });
    throw new Error('Failed to create account');
  }

  logger.info('Account created', { accountId: account.id });

  return { account, token };
}

export async function findAccountByTokenHash(tokenHash: string): Promise<Account | null> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.relayTokenHash, tokenHash))
    .limit(1);

  return account || null;
}

export async function findAccountById(id: string): Promise<Account | null> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);

  return account || null;
}

export async function updateAccountSettings(
  id: string,
  settings: Partial<AccountSettings>
): Promise<Account> {
  const updateData: Partial<Account> = {};

  if (settings.mode !== undefined) {
    updateData.mode = settings.mode;
  }

  if (settings.rateLimitPerMinute !== undefined) {
    updateData.rateLimitPerMinute = settings.rateLimitPerMinute;
  }

  const [account] = await db
    .update(accounts)
    .set(updateData)
    .where(eq(accounts.id, id))
    .returning();

  if (!account) {
    throw new ServiceError(ErrorCodes.ACCOUNT_NOT_FOUND, 'Account not found', 404, {
      accountId: id,
    });
  }

  logger.info('Account settings updated', { accountId: id, settings });

  return account;
}

export async function createOrUpdateMapping(
  accountId: string,
  kakaoUserKey: string
): Promise<Mapping> {
  const [mapping] = await db
    .insert(mappings)
    .values({
      accountId,
      kakaoUserKey,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mappings.accountId, mappings.kakaoUserKey],
      set: {
        lastSeenAt: new Date(),
      },
    })
    .returning();

  if (!mapping) {
    logger.error('Mapping creation returned no result', {
      accountId,
      kakaoUserKey,
    });
    throw new Error('Failed to create or update mapping');
  }

  logger.info('Mapping created or updated', {
    mappingId: mapping.id,
    accountId,
    kakaoUserKey,
  });

  return mapping;
}

export async function findMappingByKakaoUser(
  accountId: string,
  kakaoUserKey: string
): Promise<Mapping | null> {
  const [mapping] = await db
    .select()
    .from(mappings)
    .where(and(eq(mappings.accountId, accountId), eq(mappings.kakaoUserKey, kakaoUserKey)))
    .limit(1);

  return mapping || null;
}
