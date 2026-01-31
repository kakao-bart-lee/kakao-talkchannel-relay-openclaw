# Phase 2 Service Patterns Analysis

## Executive Summary

This document analyzes the established architectural patterns in the relay-server codebase to guide Phase 2 service implementation. The codebase follows a clean, modular structure with strong conventions for error handling, logging, database access, and type safety.

---

## 1. Service Architecture Patterns

### Current State
The relay-server is in Phase 1 (foundation) with minimal services. The planned architecture (from IMPLEMENTATION_PLAN.md) shows where Phase 2 services should be placed:

```
src/services/
├── account.service.ts      # Account management
├── message.service.ts      # Message queue processing
├── kakao.service.ts        # Kakao API integration
└── polling.service.ts      # Long-polling logic
```

### Service Pattern Template

Based on the codebase structure, Phase 2 services should follow this pattern:

```typescript
// src/services/example.service.ts

import { db } from '@/db';
import { logger } from '@/utils/logger';
import type { Account, InboundMessage } from '@/types';

/**
 * ExampleService handles [specific responsibility].
 * 
 * RESPONSIBILITIES:
 * - [Responsibility 1]
 * - [Responsibility 2]
 * 
 * DEPENDENCIES:
 * - Database (Drizzle ORM)
 * - Logger
 */
export class ExampleService {
  /**
   * Public method with clear documentation.
   * 
   * @param accountId - The account identifier
   * @returns Promise with typed result
   * @throws {ServiceError} When [specific condition]
   */
  async processAccount(accountId: string): Promise<Account> {
    logger.debug('Processing account', { accountId });
    
    try {
      // Implementation
      const result = await db.query.accounts.findFirst({
        where: (accounts, { eq }) => eq(accounts.id, accountId),
      });
      
      if (!result) {
        throw new ServiceError('Account not found', 'NOT_FOUND');
      }
      
      logger.info('Account processed successfully', { accountId });
      return result;
    } catch (error) {
      logger.error('Failed to process account', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Export singleton instance
export const exampleService = new ExampleService();
```

### Key Principles

1. **Single Responsibility**: Each service handles one domain concern
2. **Dependency Injection**: Services receive dependencies (db, logger) at module level
3. **Error Handling**: All errors are caught, logged, and re-thrown with context
4. **Type Safety**: All parameters and returns are fully typed
5. **Documentation**: JSDoc comments explain purpose, parameters, and exceptions
6. **Logging**: Strategic logging at debug, info, and error levels

---

## 2. Error Handling & Exception Patterns

### Current Error Handling

The codebase uses a minimal but effective error handling approach:

**File**: `/src/app.ts`
```typescript
app.onError((err, c) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  return c.json({ error: 'Internal Server Error' }, HTTP_STATUS.INTERNAL_ERROR);
});
```

**File**: `/src/config/env.ts`
```typescript
if (!result.success) {
  const formatted = result.error.format();
  const errors = Object.entries(formatted)
    .filter(([key]) => key !== '_errors')
    .map(([key, value]) => {
      const messages = (value as { _errors?: string[] })?._errors ?? [];
      return `  ${key}: ${messages.join(', ')}`;
    })
    .join('\n');

  throw new Error(`Environment validation failed:\n${errors}`);
}
```

### Recommended Error Pattern for Phase 2

Create a custom error class for service-level errors:

```typescript
// src/utils/errors.ts

/**
 * Base error class for service operations.
 */
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

/**
 * Validation error for invalid input.
 */
export class ValidationError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error for missing resources.
 */
export class NotFoundError extends ServiceError {
  constructor(resource: string, id: string) {
    super(
      `${resource} not found: ${id}`,
      'NOT_FOUND',
      404,
      { resource, id },
    );
    this.name = 'NotFoundError';
  }
}

/**
 * Authentication error for invalid credentials.
 */
export class AuthenticationError extends ServiceError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit error.
 */
export class RateLimitError extends ServiceError {
  constructor(retryAfter: number) {
    super(
      'Rate limit exceeded',
      'RATE_LIMIT_EXCEEDED',
      429,
      { retryAfter },
    );
    this.name = 'RateLimitError';
  }
}
```

### Error Handling in Services

