import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/db.js';
import { app, createOpenItem, login, seedBasicWorld } from '../helpers/fixtures.js';

describe('workflow API', () => {
  it('should reject OPEN → CLOSED', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });
    const token = await login(world.lead.email);

    const res = await request(app())
      .post(`/api/v1/work-items/${item.id}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'bad-jump')
      .send({ version: 1, to: 'CLOSED' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');

    const fresh = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.status).toBe('OPEN');
  });

  it('should reject Member approve', async () => {
    const world = await seedBasicWorld();
    const item = await prisma.workItem.create({
      data: {
        teamId: world.payments.id,
        createdById: world.memberA.id,
        assigneeId: world.memberA.id,
        title: 'Needs approval',
        description: 'Payment item waiting for lead approval now.',
        type: 'PAYMENT',
        status: 'AWAITING_APPROVAL',
        priority: 'HIGH',
      },
    });
    const token = await login(world.memberB.email);

    const res = await request(app())
      .post(`/api/v1/work-items/${item.id}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'member-approve')
      .send({ version: 1, to: 'RESOLVED', reason: 'I should not approve this' });

    expect(res.status).toBe(403);
  });

  it('should reject self-approval by Lead assignee', async () => {
    const world = await seedBasicWorld();
    const item = await prisma.workItem.create({
      data: {
        teamId: world.payments.id,
        createdById: world.memberA.id,
        assigneeId: world.lead.id,
        title: 'Lead should not self approve',
        description: 'Payment item waiting for lead approval now.',
        type: 'PAYMENT',
        status: 'AWAITING_APPROVAL',
        priority: 'HIGH',
      },
    });
    const token = await login(world.lead.email);

    const res = await request(app())
      .post(`/api/v1/work-items/${item.id}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'self-approve')
      .send({ version: 1, to: 'RESOLVED', reason: 'Approving my own work' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('should reject resolve without a note', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.memberA.id,
      type: 'TASK',
    });
    const token = await login(world.memberA.email);
    await request(app())
      .post(`/api/v1/work-items/${item.id}/claim`)
      .set('Authorization', `Bearer ${token}`);

    const fresh = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });

    const res = await request(app())
      .post(`/api/v1/work-items/${item.id}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'no-reason')
      .send({ version: fresh.version, to: 'RESOLVED' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REASON_REQUIRED');
  });
});
