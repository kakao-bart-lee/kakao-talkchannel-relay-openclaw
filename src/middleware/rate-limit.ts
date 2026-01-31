import type { MiddlewareHandler } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import type { Account } from '@/db/schema';
import { logger } from '@/utils/logger';

interface RateLimitEntry {
  timestamps: number[];
  lastAccess: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_ENTRIES = 10000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const ENTRY_TTL_MS = 5 * 60 * 1000;

let lastCleanup = Date.now();

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanup = now;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.lastAccess > ENTRY_TTL_MS) {
      rateLimitStore.delete(key);
    }
  }

  if (rateLimitStore.size > MAX_ENTRIES) {
    const entries = [...rateLimitStore.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const deleteCount = Math.floor(entries.length * 0.2);
    for (let i = 0; i < deleteCount; i++) {
      const entry = entries[i];
      if (entry) {
        rateLimitStore.delete(entry[0]);
      }
    }
  }
}

function cleanupOldTimestamps(entry: RateLimitEntry, windowMs: number): void {
  const now = Date.now();
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
}

function checkRateLimit(
  accountId: string,
  limit: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const windowMs = 60 * 1000;
  const now = Date.now();

  cleanupStaleEntries();

  let entry = rateLimitStore.get(accountId);
  if (!entry) {
    entry = { timestamps: [], lastAccess: now };
    rateLimitStore.set(accountId, entry);
  }

  entry.lastAccess = now;
  cleanupOldTimestamps(entry, windowMs);

  const remaining = Math.max(0, limit - entry.timestamps.length);
  const firstTimestamp = entry.timestamps[0];
  const resetAt =
    firstTimestamp !== undefined
      ? Math.ceil((firstTimestamp + windowMs) / 1000)
      : Math.ceil((now + windowMs) / 1000);

  if (entry.timestamps.length >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetAt };
}

export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Get account from context (set by auth middleware)
    const account = c.get('account') as Account | undefined;

    if (!account) {
      // No account = no rate limiting (will fail auth anyway)
      await next();
      return;
    }

    const limit = account.rateLimitPerMinute ?? 60;
    const { allowed, remaining, resetAt } = checkRateLimit(account.id, limit);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetAt.toString());

    if (!allowed) {
      logger.warn('Rate limit exceeded', { accountId: account.id });
      c.header('Retry-After', '60');
      return c.json({ error: 'Rate limit exceeded' }, HTTP_STATUS.TOO_MANY_REQUESTS);
    }

    await next();
  };
}
