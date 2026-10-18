import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { prisma } from '../lib/db.js';
import { sendError, sendSuccess } from '../lib/envelope.js';
import { notFound } from '../lib/errors.js';

export const notificationsRouter = Router();

/** Clear "needs approval" alerts when the item is no longer awaiting approval. */
async function dismissStaleApprovalAlerts(userId: string) {
  await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      message: 'A work item needs your approval',
      item: { status: { not: 'AWAITING_APPROVAL' } },
    },
    data: { readAt: new Date() },
  });
}

/** GET /api/v1/notifications — only YOUR notifications */
notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    await dismissStaleApprovalAlerts(userId);

    const items = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        item: { select: { id: true, title: true, status: true } },
      },
    });
    const unread = items.filter((n) => n.readAt == null).length;
    sendSuccess(res, { items, unread });
  } catch (err) {
    sendError(res, err);
  }
});

/** POST /api/v1/notifications/read-all */
notificationsRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    sendSuccess(res, { marked: result.count });
  } catch (err) {
    sendError(res, err);
  }
});

/** POST /api/v1/notifications/:id/read */
notificationsRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const id = req.params.id!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw notFound();
    }
    const updated = await prisma.notification.updateMany({
      where: { id, userId: req.auth!.userId },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      throw notFound();
    }
    sendSuccess(res, { id, read: true });
  } catch (err) {
    sendError(res, err);
  }
});
