import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, escapeIlike } from '../../src/items/cursor.js';
import { AppError } from '../../src/lib/errors.js';

describe('cursor + search escape', () => {
  it('should round-trip a cursor', () => {
    const raw = { createdAt: '2026-01-02T03:04:05.678Z', id: '11111111-1111-4111-8111-111111111111' };
    const encoded = encodeCursor(raw);
    expect(decodeCursor(encoded)).toEqual(raw);
  });

  it('should reject garbage cursors', () => {
    expect(() => decodeCursor('not-valid')).toThrow(AppError);
  });

  it('should escape ILIKE wildcards', () => {
    expect(escapeIlike('%')).toBe('\\%');
    expect(escapeIlike('_')).toBe('\\_');
    expect(escapeIlike('a\\b')).toBe('a\\\\b');
    expect(escapeIlike('incident')).toBe('incident');
  });
});
