import type { Prisma } from '@prisma/client';

type JobPayload = Record<string, unknown>;

async function notifyOnce(
  tx: Prisma.TransactionClient,
  jobId: string,
  userId: string,
  itemId: string,
  message: string,
) {
  // Same job + same user twice → unique constraint → ignore (safe retry)
  await tx.$executeRaw`
    INSERT INTO "Notification" (id, "userId", "itemId", message, "dedupeKey", "createdAt")
    VALUES (gen_random_uuid(), ${userId}::uuid, ${itemId}::uuid, ${message}, ${`${jobId}:${userId}`}, now())
    ON CONFLICT ("dedupeKey") DO NOTHING
  `;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Turn one outbox job into notification row(s).
 * Must be safe if run twice (dedupeKey).
 */
export async function handleJob(
  tx: Prisma.TransactionClient,
  job: { id: string; type: string; payload: unknown },
): Promise<void> {
  const payload = (job.payload ?? {}) as JobPayload;
  const itemId = str(payload.itemId);
  if (!itemId) {
    throw new Error(`job ${job.id} missing itemId`);
  }

  switch (job.type) {
    case 'ITEM_ASSIGNED': {
      const userId = str(payload.userId);
      const actorId = str(payload.actorId);
      if (!userId) throw new Error('ITEM_ASSIGNED missing userId');
      if (userId === actorId) return;
      await notifyOnce(tx, job.id, userId, itemId, 'You were assigned a work item');
      return;
    }

    case 'APPROVAL_REQUESTED': {
      const teamId = str(payload.teamId);
      const actorId = str(payload.actorId);
      const assigneeId = str(payload.assigneeId);
      if (!teamId) throw new Error('APPROVAL_REQUESTED missing teamId');

      const leads = await tx.membership.findMany({
        where: { teamId, role: 'LEAD' },
        select: { userId: true },
      });
      const admins = await tx.user.findMany({
        where: { isAdmin: true },
        select: { id: true },
      });

      const recipients = new Set<string>();
      for (const l of leads) recipients.add(l.userId);
      for (const a of admins) recipients.add(a.id);
      if (actorId) recipients.delete(actorId);
      if (assigneeId) recipients.delete(assigneeId);

      for (const userId of recipients) {
        await notifyOnce(tx, job.id, userId, itemId, 'A work item needs your approval');
      }
      return;
    }

    case 'ITEM_DECIDED': {
      const actorId = str(payload.actorId);
      const assigneeId = str(payload.assigneeId);
      const createdById = str(payload.createdById);
      const decision = str(payload.decision) ?? 'updated';
      const message = `Item was ${decision}d`;

      // Approval request alerts are stale once a decision is made
      await tx.notification.updateMany({
        where: {
          itemId,
          readAt: null,
          message: 'A work item needs your approval',
        },
        data: { readAt: new Date() },
      });

      const recipients = new Set<string>();
      if (assigneeId) recipients.add(assigneeId);
      if (createdById) recipients.add(createdById);
      if (actorId) recipients.delete(actorId);

      for (const userId of recipients) {
        await notifyOnce(tx, job.id, userId, itemId, message);
      }
      return;
    }

    case 'ITEM_REOPENED': {
      const actorId = str(payload.actorId);
      const assigneeId = str(payload.assigneeId);
      if (!assigneeId || assigneeId === actorId) return;
      await notifyOnce(tx, job.id, assigneeId, itemId, 'A work item assigned to you was reopened');
      return;
    }

    default:
      throw new Error(`unknown_job_type:${job.type}`);
  }
}
