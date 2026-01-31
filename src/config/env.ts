import { z } from 'zod';

/**
 * Environment variable schema with Zod validation.
 * All environment variables must be accessed through this module.
 */
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

  // Kakao Configuration (optional - see middleware/kakao-signature.ts for details)
  // If set, validates X-Kakao-Signature header using HMAC-SHA256
  // Can be configured via Kakao's "헤더값 입력" feature in skill settings
  KAKAO_SIGNATURE_SECRET: z.string().optional(),

  // Admin Configuration
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),

  // Portal Configuration
  PORTAL_SESSION_SECRET: z.string().min(32).optional(),

  // Queue/Polling Settings
  QUEUE_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  MAX_POLL_WAIT_SECONDS: z.coerce.number().int().min(1).max(60).default(30),
  CALLBACK_TTL_SECONDS: z.coerce.number().int().min(10).max(60).default(55),

  // Rate Limiting
  DEFAULT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Parse and validate environment variables.
 * Throws ZodError if validation fails.
 */
function parseEnv() {
  const result = envSchema.safeParse(process.env);

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

  return result.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
