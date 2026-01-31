import { eq } from 'drizzle-orm';
import { db } from '@/db';
import type { ConversationMapping, PairingState } from '@/db/schema';
import { conversationMappings } from '@/db/schema';
import { logger } from '@/utils/logger';

export function buildConversationKey(kakaoChannelId: string, plusfriendUserKey: string): string {
  return `${kakaoChannelId}:${plusfriendUserKey}`;
}

export async function findConversationByKey(
  conversationKey: string
): Promise<ConversationMapping | null> {
  const [mapping] = await db
    .select()
    .from(conversationMappings)
    .where(eq(conversationMappings.conversationKey, conversationKey))
    .limit(1);

  return mapping || null;
}

export async function findOrCreateConversation(
  kakaoChannelId: string,
  plusfriendUserKey: string,
  callbackUrl?: string | null,
  callbackExpiresAt?: Date | null
): Promise<ConversationMapping> {
  const conversationKey = buildConversationKey(kakaoChannelId, plusfriendUserKey);

  const existing = await findConversationByKey(conversationKey);
  if (existing) {
    const updateData: Partial<ConversationMapping> = { lastSeenAt: new Date() };
    if (callbackUrl) {
      updateData.lastCallbackUrl = callbackUrl;
      updateData.lastCallbackExpiresAt = callbackExpiresAt;
    }

    const [updated] = await db
      .update(conversationMappings)
      .set(updateData)
      .where(eq(conversationMappings.conversationKey, conversationKey))
      .returning();

    return updated || existing;
  }

  const [created] = await db
    .insert(conversationMappings)
    .values({
      conversationKey,
      kakaoChannelId,
      plusfriendUserKey,
      state: 'unpaired',
      lastCallbackUrl: callbackUrl,
      lastCallbackExpiresAt: callbackExpiresAt,
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create conversation mapping');
  }

  logger.info('Conversation mapping created', {
    conversationKey,
    kakaoChannelId,
    plusfriendUserKey,
  });

  return created;
}

export async function updateConversationState(
  conversationKey: string,
  state: PairingState,
  accountId?: string | null
): Promise<ConversationMapping | null> {
  const updateData: Partial<ConversationMapping> = { state };

  if (state === 'paired' && accountId) {
    updateData.accountId = accountId;
    updateData.pairedAt = new Date();
  } else if (state === 'unpaired') {
    updateData.accountId = null;
    updateData.pairedAt = null;
  }

  const [updated] = await db
    .update(conversationMappings)
    .set(updateData)
    .where(eq(conversationMappings.conversationKey, conversationKey))
    .returning();

  if (updated) {
    logger.info('Conversation state updated', {
      conversationKey,
      state,
      accountId: updateData.accountId,
    });
  }

  return updated || null;
}

export async function listConversationsByAccount(
  accountId: string,
  limit = 50,
  offset = 0
): Promise<{ conversations: ConversationMapping[]; total: number }> {
  const conversations = await db
    .select()
    .from(conversationMappings)
    .where(eq(conversationMappings.accountId, accountId))
    .orderBy(conversationMappings.lastSeenAt)
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({
      count: db.$count(conversationMappings, eq(conversationMappings.accountId, accountId)),
    })
    .from(conversationMappings);

  return { conversations, total: countResult[0]?.count ?? 0 };
}
