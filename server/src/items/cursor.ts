import { z } from 'zod';
import { validationError } from '../lib/errors.js';

const cursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();

export type ListCursor = z.infer<typeof cursorSchema>;

/** Encode cursor as base64url JSON — opaque to clients, easy to validate. */
export function encodeCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): ListCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = cursorSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      throw validationError('Invalid cursor');
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid cursor') {
      throw err;
    }
    throw validationError('Invalid cursor');
  }
}

/**
 * Escape \, %, _ so a search for "%" does not match everything (Gap 5 / ILIKE injection).
 */
export function escapeIlike(q: string): string {
  return q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
