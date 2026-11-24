import { z } from 'zod';

/**
 * Every environment variable the app reads, validated once at startup.
 * A missing or malformed value stops the process before it accepts traffic.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** A refresh token reused this soon after rotation is a parallel request, not a stolen token. */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).default(10),
  /** Sign-in and refresh requests per minute from one IP address. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  PRICING_ENGINE_URL: z.string().min(1).default('http://localhost:8080'),
  MARKETPLACES_URL: z.string().min(1).default('http://localhost:3002'),
  MARKETPLACE_API_KEY: z.string().min(1).default('mock-key'),
  WEBHOOK_SECRET: z.string().min(8),
  /** How often the worker polls each marketplace for orders it may have missed by webhook. */
  ORDERS_PULL_EVERY_MS: z.coerce.number().int().min(5_000).default(60_000),
  /** Basic auth for the queue dashboard at /admin/queues. */
  QUEUE_DASHBOARD_USER: z.string().min(1).default('admin'),
  QUEUE_DASHBOARD_PASSWORD: z.string().min(8).default('change-me-please'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return parsed.data;
}
