import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { HTTP_STATUS } from '@/config/constants';
import { db } from '@/db';
import { accounts, conversationMappings, inboundMessages, outboundMessages } from '@/db/schema';
import {
  adminAuthMiddleware,
  adminLogin,
  adminLogout,
  clearAdminSessionCookie,
  setAdminSessionCookie,
} from '@/middleware/admin-auth';
import { generateToken, hashToken } from '@/utils/crypto';

const adminRoutes = new Hono();

const loginSchema = z.object({
  password: z.string().min(1),
});

adminRoutes.post('/api/login', zValidator('json', loginSchema), async (c) => {
  const { password } = c.req.valid('json');
  const token = await adminLogin(password);

  if (!token) {
    return c.json({ error: 'Invalid password' }, HTTP_STATUS.UNAUTHORIZED);
  }

  setAdminSessionCookie(c, token);
  return c.json({ success: true });
});

adminRoutes.post('/api/logout', async (c) => {
  const token = getCookie(c, 'admin_session');
  if (token) {
    await adminLogout(token);
  }
  clearAdminSessionCookie(c);
  return c.json({ success: true });
});

adminRoutes.use('/api/*', adminAuthMiddleware());

adminRoutes.get('/api/stats', async (c) => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalAccounts,
    totalMappings,
    inboundToday,
    inboundWeek,
    outboundToday,
    outboundWeek,
    failedOutbound,
    queuedInbound,
  ] = await Promise.all([
    db.select({ count: count() }).from(accounts),
    db.select({ count: count() }).from(conversationMappings),
    db
      .select({ count: count() })
      .from(inboundMessages)
      .where(gte(inboundMessages.createdAt, oneDayAgo)),
    db
      .select({ count: count() })
      .from(inboundMessages)
      .where(gte(inboundMessages.createdAt, oneWeekAgo)),
    db
      .select({ count: count() })
      .from(outboundMessages)
      .where(gte(outboundMessages.createdAt, oneDayAgo)),
    db
      .select({ count: count() })
      .from(outboundMessages)
      .where(gte(outboundMessages.createdAt, oneWeekAgo)),
    db
      .select({ count: count() })
      .from(outboundMessages)
      .where(
        and(eq(outboundMessages.status, 'failed'), gte(outboundMessages.createdAt, oneWeekAgo))
      ),
    db.select({ count: count() }).from(inboundMessages).where(eq(inboundMessages.status, 'queued')),
  ]);

  return c.json({
    accounts: totalAccounts[0]?.count ?? 0,
    mappings: totalMappings[0]?.count ?? 0,
    messages: {
      inbound: {
        today: inboundToday[0]?.count ?? 0,
        week: inboundWeek[0]?.count ?? 0,
        queued: queuedInbound[0]?.count ?? 0,
      },
      outbound: {
        today: outboundToday[0]?.count ?? 0,
        week: outboundWeek[0]?.count ?? 0,
        failed: failedOutbound[0]?.count ?? 0,
      },
    },
  });
});

adminRoutes.get('/api/accounts', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const offset = Number(c.req.query('offset')) || 0;

  const [accountList, total] = await Promise.all([
    db
      .select({
        id: accounts.id,
        openclawUserId: accounts.openclawUserId,
        mode: accounts.mode,
        rateLimitPerMinute: accounts.rateLimitPerMinute,
        createdAt: accounts.createdAt,
        updatedAt: accounts.updatedAt,
      })
      .from(accounts)
      .orderBy(desc(accounts.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(accounts),
  ]);

  return c.json({
    data: accountList,
    pagination: {
      total: total[0]?.count ?? 0,
      limit,
      offset,
    },
  });
});

const createAccountSchema = z.object({
  openclawUserId: z.string().optional(),
  mode: z.enum(['direct', 'relay']).default('relay'),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
});

adminRoutes.post('/api/accounts', zValidator('json', createAccountSchema), async (c) => {
  const data = c.req.valid('json');
  const relayToken = generateToken();
  const relayTokenHash = await hashToken(relayToken);

  const [created] = await db
    .insert(accounts)
    .values({
      openclawUserId: data.openclawUserId,
      mode: data.mode,
      rateLimitPerMinute: data.rateLimitPerMinute,
      relayToken: null,
      relayTokenHash,
    })
    .returning({
      id: accounts.id,
      openclawUserId: accounts.openclawUserId,
      mode: accounts.mode,
      rateLimitPerMinute: accounts.rateLimitPerMinute,
      createdAt: accounts.createdAt,
    });

  return c.json({ ...created, relayToken }, HTTP_STATUS.CREATED);
});

adminRoutes.get('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const [account] = await db
    .select({
      id: accounts.id,
      openclawUserId: accounts.openclawUserId,
      mode: accounts.mode,
      rateLimitPerMinute: accounts.rateLimitPerMinute,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    })
    .from(accounts)
    .where(eq(accounts.id, id));

  if (!account) {
    return c.json({ error: 'Account not found' }, HTTP_STATUS.NOT_FOUND);
  }

  return c.json(account);
});

const updateAccountSchema = z.object({
  openclawUserId: z.string().optional(),
  mode: z.enum(['direct', 'relay']).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
});

