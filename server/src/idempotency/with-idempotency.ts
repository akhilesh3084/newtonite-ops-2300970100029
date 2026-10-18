import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { idempotencyKeyReused, validationError } from '../lib/errors.js';

const KEY_RE = /^[A-Za-z0-9_-]{1,255}$/;

export function parseIdempotencyKey(raw: string | undefined): string {
  if (!raw || !KEY_RE.test(raw)) {
    throw validationError(
      'Idempotency-Key header is required (1–255 chars: letters, numbers, _ -)',
    );
  }
  return raw;
}

export function hashRequest(method: string, path: string, body: unknown): string {
  const canonical = JSON.stringify(body ?? null);
  return createHash('sha256')
    .update(`${method.toUpperCase()}:${path}:${canonical}`)
    .digest('hex');
}

type StoredResponse = {
  statusCode: number;
  body: unknown;
};

/**
 * Ensures POST retries don't double-create.
 * - Same key + same body → return stored response
 * - Same key + different body → 422
 * - New key → run fn, store result
 *
 * If fn throws, the transaction rolls back and the key is NOT kept,
 * so a corrected retry with the same key can succeed.
 */
export async function withIdempotency<T>(
  userId: string,
  key: string,
  requestHash: string,
  fn: (tx: Prisma.TransactionClient) => Promise<{ statusCode: number; body: T }>,
): Promise<{ statusCode: number; body: T; replayed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ userId: string }[]>`
      INSERT INTO "IdempotencyKey" ("userId", "key", "requestHash", "statusCode", "responseBody", "createdAt")
      VALUES (${userId}::uuid, ${key}, ${requestHash}, 0, '{}'::jsonb, now())
      ON CONFLICT ("userId", "key") DO NOTHING
      RETURNING "userId"
    `;

    if (inserted.length === 0) {
      const existing = await tx.idempotencyKey.findUniqueOrThrow({
        where: { userId_key: { userId, key } },
      });
      if (existing.requestHash !== requestHash) {
        throw idempotencyKeyReused();
      }
      if (existing.statusCode === 0) {
        // Concurrent request still in flight — wait briefly by re-reading
        // (unique lock held by other txn until commit). After conflict path,
        // the other txn has committed.
        throw validationError('Idempotent request still processing; retry shortly');
      }
      return {
        statusCode: existing.statusCode,
        body: existing.responseBody as T,
        replayed: true,
      };
    }

    const result = await fn(tx);

    await tx.idempotencyKey.update({
      where: { userId_key: { userId, key } },
      data: {
        statusCode: result.statusCode,
        responseBody: result.body as Prisma.InputJsonValue,
      },
    });

    return { ...result, replayed: false };
  });
}

/** For claim etc. that don't use the helper but still need a plain transaction. */
export { type StoredResponse };