```typescript
// In service methods
async getAccount(accountId: string): Promise<Account> {
  try {
    const account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.id, accountId),
    });

    if (!account) {
      throw new NotFoundError('Account', accountId);
    }

    return account;
  } catch (error) {
    if (error instanceof ServiceError) {
      logger.warn('Service error', {
        code: error.code,
        message: error.message,
        context: error.context,
      });
      throw error;
    }

    logger.error('Unexpected error in getAccount', {
      accountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ServiceError('Failed to get account', 'INTERNAL_ERROR');
  }
}
```

### Error Handling in Routes

```typescript
// In route handlers
app.get('/accounts/:id', async (c) => {
  try {
    const accountId = c.req.param('id');
    const account = await accountService.getAccount(accountId);
    return c.json(account, HTTP_STATUS.OK);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, HTTP_STATUS.NOT_FOUND);
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, HTTP_STATUS.BAD_REQUEST);
    }
    if (error instanceof ServiceError) {
      return c.json({ error: error.message }, error.statusCode);
    }
    
    logger.error('Unhandled error in route', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'Internal Server Error' }, HTTP_STATUS.INTERNAL_ERROR);
  }
});
```

---

## 3. Logger Implementation & Usage Patterns

### Logger Implementation

**File**: `/src/utils/logger.ts`

The logger is a structured JSON logger with the following features:

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

class Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LOG_LEVEL_VALUES[level];
  }

  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
}

export const logger = new Logger('info');
export function createLogger(level: LogLevel = 'info'): Logger
```

### Logger Output Format

Each log entry is a JSON object:
```json
{
  "timestamp": "2024-01-31T10:30:45.123Z",
  "level": "info",
  "message": "Account processed successfully",
  "context": {
    "accountId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": 125
  }
}
```

### Logger Usage Patterns

**Pattern 1: Info-level operational events**
```typescript
logger.info('Account created', {
  accountId: account.id,
  mode: account.mode,
});
```

**Pattern 2: Debug-level detailed tracing**
```typescript
logger.debug('Querying database', {
  table: 'accounts',
  filter: { id: accountId },
});
```

**Pattern 3: Warn-level recoverable issues**
```typescript
logger.warn('Retry attempt', {
  attempt: 3,
  maxAttempts: 5,
  error: error.message,
});
```

**Pattern 4: Error-level failures with context**
```typescript
logger.error('Failed to send message', {
  messageId: message.id,
  accountId: message.accountId,
  error: error.message,
  stack: error.stack,
});
```

### Logger Configuration

The logger level is controlled by the `LOG_LEVEL` environment variable:
```typescript
// src/config/env.ts
LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
```

Usage in services:
```typescript
import { env } from '@/config/env';
import { createLogger } from '@/utils/logger';

const logger = createLogger(env.LOG_LEVEL);
```

---

## 4. Drizzle Schema Patterns

### Schema Organization

**File**: `/src/db/schema.ts`

The schema is organized into sections:
1. **Enums** - Database enum types
2. **Tables** - Table definitions with columns and indexes
3. **Relations** - Drizzle ORM relationships
4. **Type Exports** - TypeScript types inferred from schema

### Accounts Table

```typescript
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
```

**Key Patterns**:
- UUID primary keys with `defaultRandom()`
- Timezone-aware timestamps with `withTimezone: true`
- Automatic `updatedAt` with `$onUpdate()`
- Strategic indexes on frequently queried columns
- Unique indexes for authentication tokens

### Messages Tables

**Inbound Messages**:
```typescript
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
```

**Outbound Messages**:
```typescript
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
```

### Type Exports from Schema

```typescript
// Inferred from table definitions
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;

export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
```

### Database Access Pattern

**File**: `/src/db/index.ts`

```typescript
import { drizzle } from 'drizzle-orm/bun-sql';
import { env } from '@/config/env';
import * as schema from './schema';

