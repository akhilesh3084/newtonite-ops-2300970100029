import { execSync } from 'node:child_process';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Runs once before the suite:
 * apply migrations on newtonite_test so tables exist.
 */
export default async function globalSetup() {
  loadDotenv({ path: path.resolve(__dirname, '../.env') });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST missing');
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
