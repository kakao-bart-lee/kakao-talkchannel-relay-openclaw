import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import type { PairingCode } from '@/db/schema';
import { conversationMappings, pairingCodes } from '@/db/schema';
import { ErrorCodes, ServiceError } from '@/errors/service.error';
import { logger } from '@/utils/logger';

const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ACTIVE_CODES_PER_ACCOUNT = 5;
const DEFAULT_EXPIRY_SECONDS = 600;
const MAX_EXPIRY_SECONDS = 1800;

function generatePairingCode(): string {
  const part1 = Array.from(
    { length: 4 },
    () => PAIRING_CODE_CHARS[Math.floor(Math.random() * PAIRING_CODE_CHARS.length)]
  ).join('');
  const part2 = Array.from(
    { length: 4 },
    () => PAIRING_CODE_CHARS[Math.floor(Math.random() * PAIRING_CODE_CHARS.length)]
  ).join('');
  return `${part1}-${part2}`;
}

export async function createPairingCode(
  accountId: string,
  expiresInSeconds: number = DEFAULT_EXPIRY_SECONDS,
  metadata?: Record<string, unknown>
): Promise<PairingCode> {
  const expiry = Math.min(expiresInSeconds, MAX_EXPIRY_SECONDS);

  const activeCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(pairingCodes)
    .where(
      and(
        eq(pairingCodes.accountId, accountId),
        gt(pairingCodes.expiresAt, new Date()),
        isNull(pairingCodes.usedAt)
      )
    );

  if ((activeCount[0]?.count ?? 0) >= MAX_ACTIVE_CODES_PER_ACCOUNT) {
    throw new ServiceError(
      ErrorCodes.RATE_LIMITED,
      `Maximum active codes (${MAX_ACTIVE_CODES_PER_ACCOUNT}) reached`,
      429
    );
  }

  let code: string = generatePairingCode();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const existing = await db
      .select({ code: pairingCodes.code })
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (existing.length === 0) break;
    code = generatePairingCode();
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new ServiceError(ErrorCodes.INTERNAL_ERROR, 'Failed to generate unique code', 500);
  }

  const expiresAt = new Date(Date.now() + expiry * 1000);

  const [created] = await db
    .insert(pairingCodes)
    .values({
      code,
      accountId,
      expiresAt,
      metadata,
    })
    .returning();

  if (!created) {
    throw new ServiceError(ErrorCodes.INTERNAL_ERROR, 'Failed to create pairing code', 500);
  }

  logger.info('Pairing code created', {
    code: created.code,
    accountId,
    expiresAt: expiresAt.toISOString(),
  });

  return created;
}

export interface VerifyPairingResult {
  success: boolean;
  accountId?: string;
  error?: 'INVALID_CODE' | 'EXPIRED_CODE' | 'ALREADY_USED';
}

export async function verifyPairingCode(
  code: string,
  conversationKey: string
): Promise<VerifyPairingResult> {
  const normalizedCode = code.toUpperCase().trim();

  const [pairingCode] = await db
    .select()
    .from(pairingCodes)
    .where(eq(pairingCodes.code, normalizedCode))
    .limit(1);

  if (!pairingCode) {
    logger.warn('Invalid pairing code', { code: normalizedCode });
    return { success: false, error: 'INVALID_CODE' };
  }

  if (pairingCode.usedAt) {
    logger.warn('Pairing code already used', { code: normalizedCode });
    return { success: false, error: 'ALREADY_USED' };
  }

  if (pairingCode.expiresAt < new Date()) {
    logger.warn('Pairing code expired', { code: normalizedCode });
    return { success: false, error: 'EXPIRED_CODE' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(pairingCodes)
      .set({
        usedAt: new Date(),
        usedBy: conversationKey,
      })
      .where(eq(pairingCodes.code, normalizedCode));

    await tx
      .update(conversationMappings)
      .set({
        accountId: pairingCode.accountId,
        state: 'paired',
        pairedAt: new Date(),
      })
      .where(eq(conversationMappings.conversationKey, conversationKey));
  });

  logger.info('Pairing successful', {
    code: normalizedCode,
    accountId: pairingCode.accountId,
    conversationKey,
  });

  return { success: true, accountId: pairingCode.accountId };
}

export async function unpairConversation(conversationKey: string): Promise<boolean> {
  const [updated] = await db
    .update(conversationMappings)
    .set({
      accountId: null,
      state: 'unpaired',
      pairedAt: null,
    })
    .where(eq(conversationMappings.conversationKey, conversationKey))
    .returning({ id: conversationMappings.id });

  if (updated) {
    logger.info('Conversation unpaired', { conversationKey });
    return true;
  }

  return false;
}

export async function cleanupExpiredCodes(): Promise<number> {
  const result = await db
    .delete(pairingCodes)
    .where(and(lt(pairingCodes.expiresAt, new Date()), isNull(pairingCodes.usedAt)));

  const count = (result as unknown as { rowCount: number }).rowCount ?? 0;

  if (count > 0) {
    logger.info('Expired pairing codes cleaned up', { count });
  }

  return count;
}

function lt(column: typeof pairingCodes.expiresAt, value: Date) {
  return sql`${column} < ${value}`;
}