export const db = drizzle({
  connection: env.DATABASE_URL,
  schema,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await db.$client.end();
}
```

### Query Patterns for Phase 2

**Find by ID**:
```typescript
const account = await db.query.accounts.findFirst({
  where: (accounts, { eq }) => eq(accounts.id, accountId),
});
```

**Find with relations**:
```typescript
const account = await db.query.accounts.findFirst({
  where: (accounts, { eq }) => eq(accounts.id, accountId),
  with: {
    mappings: true,
    inboundMessages: true,
  },
});
```

**Insert**:
```typescript
const newAccount = await db.insert(accounts).values({
  openclawUserId: userId,
  relayTokenHash: hash,
  mode: 'relay',
}).returning();
```

**Update**:
```typescript
const updated = await db
  .update(accounts)
  .set({ updatedAt: new Date() })
  .where(eq(accounts.id, accountId))
  .returning();
```

**Delete**:
```typescript
await db.delete(accounts).where(eq(accounts.id, accountId));
```

---

## 5. Constants & Config Patterns

### Constants Organization

**File**: `/src/config/constants.ts`

Constants are organized by domain with TypeScript type exports:

```typescript
// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

// Account Modes
export const ACCOUNT_MODE = {
  DIRECT: 'direct',
  RELAY: 'relay',
} as const;

export type AccountMode = (typeof ACCOUNT_MODE)[keyof typeof ACCOUNT_MODE];

// Message Statuses
export const INBOUND_MESSAGE_STATUS = {
  QUEUED: 'queued',
  DELIVERED: 'delivered',
  EXPIRED: 'expired',
} as const;

export type InboundMessageStatus =
  (typeof INBOUND_MESSAGE_STATUS)[keyof typeof INBOUND_MESSAGE_STATUS];

export const OUTBOUND_MESSAGE_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

export type OutboundMessageStatus =
  (typeof OUTBOUND_MESSAGE_STATUS)[keyof typeof OUTBOUND_MESSAGE_STATUS];

// API Versions
export const KAKAO_API_VERSION = '2.0' as const;
```

### Environment Configuration

**File**: `/src/config/env.ts`

Environment variables are validated with Zod at startup:

```typescript
const envSchema = z.object({
  // Server Configuration
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((url) => url.startsWith('postgresql://') || url.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a valid PostgreSQL connection string',
    }),

  // Relay Configuration
  RELAY_BASE_URL: z.string().url('RELAY_BASE_URL must be a valid URL'),

  // Kakao Configuration (optional)
  KAKAO_SIGNATURE_SECRET: z.string().optional(),

  // Queue/Polling Settings
  QUEUE_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  MAX_POLL_WAIT_SECONDS: z.coerce.number().int().min(1).max(60).default(30),
  CALLBACK_TTL_SECONDS: z.coerce.number().int().min(10).max(60).default(55),

  // Rate Limiting
  DEFAULT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
```

### Pattern for Phase 2 Constants

When adding new constants, follow this pattern:

```typescript
// src/config/constants.ts

/**
 * Message processing timeouts (in milliseconds).
 */
export const MESSAGE_TIMEOUTS = {
  WEBHOOK_PROCESSING: 5000,
  CALLBACK_DELIVERY: 10000,
  POLLING_RESPONSE: 30000,
} as const;

export type MessageTimeout = (typeof MESSAGE_TIMEOUTS)[keyof typeof MESSAGE_TIMEOUTS];

/**
 * Retry configuration.
 */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  BACKOFF_MULTIPLIER: 2,
} as const;

/**
 * Pagination defaults.
 */
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  DEFAULT_OFFSET: 0,
} as const;
```

---

## 6. Type Organization & Export Patterns

### Type Organization Structure

**File**: `/src/types/index.ts`

The main types index file re-exports types from various modules:

```typescript
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
```

### Type Organization for Phase 2

Create domain-specific type files:

```typescript
// src/types/kakao.ts
/**
 * Kakao webhook payload types.
 */
export interface KakaoWebhookPayload {
  userId: string;
  message: string;
  timestamp: number;
}

export interface KakaoUser {
  id: string;
  nickname: string;
}

// src/types/openclaw.ts
/**
 * OpenClaw API types.
 */
export interface OpenClawMessage {
  id: string;
  content: string;
  sender: string;
  timestamp: Date;
}

export interface OpenClawResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// src/types/index.ts - Updated
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

