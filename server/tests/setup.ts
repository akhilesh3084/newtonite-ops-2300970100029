import { beforeEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { resetEnvCache } from '../src/lib/env.js';

beforeEach(async () => {
  resetEnvCache();
  // Wipe all data between tests (triggers on activity don't fire on TRUNCATE)
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Notification",
      "OutboxJob",
      "IdempotencyKey",
      "Comment",
      "ActivityEvent",
      "WorkItem",
      "Membership",
      "Team",
      "User"
    RESTART IDENTITY CASCADE
  `);
});
