import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/db.js';
import { app, createOpenItem, login, seedBasicWorld } from '../helpers/fixtures.js';

describe('optimistic version', () => {
  it('should reject PATCH with a stale version and leave the row unchanged', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });
    const token = await login(world.lead.email);

    const eventsBefore = await prisma.activityEvent.count({ where: { itemId: item.id } });

    const res = await request(app())
      .patch(`/api/v1/work-items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 999, priority: 'LOW' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.details.current.version).toBe(1);

    const fresh = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.priority).toBe('HIGH');
    expect(fresh.version).toBe(1);

    const eventsAfter = await prisma.activityEvent.count({ where: { itemId: item.id } });
    expect(eventsAfter).toBe(eventsBefore);
  });
});