export type { KakaoWebhookPayload, KakaoUser } from '@/types/kakao';
export type { OpenClawMessage, OpenClawResponse } from '@/types/openclaw';
```

### Type Inference from Database

The codebase uses Drizzle's type inference:

```typescript
// From schema definition
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// Usage in services
async function createAccount(data: NewAccount): Promise<Account> {
  const result = await db.insert(accounts).values(data).returning();
  return result[0];
}
```

### Type Safety Best Practices

1. **Use `as const` for literal types**:
   ```typescript
   export const ACCOUNT_MODE = {
     DIRECT: 'direct',
     RELAY: 'relay',
   } as const;
   ```

2. **Export types alongside constants**:
   ```typescript
   export type AccountMode = (typeof ACCOUNT_MODE)[keyof typeof ACCOUNT_MODE];
   ```

3. **Use strict TypeScript settings** (from tsconfig.json):
   ```json
   {
     "strict": true,
     "noUnusedLocals": true,
     "noUnusedParameters": true,
     "noImplicitOverride": true,
     "noUncheckedIndexedAccess": true
   }
   ```

4. **Avoid `any` type** - Biome enforces this:
   ```json
   {
     "suspicious": {
       "noExplicitAny": "error"
     }
   }
   ```

---

## 7. Code Style & Formatting Conventions

### Biome Configuration

**File**: `/biome.json`

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      },
      "style": {
        "noNonNullAssertion": "warn"
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
```

### Code Style Rules

1. **Indentation**: 2 spaces
2. **Line width**: 100 characters
3. **Quotes**: Single quotes
4. **Semicolons**: Always
5. **Trailing commas**: ES5 style (objects and arrays, not function parameters)
6. **Imports**: Organized automatically by Biome

### Example Formatted Code

```typescript
import { db } from '@/db';
import { logger } from '@/utils/logger';
import type { Account } from '@/types';

export class AccountService {
  async getAccount(id: string): Promise<Account> {
    logger.debug('Fetching account', { id });

    const account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.id, id),
    });

    if (!account) {
      throw new Error(`Account not found: ${id}`);
    }

    return account;
  }
}
```

---

## 8. Phase 2 Service Implementation Checklist

When implementing Phase 2 services, follow this checklist:

### Service File Structure
- [ ] Create service file in `src/services/[domain].service.ts`
- [ ] Add JSDoc class documentation
- [ ] Document all public methods with parameters and return types
- [ ] Export singleton instance at module level

### Error Handling
- [ ] Import custom error classes from `@/utils/errors`
- [ ] Throw appropriate error types (NotFoundError, ValidationError, etc.)
- [ ] Log errors with context before re-throwing
- [ ] Handle database errors gracefully

### Logging
- [ ] Log at appropriate levels (debug, info, warn, error)
- [ ] Include relevant context in log entries
- [ ] Use consistent message format
- [ ] Avoid logging sensitive data

### Database Access
- [ ] Use Drizzle ORM for all database operations
- [ ] Leverage type inference from schema
- [ ] Use proper indexes for query performance
- [ ] Handle cascade deletes appropriately

### Type Safety
- [ ] Define types in appropriate type files
- [ ] Export types from `src/types/index.ts`
- [ ] Use `as const` for literal types
- [ ] Avoid `any` type

### Code Quality
- [ ] Run `bun run lint` before committing
- [ ] Run `bun run format` to auto-format
- [ ] Keep line width under 100 characters
- [ ] Use single quotes and trailing commas

### Testing (Future)
- [ ] Create unit tests in `src/services/__tests__/`
- [ ] Create integration tests for database operations
- [ ] Mock external dependencies
- [ ] Test error scenarios

---

## 9. Quick Reference: File Locations

| Concern | Location | Pattern |
|---------|----------|---------|
| Services | `src/services/*.service.ts` | Class with singleton export |
| Routes | `src/routes/*.ts` | Hono router instance |
| Database | `src/db/index.ts` | Drizzle client + helpers |
| Schema | `src/db/schema.ts` | Tables, enums, relations, types |
| Types | `src/types/*.ts` | Domain-specific types |
| Constants | `src/config/constants.ts` | Const objects with type exports |
| Environment | `src/config/env.ts` | Zod schema + parsed env |
| Logger | `src/utils/logger.ts` | Logger class + singleton |
| Errors | `src/utils/errors.ts` | Custom error classes |
| App Setup | `src/app.ts` | Hono app configuration |
| Entry Point | `src/index.ts` | Server startup |

