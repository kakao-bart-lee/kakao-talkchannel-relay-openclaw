# Phase 2 Patterns - Quick Reference

## File Structure Overview

```
src/
├── index.ts                          # Server entry point
├── app.ts                            # Hono app setup + error handler
├── config/
│   ├── env.ts                        # Environment validation (Zod)
│   └── constants.ts                  # Constants with type exports
├── db/
│   ├── index.ts                      # Drizzle client + helpers
│   └── schema.ts                     # Tables, enums, relations, types
├── routes/
│   ├── health.ts                     # Health check endpoint
│   ├── kakao.ts                      # Kakao webhook (Phase 2)
│   └── openclaw.ts                   # OpenClaw polling (Phase 2)
├── services/                         # Phase 2 - Business logic
│   ├── account.service.ts
│   ├── message.service.ts
│   ├── kakao.service.ts
│   └── polling.service.ts
├── middleware/                       # Phase 2 - Request processing
│   ├── auth.ts
│   ├── rate-limit.ts
│   └── error-handler.ts
├── types/
│   ├── index.ts                      # Central type exports
│   ├── kakao.ts                      # Kakao types (Phase 2)
│   └── openclaw.ts                   # OpenClaw types (Phase 2)
└── utils/
    ├── logger.ts                     # Structured JSON logger
    ├── errors.ts                     # Custom error classes (Phase 2)
    ├── crypto.ts                     # Token/HMAC utilities (Phase 2)
    └── normalize.ts                  # Payload normalization (Phase 2)
```

---

## 1. Service Template

```typescript
// src/services/[domain].service.ts

import { db } from '@/db';
import { logger } from '@/utils/logger';
import { NotFoundError, ValidationError } from '@/utils/errors';
import type { Account } from '@/types';

/**
 * [Domain]Service handles [responsibility].
 *
 * RESPONSIBILITIES:
 * - [Responsibility 1]
 * - [Responsibility 2]
 */
export class [Domain]Service {
  async method(param: string): Promise<Account> {
    logger.debug('Starting operation', { param });

    try {
      // Implementation
      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) => eq(accounts.id, param),
      });

      if (!result) {
        throw new NotFoundError('Account', param);
      }

      logger.info('Operation completed', { param });
      return result;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error('Operation failed', {
        param,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const [domain]Service = new [Domain]Service();
```

---

## 2. Error Classes

```typescript
// src/utils/errors.ts

export class ServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

export class NotFoundError extends ServiceError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

export class RateLimitError extends ServiceError {
  constructor(retryAfter: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429, { retryAfter });
  }
}
```

---

## 3. Logger Usage

```typescript
// Debug - detailed tracing
logger.debug('Querying database', { table: 'accounts', filter: { id } });

// Info - operational events
logger.info('Account created', { accountId: account.id, mode: account.mode });

// Warn - recoverable issues
logger.warn('Retry attempt', { attempt: 3, maxAttempts: 5 });

// Error - failures
logger.error('Failed to send message', {
  messageId: message.id,
  error: error.message,
  stack: error.stack,
});
```

---

## 4. Database Queries

```typescript
// Find by ID
const account = await db.query.accounts.findFirst({
  where: (accounts, { eq }) => eq(accounts.id, accountId),
});

// Find with relations
const account = await db.query.accounts.findFirst({
  where: (accounts, { eq }) => eq(accounts.id, accountId),
  with: { mappings: true, inboundMessages: true },
});

// Insert
const result = await db.insert(accounts).values(data).returning();

// Update
const updated = await db
  .update(accounts)
  .set({ updatedAt: new Date() })
  .where(eq(accounts.id, accountId))
  .returning();

// Delete
await db.delete(accounts).where(eq(accounts.id, accountId));
```

---

## 5. Constants Pattern

```typescript
// src/config/constants.ts

export const DOMAIN_CONSTANT = {
  VALUE_1: 'value1',
  VALUE_2: 'value2',
} as const;

export type DomainConstant = (typeof DOMAIN_CONSTANT)[keyof typeof DOMAIN_CONSTANT];
```

---

## 6. Type Organization

```typescript
// src/types/index.ts - Central export point

export type {
  AccountMode,
  HttpStatus,
  InboundMessageStatus,
  OutboundMessageStatus,
} from '@/config/constants';

export type { Env } from '@/config/env';

export type {
  Account,
  InboundMessage,
  Mapping,
  NewAccount,
  NewInboundMessage,
  NewMapping,
  NewOutboundMessage,
  OutboundMessage,
} from '@/db/schema';

// Phase 2 additions
export type { KakaoWebhookPayload, KakaoUser } from '@/types/kakao';
export type { OpenClawMessage, OpenClawResponse } from '@/types/openclaw';
```

