import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env into process.env (Prisma already does this for its CLI; our app needs it too)
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEMO_PASSWORD: z.string().min(1).default('Demo@1234'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_DIST: z.string().optional(),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_LOCK_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) {
    return cached;
  }

  // Only pass the keys we care about — process.env has hundreds of Windows/Cursor keys
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    DEMO_PASSWORD: process.env.DEMO_PASSWORD,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    WEB_DIST: process.env.WEB_DIST,
    OUTBOX_POLL_MS: process.env.OUTBOX_POLL_MS,
    OUTBOX_LOCK_TIMEOUT_SEC: process.env.OUTBOX_LOCK_TIMEOUT_SEC,
    OUTBOX_BATCH_SIZE: process.env.OUTBOX_BATCH_SIZE,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }

  cached = parsed.data;
  return cached;
}

/** Reset cache — used by tests only. */
export function resetEnvCache(): void {
  cached = null;
}
