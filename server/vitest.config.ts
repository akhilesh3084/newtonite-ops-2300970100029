import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

// Point every test at the TEST database BEFORE any app code loads
loadDotenv({ path: path.resolve(__dirname, '.env') });
if (!process.env.DATABASE_URL_TEST) {
  throw new Error('DATABASE_URL_TEST is missing in server/.env');
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'demo-only-change-me-before-any-real-use';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
