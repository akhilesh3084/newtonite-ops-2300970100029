import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';

const PASSWORD = 'Demo@1234';
let cachedHash: string | null = null;

async function passwordHash() {
  if (!cachedHash) {
    cachedHash = await bcrypt.hash(PASSWORD, 4); // cost 4 = faster tests
  }
  return cachedHash;
}

export async function seedBasicWorld() {
  const hash = await passwordHash();

  const payments = await prisma.team.create({ data: { name: 'Payments' } });
  const platform = await prisma.team.create({ data: { name: 'Platform' } });

  const lead = await prisma.user.create({
    data: {
      email: 'lead@test.local',
      name: 'Lead',
      passwordHash: hash,
      memberships: { create: { teamId: payments.id, role: 'LEAD' } },
    },
  });
  const memberA = await prisma.user.create({
    data: {
      email: 'member-a@test.local',
      name: 'Member A',
      passwordHash: hash,
      memberships: { create: { teamId: payments.id, role: 'MEMBER' } },
    },
  });
  const memberB = await prisma.user.create({
    data: {
      email: 'member-b@test.local',
      name: 'Member B',
      passwordHash: hash,
      memberships: { create: { teamId: payments.id, role: 'MEMBER' } },
    },
  });
  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@test.local',
      name: 'Viewer',
      passwordHash: hash,
      memberships: { create: { teamId: payments.id, role: 'VIEWER' } },
    },
  });
  const outsider = await prisma.user.create({
    data: {
      email: 'outsider@test.local',
      name: 'Outsider',
      passwordHash: hash,
      memberships: { create: { teamId: platform.id, role: 'MEMBER' } },
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: 'admin@test.local',
      name: 'Admin',
      passwordHash: hash,
      isAdmin: true,
    },
  });

  return { payments, platform, lead, memberA, memberB, viewer, outsider, admin, password: PASSWORD };
}

export function app() {
  return createApp();
}

export async function login(email: string, password = PASSWORD) {
  const res = await request(app()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token as string;
}

export async function createOpenItem(opts: {
  teamId: string;
  createdById: string;
  type?: 'TASK' | 'PAYMENT' | 'COMPLIANCE';
  title?: string;
}) {
  return prisma.workItem.create({
    data: {
      teamId: opts.teamId,
      createdById: opts.createdById,
      title: opts.title ?? 'Test item for claims',
      description: 'Automated test description long enough.',
      type: opts.type ?? 'TASK',
      status: 'OPEN',
      priority: 'HIGH',
    },
  });
}
