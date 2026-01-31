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

export const accountModeEnum = pgEnum('account_mode', ['direct', 'relay']);

export const pairingStateEnum = pgEnum('pairing_state', [
  'unpaired',
  'pending',
  'paired',
  'blocked',
]);

export const inboundMessageStatusEnum = pgEnum('inbound_message_status', [
  'queued',
  'delivered',
  'acked',
  'expired',
]);

export const outboundMessageStatusEnum = pgEnum('outbound_message_status', [
  'pending',
  'sent',
  'failed',
]);

// ============================================================================
// Tables
// ============================================================================

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
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('accounts_relay_token_hash_idx').on(table.relayTokenHash),
    index('accounts_openclaw_user_id_idx').on(table.openclawUserId),
  ]
);

export const conversationMappings = pgTable(
  'conversation_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationKey: text('conversation_key').notNull().unique(),
    kakaoChannelId: text('kakao_channel_id').notNull(),
    plusfriendUserKey: text('plusfriend_user_key').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    state: pairingStateEnum('state').notNull().default('unpaired'),
    lastCallbackUrl: text('last_callback_url'),
    lastCallbackExpiresAt: timestamp('last_callback_expires_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    pairedAt: timestamp('paired_at', { withTimezone: true }),
  },
  (table) => [
    index('conversation_mappings_account_id_idx').on(table.accountId),
    index('conversation_mappings_state_idx').on(table.state),
    uniqueIndex('conversation_mappings_channel_user_idx').on(
      table.kakaoChannelId,
      table.plusfriendUserKey
    ),
  ]
);

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    code: text('code').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: text('used_by'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('pairing_codes_account_id_idx').on(table.accountId),
    index('pairing_codes_expires_at_idx').on(table.expiresAt),
  ]
);

export const portalUsers = pgTable(
  'portal_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('portal_users_email_idx').on(table.email),
    index('portal_users_account_id_idx').on(table.accountId),
  ]
);

export const portalSessions = pgTable(
  'portal_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => portalUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('portal_sessions_token_hash_idx').on(table.tokenHash),
    index('portal_sessions_user_id_idx').on(table.userId),
    index('portal_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_idx').on(table.tokenHash),
    index('admin_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    conversationKey: text('conversation_key').notNull(),
    kakaoPayload: jsonb('kakao_payload').notNull(),
    normalizedMessage: jsonb('normalized_message'),
    callbackUrl: text('callback_url'),
    callbackExpiresAt: timestamp('callback_expires_at', { withTimezone: true }),
    status: inboundMessageStatusEnum('status').notNull().default('queued'),
    sourceEventId: text('source_event_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
  },
  (table) => [
    index('inbound_messages_account_id_idx').on(table.accountId),
    index('inbound_messages_conversation_key_idx').on(table.conversationKey),
    index('inbound_messages_status_idx').on(table.status),
    index('inbound_messages_created_at_idx').on(table.createdAt),
  ]
);

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
    conversationKey: text('conversation_key').notNull(),
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
    index('outbound_messages_conversation_key_idx').on(table.conversationKey),
    index('outbound_messages_status_idx').on(table.status),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  conversationMappings: many(conversationMappings),
  pairingCodes: many(pairingCodes),
  inboundMessages: many(inboundMessages),
  outboundMessages: many(outboundMessages),
  portalUser: one(portalUsers),
}));

export const portalUsersRelations = relations(portalUsers, ({ one, many }) => ({
  account: one(accounts, {
    fields: [portalUsers.accountId],
    references: [accounts.id],
  }),
  sessions: many(portalSessions),
}));

export const portalSessionsRelations = relations(portalSessions, ({ one }) => ({
  user: one(portalUsers, {
    fields: [portalSessions.userId],
    references: [portalUsers.id],
  }),
}));

export const conversationMappingsRelations = relations(conversationMappings, ({ one }) => ({
  account: one(accounts, {
    fields: [conversationMappings.accountId],
    references: [accounts.id],
  }),
}));

export const pairingCodesRelations = relations(pairingCodes, ({ one }) => ({
  account: one(accounts, {
    fields: [pairingCodes.accountId],
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

export type ConversationMapping = typeof conversationMappings.$inferSelect;
export type NewConversationMapping = typeof conversationMappings.$inferInsert;

export type PairingCode = typeof pairingCodes.$inferSelect;
export type NewPairingCode = typeof pairingCodes.$inferInsert;

export type PortalUser = typeof portalUsers.$inferSelect;
export type NewPortalUser = typeof portalUsers.$inferInsert;

export type PortalSession = typeof portalSessions.$inferSelect;
export type NewPortalSession = typeof portalSessions.$inferInsert;

export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;

export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;

export type PairingState = 'unpaired' | 'pending' | 'paired' | 'blocked';
export type InboundMessageStatus = 'queued' | 'delivered' | 'acked' | 'expired';
export type OutboundMessageStatus = 'pending' | 'sent' | 'failed';
