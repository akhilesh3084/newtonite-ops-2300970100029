import type { OutboxJob } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { loadEnv } from '../lib/env.js';
import { handleJob } from './handlers.js';

export type ProcessBatchResult = {
  claimed: number;
  done: number;
  failed: number;
  retried: number;
  recovered: number;
};

/**
 * One worker tick:
 * 1) Unstick jobs stuck in PROCESSING too long
 * 2) Claim a batch with FOR UPDATE SKIP LOCKED
 * 3) Run handlers; mark DONE / retry / FAILED
 */
export async function processBatch(): Promise<ProcessBatchResult> {
  const env = loadEnv();
  const lockTimeoutSec = env.OUTBOX_LOCK_TIMEOUT_SEC;
  const batchSize = env.OUTBOX_BATCH_SIZE;

  const recovered = await prisma.$executeRaw`
    UPDATE "OutboxJob"
    SET status = 'PENDING', "lockedAt" = NULL
    WHERE status = 'PROCESSING'
      AND "lockedAt" IS NOT NULL
      AND "lockedAt" < now() - (${lockTimeoutSec} || ' seconds')::interval
  `;

  const claimed = await prisma.$queryRaw<OutboxJob[]>`
    UPDATE "OutboxJob" AS j
    SET
      status = 'PROCESSING',
      "lockedAt" = now(),
      attempts = j.attempts + 1
    FROM (
      SELECT id
      FROM "OutboxJob"
      WHERE status = 'PENDING'
        AND "runAfter" <= now()
      ORDER BY "runAfter"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ) AS pick
    WHERE j.id = pick.id
    RETURNING j.*
  `;

  let done = 0;
  let failed = 0;
  let retried = 0;

  for (const job of claimed) {
    try {
      await prisma.$transaction(async (tx) => {
        await handleJob(tx, job);
        await tx.outboxJob.update({
          where: { id: job.id },
          data: { status: 'DONE', lockedAt: null, lastError: null },
        });
      });
      done += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';

      if (message.startsWith('unknown_job_type:')) {
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            lockedAt: null,
            lastError: message.slice(0, 500),
          },
        });
        failed += 1;
        continue;
      }

      if (job.attempts >= job.maxAttempts) {
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            lockedAt: null,
            lastError: message.slice(0, 500),
          },
        });
        failed += 1;
      } else {
        const delaySec = 2 ** job.attempts;
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            lockedAt: null,
            lastError: message.slice(0, 500),
            runAfter: new Date(Date.now() + delaySec * 1000),
          },
        });
        retried += 1;
      }
    }
  }

  return {
    claimed: claimed.length,
    done,
    failed,
    retried,
    recovered: Number(recovered),
  };
}

export async function getOutboxHealth() {
  const [pending, failed, oldest] = await Promise.all([
    prisma.outboxJob.count({ where: { status: 'PENDING' } }),
    prisma.outboxJob.count({ where: { status: 'FAILED' } }),
    prisma.outboxJob.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const oldestPendingAgeSec = oldest
    ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000))
    : 0;

  const degraded = oldestPendingAgeSec > 60;

  return {
    pending,
    failed,
    oldestPendingAgeSec,
    status: degraded ? ('degraded' as const) : ('ok' as const),
  };
}

/** Hourly-ish cleanup helpers (called from worker). */
export async function cleanupOldRows() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  await prisma.outboxJob.deleteMany({
    where: { status: 'DONE', createdAt: { lt: sevenDaysAgo } },
  });
  await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: oneDayAgo } },
  });
}
