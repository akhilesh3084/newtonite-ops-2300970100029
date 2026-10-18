import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/lib/db.js';
import { app, login, seedBasicWorld } from '../helpers/fixtures.js';

describe('idempotent create', () => {
  it('should create one item when the same key is sent twice', async () => {
    const world = await seedBasicWorld();
    const token = await login(world.memberA.email);
    const body = {
      title: 'Idempotent create',
      description: 'Must only insert once when retried with same key.',
      type: 'TASK',
      teamId: world.payments.id,
    };

    const first = await request(app())
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-same-1')
      .send(body);
    const second = await request(app())
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-same-1')
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const count = await prisma.workItem.count({ where: { title: 'Idempotent create' } });
    expect(count).toBe(1);
  });

  it('should return 422 when the same key is reused with a different body', async () => {
    const world = await seedBasicWorld();
    const token = await login(world.memberA.email);

    await request(app())
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-diff-1')
      .send({
        title: 'First body title',
        description: 'Must only insert once when retried with same key.',
        type: 'TASK',
        teamId: world.payments.id,
      });

    const second = await request(app())
      .post('/api/v1/work-items')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-diff-1')
      .send({
        title: 'Second body title different',
        description: 'Must only insert once when retried with same key.',
        type: 'TASK',
        teamId: world.payments.id,
      });

    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
