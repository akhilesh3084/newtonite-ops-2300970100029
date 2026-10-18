import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/db.js';
import { app, createOpenItem, login, seedBasicWorld } from '../helpers/fixtures.js';

describe('concurrent claim', () => {
  it('should let exactly one of two parallel claims win (x20)', async () => {
    for (let i = 0; i < 20; i++) {
      const world = await seedBasicWorld();
      const item = await createOpenItem({
        teamId: world.payments.id,
        createdById: world.lead.id,
        title: `Race item ${i}`,
      });

      const tokenA = await login(world.memberA.email);
      const tokenB = await login(world.memberB.email);

      const [resA, resB] = await Promise.all([
        request(app()).post(`/api/v1/work-items/${item.id}/claim`).set('Authorization', `Bearer ${tokenA}`),
        request(app()).post(`/api/v1/work-items/${item.id}/claim`).set('Authorization', `Bearer ${tokenB}`),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const fresh = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(fresh.assigneeId === world.memberA.id || fresh.assigneeId === world.memberB.id).toBe(
        true,
      );

      const assigneeEvents = await prisma.activityEvent.count({
        where: { itemId: item.id, kind: 'ASSIGNEE_CHANGED' },
      });
      expect(assigneeEvents).toBe(1);

      // wipe for next loop iteration (beforeEach also truncates, but we reseed each loop)
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
          "Notification","OutboxJob","IdempotencyKey","Comment","ActivityEvent",
          "WorkItem","Membership","Team","User"
        RESTART IDENTITY CASCADE
      `);
    }
  });

  it('should return 200 twice when the same user claims twice', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });
    const token = await login(world.memberA.email);

    const first = await request(app())
      .post(`/api/v1/work-items/${item.id}/claim`)
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app())
      .post(`/api/v1/work-items/${item.id}/claim`)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const events = await prisma.activityEvent.count({
      where: { itemId: item.id, kind: 'ASSIGNEE_CHANGED' },
    });
    expect(events).toBe(1);
  });
});
