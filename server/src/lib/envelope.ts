import type { Response } from 'express';
import { AppError } from './errors.js';

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Prisma connection failures
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err.code === 'P1001' || err.code === 'P1002')
  ) {
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database unavailable',
      },
    });
    return;
  }

  console.error('unhandled_error', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    },
  });
}
