import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// Enums
// ============================================================================

/**
 * Account mode: 'direct' for direct API calls, 'relay' for polling mode.
 */
export const accountModeEnum = pgEnum('account_mode', ['direct', 'relay']);

/**
 * Inbound message status tracking.
 */
export const inboundMessageStatusEnum = pgEnum('inbound_message_status', [
  'queued',
  'delivered',
  'expired',
]);

/**
 * Outbound message status tracking.
 */
export const outboundMessageStatusEnum = pgEnum('outbound_message_status', [
  'pending',
  'sent',
  'failed',
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Accounts table - stores OpenClaw user accounts and their relay tokens.
 *
 * IMPLEMENTATION NOTE:
 * - relay_token is returned ONCE on account creation, then set to NULL
 * - Only relay_token_hash is stored and used for authentication lookups
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    openclawUserId: text('openclaw_user_id'),
    relayToken: text('relay_token'),
    relayTokenHash: text('relay_token_hash'),
    mode: accountModeEnum('mode').notNull().default('relay'),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(60),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('accounts_relay_token_hash_idx').on(table.relayTokenHash),
    index('accounts_openclaw_user_id_idx').on(table.openclawUserId),
  ]
);

/**
 * Mappings table - links Kakao users to OpenClaw accounts.
 */
export const mappings = pgTable(
  'mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kakaoUserKey: text('kakao_user_key').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('mappings_account_id_idx').on(table.accountId),
    index('mappings_kakao_user_key_idx').on(table.kakaoUserKey),
    uniqueIndex('mappings_account_kakao_user_idx').on(table.accountId, table.kakaoUserKey),
  ]
);

/**
 * Inbound messages table - stores incoming Kakao webhook messages.
 */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kakaoPayload: jsonb('kakao_payload').notNull(),
    normalizedMessage: jsonb('normalized_message'),
    callbackUrl: text('callback_url'),
    callbackExpiresAt: timestamp('callback_expires_at', { withTimezone: true }),
    status: inboundMessageStatusEnum('status').notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('inbound_messages_account_id_idx').on(table.accountId),
    index('inbound_messages_status_idx').on(table.status),
    index('inbound_messages_created_at_idx').on(table.createdAt),
  ]
);

/**
 * Outbound messages table - stores responses to be sent to Kakao.
 */
export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    inboundMessageId: uuid('inbound_message_id').references(() => inboundMessages.id, {
      onDelete: 'set null',
    }),
    kakaoTarget: jsonb('kakao_target').notNull(),
    responsePayload: jsonb('response_payload').notNull(),
    status: outboundMessageStatusEnum('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('outbound_messages_account_id_idx').on(table.accountId),
    index('outbound_messages_inbound_message_id_idx').on(table.inboundMessageId),
    index('outbound_messages_status_idx').on(table.status),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const accountsRelations = relations(accounts, ({ many }) => ({
  mappings: many(mappings),
  inboundMessages: many(inboundMessages),
  outboundMessages: many(outboundMessages),
}));

export const mappingsRelations = relations(mappings, ({ one }) => ({
  account: one(accounts, {
    fields: [mappings.accountId],
    references: [accounts.id],
  }),
}));

export const inboundMessagesRelations = relations(inboundMessages, ({ one, many }) => ({
  account: one(accounts, {
    fields: [inboundMessages.accountId],
    references: [accounts.id],
  }),
  outboundMessages: many(outboundMessages),
}));

export const outboundMessagesRelations = relations(outboundMessages, ({ one }) => ({
  account: one(accounts, {
    fields: [outboundMessages.accountId],
    references: [accounts.id],
  }),
  inboundMessage: one(inboundMessages, {
    fields: [outboundMessages.inboundMessageId],
    references: [inboundMessages.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Mapping = typeof mappings.$inferSelect;
export type NewMapping = typeof mappings.$inferInsert;

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;

export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
