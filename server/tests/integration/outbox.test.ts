import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db.js';
import { processBatch } from '../../src/outbox/process-batch.js';
import { createOpenItem, seedBasicWorld } from '../helpers/fixtures.js';

describe('outbox worker', () => {
  it('should create one notification even if the job is processed twice', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });

    const job = await prisma.outboxJob.create({
      data: {
        type: 'ITEM_ASSIGNED',
        payload: {
          itemId: item.id,
          userId: world.memberA.id,
          actorId: world.lead.id,
        },
      },
    });

    const first = await processBatch();
    expect(first.done).toBeGreaterThanOrEqual(1);

    // Force the same job to run again (simulates at-least-once)
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { status: 'PENDING', runAfter: new Date(), attempts: 1, lockedAt: null },
    });
    await processBatch();

    const notifications = await prisma.notification.count({
      where: { userId: world.memberA.id, itemId: item.id },
    });
    expect(notifications).toBe(1);
  });

  it('should recover a stuck PROCESSING job after lock timeout', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });

    const old = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.outboxJob.create({
      data: {
        type: 'ITEM_ASSIGNED',
        payload: {
          itemId: item.id,
          userId: world.memberA.id,
          actorId: world.lead.id,
        },
        status: 'PROCESSING',
        lockedAt: old,
        attempts: 1,
      },
    });

    const result = await processBatch();
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    expect(result.done).toBeGreaterThanOrEqual(1);

    const notifications = await prisma.notification.count({
      where: { userId: world.memberA.id },
    });
    expect(notifications).toBe(1);
  });
});