---

## 10. Example: Complete Phase 2 Service

Here's a complete example of how a Phase 2 service should be structured:

```typescript
// src/services/account.service.ts

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { accounts } from '@/db/schema';
import { logger } from '@/utils/logger';
import { NotFoundError, ValidationError } from '@/utils/errors';
import type { Account, NewAccount } from '@/types';

/**
 * AccountService manages account operations.
 *
 * RESPONSIBILITIES:
 * - Create and retrieve accounts
 * - Manage account settings and tokens
 * - Validate account state
 *
 * DEPENDENCIES:
 * - Database (Drizzle ORM)
 * - Logger
 */
export class AccountService {
  /**
   * Create a new account.
   *
   * @param data - Account creation data
   * @returns The created account
   * @throws {ValidationError} If data is invalid
   */
  async createAccount(data: NewAccount): Promise<Account> {
    logger.debug('Creating account', { openclawUserId: data.openclawUserId });

    if (!data.relayTokenHash) {
      throw new ValidationError('relayTokenHash is required');
    }

    try {
      const result = await db
        .insert(accounts)
        .values(data)
        .returning();

      const account = result[0];
      logger.info('Account created', {
        accountId: account.id,
        mode: account.mode,
      });

      return account;
    } catch (error) {
      logger.error('Failed to create account', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get account by ID.
   *
   * @param accountId - The account ID
   * @returns The account
   * @throws {NotFoundError} If account doesn't exist
   */
  async getAccount(accountId: string): Promise<Account> {
    logger.debug('Fetching account', { accountId });

    const account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.id, accountId),
    });

    if (!account) {
      throw new NotFoundError('Account', accountId);
    }

    return account;
  }

  /**
   * Get account by relay token hash.
   *
   * @param tokenHash - The token hash
   * @returns The account
   * @throws {NotFoundError} If account doesn't exist
   */
  async getAccountByTokenHash(tokenHash: string): Promise<Account> {
    logger.debug('Fetching account by token hash');

    const account = await db.query.accounts.findFirst({
      where: (accounts, { eq }) => eq(accounts.relayTokenHash, tokenHash),
    });

    if (!account) {
      throw new NotFoundError('Account', 'token');
    }

    return account;
  }

  /**
   * Update account settings.
   *
   * @param accountId - The account ID
   * @param updates - Fields to update
   * @returns The updated account
   * @throws {NotFoundError} If account doesn't exist
   */
  async updateAccount(
    accountId: string,
    updates: Partial<Omit<Account, 'id' | 'createdAt'>>,
  ): Promise<Account> {
    logger.debug('Updating account', { accountId, updates });

    const result = await db
      .update(accounts)
      .set(updates)
      .where(eq(accounts.id, accountId))
      .returning();

    if (result.length === 0) {
      throw new NotFoundError('Account', accountId);
    }

    logger.info('Account updated', { accountId });
    return result[0];
  }

  /**
   * Delete account.
   *
   * @param accountId - The account ID
   * @throws {NotFoundError} If account doesn't exist
   */
  async deleteAccount(accountId: string): Promise<void> {
    logger.debug('Deleting account', { accountId });

    const result = await db
      .delete(accounts)
      .where(eq(accounts.id, accountId))
      .returning();

    if (result.length === 0) {
      throw new NotFoundError('Account', accountId);
    }

    logger.info('Account deleted', { accountId });
  }
}

// Export singleton instance
export const accountService = new AccountService();
```

---

## Summary

Phase 2 services should:

1. **Be organized** in `src/services/` with clear naming
2. **Handle errors** with custom error classes and proper logging
3. **Use the logger** strategically at debug, info, warn, and error levels
4. **Access the database** through Drizzle ORM with proper type inference
5. **Define constants** with type exports in `src/config/constants.ts`
6. **Organize types** in domain-specific files and re-export from `src/types/index.ts`
7. **Follow code style** enforced by Biome (2-space indent, 100-char line width, single quotes)
8. **Be fully typed** with strict TypeScript settings
9. **Be well-documented** with JSDoc comments
10. **Be testable** with clear separation of concerns

