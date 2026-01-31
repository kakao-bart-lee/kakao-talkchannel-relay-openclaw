# Relay Server - Phase 2 Patterns Analysis Index

## Overview

This directory contains comprehensive analysis of the relay-server codebase patterns and conventions for Phase 2 service implementation.

## Documents

### 1. **PHASE2_PATTERNS_ANALYSIS.md** (28 KB)
**Comprehensive deep-dive into all architectural patterns**

- Service architecture patterns and templates
- Error handling and exception patterns
- Logger implementation and usage
- Drizzle schema patterns for accounts and messages
- Constants and config patterns
- Type organization and exports
- Code style and formatting conventions
- Complete Phase 2 service example
- Implementation checklist

**Start here for**: Understanding the full architecture and detailed patterns

---

### 2. **PATTERNS_QUICK_REFERENCE.md** (11 KB)
**Quick lookup guide with code snippets**

- File structure overview
- Service template (copy-paste ready)
- Error classes (ready to implement)
- Logger usage examples
- Database query patterns
- Constants pattern
- Type organization
- Route handler pattern
- Code style checklist
- Environment variables
- Common imports
- Testing pattern
- Schema pattern
- Middleware pattern
- Key principles summary
- Validation pattern

**Start here for**: Quick copy-paste templates and quick lookups

---

### 3. **IMPLEMENTATION_PLAN.md** (13 KB)
**Original Phase 1 & 2 implementation roadmap**

- Project structure overview
- Database schema documentation
- Phase 1 implementation details
- Phase 2 implementation roadmap
- API endpoint specifications
- Deployment considerations

**Start here for**: Understanding the overall project scope and roadmap

---

## Key Findings Summary

### Architecture
- **Framework**: Hono + Bun (lightweight, modern)
- **Database**: PostgreSQL + Drizzle ORM (type-safe)
- **Validation**: Zod (runtime type checking)
- **Logging**: Custom structured JSON logger
- **Code Quality**: Biome (linting + formatting)

### Service Pattern
```typescript
// Services are classes exported as singletons
export class [Domain]Service {
  async method(): Promise<Result> {
    logger.debug('Starting', { context });
    try {
      // Implementation with Drizzle ORM
      logger.info('Success', { context });
      return result;
    } catch (error) {
      logger.error('Failed', { error });
      throw error;
    }
  }
}
export const [domain]Service = new [Domain]Service();
```

### Error Handling
- Custom error classes with status codes and context
- ServiceError (base), ValidationError, NotFoundError, AuthenticationError, RateLimitError
- Errors are logged before re-throwing
- Route handlers catch and map errors to HTTP responses

### Logging
- Structured JSON output with timestamp, level, message, context
- Four levels: debug, info, warn, error
- Context includes relevant IDs and operation details
- Configured via LOG_LEVEL environment variable

### Database
- Drizzle ORM with PostgreSQL
- Type inference from schema definitions
- Strategic indexes on frequently queried columns
- Cascade deletes for referential integrity
- Timezone-aware timestamps

### Type Safety
- Strict TypeScript configuration
- No `any` types (enforced by Biome)
- Types inferred from database schema
- Constants exported with type definitions
- Central type export from `src/types/index.ts`

### Code Style
- 2-space indentation
- 100-character line width
- Single quotes
- Semicolons always
- ES5 trailing commas
- Biome auto-formatting

---

## File Locations Reference

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

## Phase 2 Services to Implement

Based on IMPLEMENTATION_PLAN.md, Phase 2 requires:

1. **AccountService** (`src/services/account.service.ts`)
   - Create/retrieve/update accounts
   - Manage relay tokens
   - Validate account state

2. **MessageService** (`src/services/message.service.ts`)
   - Queue inbound messages
   - Track message status
   - Handle message expiration

3. **KakaoService** (`src/services/kakao.service.ts`)
   - Validate Kakao signatures
   - Parse Kakao payloads
   - Send responses to Kakao

4. **PollingService** (`src/services/polling.service.ts`)
   - Long-polling logic
   - Callback delivery
   - Timeout handling

---

## Implementation Checklist

When implementing Phase 2 services:

### Service File
- [ ] Create in `src/services/[domain].service.ts`
- [ ] Add JSDoc class documentation
- [ ] Document all public methods
- [ ] Export singleton instance