adminRoutes.patch('/api/accounts/:id', zValidator('json', updateAccountSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const [updated] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning({
    id: accounts.id,
    openclawUserId: accounts.openclawUserId,
    mode: accounts.mode,
    rateLimitPerMinute: accounts.rateLimitPerMinute,
    createdAt: accounts.createdAt,
    updatedAt: accounts.updatedAt,
  });

  if (!updated) {
    return c.json({ error: 'Account not found' }, HTTP_STATUS.NOT_FOUND);
  }

  return c.json(updated);
});

adminRoutes.delete('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const [deleted] = await db
    .delete(accounts)
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id });

  if (!deleted) {
    return c.json({ error: 'Account not found' }, HTTP_STATUS.NOT_FOUND);
  }

  return c.json({ success: true });
});

adminRoutes.post('/api/accounts/:id/regenerate-token', async (c) => {
  const id = c.req.param('id');
  const relayToken = generateToken();
  const relayTokenHash = await hashToken(relayToken);

  const [updated] = await db
    .update(accounts)
    .set({ relayTokenHash })
    .where(eq(accounts.id, id))
    .returning({ id: accounts.id });

  if (!updated) {
    return c.json({ error: 'Account not found' }, HTTP_STATUS.NOT_FOUND);
  }

  return c.json({ relayToken });
});

adminRoutes.get('/api/mappings', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const offset = Number(c.req.query('offset')) || 0;
  const accountId = c.req.query('accountId');

  let query = db
    .select({
      id: conversationMappings.id,
      conversationKey: conversationMappings.conversationKey,
      plusfriendUserKey: conversationMappings.plusfriendUserKey,
      accountId: conversationMappings.accountId,
      state: conversationMappings.state,
      lastSeenAt: conversationMappings.lastSeenAt,
      pairedAt: conversationMappings.pairedAt,
    })
    .from(conversationMappings)
    .orderBy(desc(conversationMappings.lastSeenAt))
    .limit(limit)
    .offset(offset);

  if (accountId) {
    query = query.where(eq(conversationMappings.accountId, accountId)) as typeof query;
  }

  const [mappingList, total] = await Promise.all([
    query,
    accountId
      ? db
          .select({ count: count() })
          .from(conversationMappings)
          .where(eq(conversationMappings.accountId, accountId))
      : db.select({ count: count() }).from(conversationMappings),
  ]);

  return c.json({
    data: mappingList,
    pagination: {
      total: total[0]?.count ?? 0,
      limit,
      offset,
    },
  });
});

adminRoutes.delete('/api/mappings/:id', async (c) => {
  const id = c.req.param('id');
  const [deleted] = await db
    .delete(conversationMappings)
    .where(eq(conversationMappings.id, id))
    .returning({ id: conversationMappings.id });

  if (!deleted) {
    return c.json({ error: 'Mapping not found' }, HTTP_STATUS.NOT_FOUND);
  }

  return c.json({ success: true });
});

adminRoutes.get('/api/messages/inbound', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const offset = Number(c.req.query('offset')) || 0;
  const accountId = c.req.query('accountId');
  const status = c.req.query('status');

  const conditions = [];
  if (accountId) conditions.push(eq(inboundMessages.accountId, accountId));
  if (status)
    conditions.push(
      eq(inboundMessages.status, status as 'queued' | 'delivered' | 'acked' | 'expired')
    );

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [messageList, total] = await Promise.all([
    db
      .select({
        id: inboundMessages.id,
        accountId: inboundMessages.accountId,
        status: inboundMessages.status,
        createdAt: inboundMessages.createdAt,
        deliveredAt: inboundMessages.deliveredAt,
        kakaoPayload: inboundMessages.kakaoPayload,
      })
      .from(inboundMessages)
      .where(whereClause)
      .orderBy(desc(inboundMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(inboundMessages).where(whereClause),
  ]);

  return c.json({
    data: messageList,
    pagination: {
      total: total[0]?.count ?? 0,
      limit,
      offset,
    },
  });
});

adminRoutes.get('/api/messages/outbound', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100);
  const offset = Number(c.req.query('offset')) || 0;
  const accountId = c.req.query('accountId');
  const status = c.req.query('status');

  const conditions = [];
  if (accountId) conditions.push(eq(outboundMessages.accountId, accountId));
  if (status) conditions.push(eq(outboundMessages.status, status as 'pending' | 'sent' | 'failed'));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [messageList, total] = await Promise.all([
    db
      .select({
        id: outboundMessages.id,
        accountId: outboundMessages.accountId,
        inboundMessageId: outboundMessages.inboundMessageId,
        status: outboundMessages.status,
        errorMessage: outboundMessages.errorMessage,
        createdAt: outboundMessages.createdAt,
        sentAt: outboundMessages.sentAt,
        responsePayload: outboundMessages.responsePayload,
      })
      .from(outboundMessages)
      .where(whereClause)
      .orderBy(desc(outboundMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: count() }).from(outboundMessages).where(whereClause),
  ]);

  return c.json({
    data: messageList,
    pagination: {
      total: total[0]?.count ?? 0,
      limit,
      offset,
    },
  });
});

export { adminRoutes };
