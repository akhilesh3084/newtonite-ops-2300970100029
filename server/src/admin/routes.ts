import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../lib/db.js';
import { sendError, sendSuccess } from '../lib/envelope.js';
import { forbidden, notFound, validationError } from '../lib/errors.js';

export const adminRouter = Router();

function requireAdmin(req: Request): void {
  if (!req.auth?.isAdmin) {
    throw forbidden('Admin only');
  }
}

const listQuery = z
  .object({
    status: z.enum(['PENDING', 'PROCESSING', 'DONE', 'FAILED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** GET /api/v1/admin/jobs */
adminRouter.get('/admin/jobs', requireAuth, async (req, res) => {
  try {
    requireAdmin(req);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      throw validationError('Invalid query', parsed.error.flatten());
    }
    const items = await prisma.outboxJob.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
    });
    sendSuccess(res, { items });
  } catch (err) {
    sendError(res, err);
  }
});

/** POST /api/v1/admin/jobs/:id/retry — FAILED → PENDING */
adminRouter.post('/admin/jobs/:id/retry', requireAuth, async (req, res) => {
  try {
    requireAdmin(req);
    const id = req.params.id!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw notFound();
    }
    const job = await prisma.outboxJob.findUnique({ where: { id } });
    if (!job) {
      throw notFound();
    }
    if (job.status !== 'FAILED') {
      throw validationError('Only FAILED jobs can be retried');
    }
    const updated = await prisma.outboxJob.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        runAfter: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
    sendSuccess(res, updated);
  } catch (err) {
    sendError(res, err);
  }
});