### Error Handling
- [ ] Import custom error classes
- [ ] Throw appropriate error types
- [ ] Log errors with context
- [ ] Handle database errors

### Logging
- [ ] Log at appropriate levels
- [ ] Include relevant context
- [ ] Use consistent message format
- [ ] Avoid logging sensitive data

### Database
- [ ] Use Drizzle ORM
- [ ] Leverage type inference
- [ ] Use proper indexes
- [ ] Handle cascade deletes

### Type Safety
- [ ] Define types in type files
- [ ] Export from `src/types/index.ts`
- [ ] Use `as const` for literals
- [ ] Avoid `any` type

### Code Quality
- [ ] Run `bun run lint`
- [ ] Run `bun run format`
- [ ] Keep line width under 100
- [ ] Use single quotes

---

## Database Schema Overview

### Tables
- **accounts**: User accounts with relay tokens
- **mappings**: Kakao user to account mappings
- **inboundMessages**: Incoming Kakao webhook messages
- **outboundMessages**: Responses to be sent to Kakao

### Key Patterns
- UUID primary keys with `defaultRandom()`
- Timezone-aware timestamps
- Automatic `updatedAt` with `$onUpdate()`
- Strategic indexes on query columns
- Unique indexes for authentication tokens
- Cascade deletes for referential integrity

---

## Environment Variables

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

## Quick Start for Phase 2 Development

1. **Read PATTERNS_QUICK_REFERENCE.md** for templates
2. **Copy service template** from section 1
3. **Implement service methods** following error handling pattern
4. **Add logging** at debug, info, warn, error levels
5. **Create route handler** following route pattern
6. **Run `bun run lint`** and `bun run format`
7. **Test error scenarios** with custom error classes

---

## Key Principles

1. **Single Responsibility** - One service per domain
2. **Type Safety** - Strict TypeScript, no `any`
3. **Error Handling** - Custom errors with context
4. **Logging** - Structured JSON with context
5. **Database** - Drizzle ORM with type inference
6. **Constants** - Grouped with type exports
7. **Code Style** - Biome enforced
8. **Documentation** - JSDoc on public methods
9. **Testing** - Unit + integration tests
10. **Dependency Injection** - Module-level singletons

---

## Related Files in This Repository

- `PHASE2_PATTERNS_ANALYSIS.md` - Detailed analysis (28 KB)
- `PATTERNS_QUICK_REFERENCE.md` - Quick lookup (11 KB)
- `IMPLEMENTATION_PLAN.md` - Project roadmap (13 KB)
- `CLAUDE.md` - Bun-specific guidelines
- `biome.json` - Code style configuration
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependencies and scripts

---

## Source Code Files Analyzed

### Configuration
- `/src/config/env.ts` - Environment validation with Zod
- `/src/config/constants.ts` - Constants with type exports

### Database
- `/src/db/index.ts` - Drizzle client initialization
- `/src/db/schema.ts` - Table definitions, enums, relations, types

### Utilities
- `/src/utils/logger.ts` - Structured JSON logger

### Application
- `/src/app.ts` - Hono app setup and error handler
- `/src/index.ts` - Server entry point

### Routes
- `/src/routes/health.ts` - Health check endpoint

### Types
- `/src/types/index.ts` - Central type exports

---

## Next Steps

1. **For immediate implementation**: Start with PATTERNS_QUICK_REFERENCE.md
2. **For deep understanding**: Read PHASE2_PATTERNS_ANALYSIS.md
3. **For project context**: Review IMPLEMENTATION_PLAN.md
4. **For code style**: Check biome.json and tsconfig.json
5. **For examples**: See section 10 of PHASE2_PATTERNS_ANALYSIS.md

---

## Questions & Clarifications

If you need clarification on any pattern:

1. Check the relevant section in PHASE2_PATTERNS_ANALYSIS.md
2. Look for examples in PATTERNS_QUICK_REFERENCE.md
3. Review the actual source code in `/src/`
4. Refer to IMPLEMENTATION_PLAN.md for project context

---

**Last Updated**: January 31, 2025
**Analysis Scope**: Phase 1 foundation + Phase 2 service patterns
**Coverage**: Services, errors, logging, database, types, constants, code style

