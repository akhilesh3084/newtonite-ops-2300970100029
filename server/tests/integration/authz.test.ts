import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createOpenItem, login, seedBasicWorld } from '../helpers/fixtures.js';

describe('authorization', () => {
  it('should 404 for outsider on read/claim/comment', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });
    const token = await login(world.outsider.email);

    const read = await request(app())
      .get(`/api/v1/work-items/${item.id}`)
      .set('Authorization', `Bearer ${token}`);
    const claim = await request(app())
      .post(`/api/v1/work-items/${item.id}/claim`)
      .set('Authorization', `Bearer ${token}`);
    const comment = await request(app())
      .post(`/api/v1/work-items/${item.id}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'c1')
      .send({ body: 'Should not work' });

    expect(read.status).toBe(404);
    expect(claim.status).toBe(404);
    expect(comment.status).toBe(404);
  });

  it('should 403 when Viewer tries to claim', async () => {
    const world = await seedBasicWorld();
    const item = await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
    });
    const token = await login(world.viewer.email);

    const claim = await request(app())
      .post(`/api/v1/work-items/${item.id}/claim`)
      .set('Authorization', `Bearer ${token}`);

    expect(claim.status).toBe(403);
  });

  it('should not list other teams for outsider', async () => {
    const world = await seedBasicWorld();
    await createOpenItem({
      teamId: world.payments.id,
      createdById: world.lead.id,
      title: 'Secret payments item',
    });
    const token = await login(world.outsider.email);

    const list = await request(app())
      .get('/api/v1/work-items')
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    const titles = list.body.data.items.map((i: { title: string }) => i.title);
    expect(titles).not.toContain('Secret payments item');
  });
});