---

## 7. Route Handler Pattern

```typescript
// src/routes/[domain].ts

import { Hono } from 'hono';
import { HTTP_STATUS } from '@/config/constants';
import { [domain]Service } from '@/services/[domain].service';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { logger } from '@/utils/logger';

export const [domain]Routes = new Hono();

[domain]Routes.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await [domain]Service.getById(id);
    return c.json(result, HTTP_STATUS.OK);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND);
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST);
    }
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'Internal Server Error' }, HTTP_STATUS.INTERNAL_ERROR);
  }
});
```

---

## 8. Code Style Checklist

- [ ] 2-space indentation
- [ ] 100-character line width
- [ ] Single quotes
- [ ] Semicolons always
- [ ] Trailing commas (ES5 style)
- [ ] No unused imports/variables
- [ ] No `any` types
- [ ] JSDoc comments on public methods
- [ ] Run `bun run lint` before commit
- [ ] Run `bun run format` to auto-fix

---

## 9. Environment Variables

```bash
# Server
PORT=8080
NODE_ENV=development
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/relay

# Relay
RELAY_BASE_URL=https://relay.example.com

# Kakao (optional)
KAKAO_SIGNATURE_SECRET=your-secret

# Queue/Polling
QUEUE_TTL_SECONDS=900
MAX_POLL_WAIT_SECONDS=30
CALLBACK_TTL_SECONDS=55

# Rate Limiting
DEFAULT_RATE_LIMIT_PER_MINUTE=60
```

---

## 10. Common Imports

```typescript
// Database
import { db } from '@/db';
import { eq, and, or } from 'drizzle-orm';
import { accounts, inboundMessages, outboundMessages } from '@/db/schema';

// Types
import type { Account, InboundMessage, OutboundMessage } from '@/types';

// Utils
import { logger } from '@/utils/logger';
import { NotFoundError, ValidationError } from '@/utils/errors';

// Config
import { HTTP_STATUS } from '@/config/constants';
import { env } from '@/config/env';

// Framework
import { Hono } from 'hono';
```

---

## 11. Testing Pattern (Future)

```typescript
// src/services/__tests__/account.service.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { accountService } from '@/services/account.service';
import { NotFoundError } from '@/utils/errors';

describe('AccountService', () => {
  describe('getAccount', () => {
    it('should return account when found', async () => {
      const account = await accountService.getAccount('valid-id');
      expect(account).toBeDefined();
    });

    it('should throw NotFoundError when account not found', async () => {
      expect(async () => {
        await accountService.getAccount('invalid-id');
      }).toThrow(NotFoundError);
    });
  });
});
```

---

## 12. Drizzle Schema Pattern

```typescript
// src/db/schema.ts

export const [table] = pgTable(
  '[table_name]',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: [enum]('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('[table]_account_id_idx').on(table.accountId),
    index('[table]_status_idx').on(table.status),
  ]
);

export type [Table] = typeof [table].$inferSelect;
export type New[Table] = typeof [table].$inferInsert;
```

---

## 13. Middleware Pattern (Phase 2)

```typescript
// src/middleware/[concern].ts

import { Hono } from 'hono';
import { logger } from '@/utils/logger';

export function [concern]Middleware(app: Hono) {
  app.use('*', async (c, next) => {
    logger.debug('Middleware executing', { path: c.req.path });
    
    try {
      await next();
    } catch (error) {
      logger.error('Middleware error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}
```

---

## 14. Key Principles Summary

| Principle | Implementation |
|-----------|-----------------|
| **Single Responsibility** | One service per domain concern |
| **Type Safety** | Strict TypeScript, no `any` |
| **Error Handling** | Custom error classes with context |
| **Logging** | Structured JSON with context |
| **Database** | Drizzle ORM with type inference |
| **Constants** | Grouped with type exports |
| **Code Style** | Biome enforced (2-space, 100-char) |
| **Documentation** | JSDoc on public methods |
| **Testing** | Unit + integration tests |
| **Dependency Injection** | Module-level singleton exports |

---

## 15. Validation Pattern (Phase 2)

```typescript
// Using Zod for input validation

import { z } from 'zod';

const createAccountSchema = z.object({
  openclawUserId: z.string().min(1),
  relayTokenHash: z.string().min(1),
  mode: z.enum(['direct', 'relay']).default('relay'),
});

type CreateAccountInput = z.infer<typeof createAccountSchema>;

// In route handler
const validated = createAccountSchema.parse(c.req.json());
const account = await accountService.createAccount(validated);
```

