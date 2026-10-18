/**
 * Deterministic seed: teams + Akhilesh-centric demo users + sample work items.
 * Safe to re-run: skips users if any exist; still adds items if the table is empty.
 */
import bcrypt from 'bcryptjs';
import {
  ItemType,
  Priority,
  PrismaClient,
  Role,
  Status,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@1234';

type SeedUser = {
  email: string;
  name: string;
  isAdmin?: boolean;
  memberships: { team: string; role: Role }[];
};

const TEAMS = ['Payments', 'Support', 'Platform', 'Compliance'] as const;

const USERS: SeedUser[] = [
  {
    email: 'akhilesh.admin@ops.test',
    name: 'Akhilesh Admin',
    isAdmin: true,
    memberships: [],
  },
  {
    email: 'akhilesh@ops.test',
    name: 'Akhilesh',
    memberships: [{ team: 'Payments', role: 'LEAD' }],
  },
  {
    email: 'akhilesh.member@ops.test',
    name: 'Akhilesh Member',
    memberships: [{ team: 'Payments', role: 'MEMBER' }],
  },
  {
    email: 'akhilesh.viewer@ops.test',
    name: 'Akhilesh Viewer',
    memberships: [{ team: 'Payments', role: 'VIEWER' }],
  },
  {
    email: 'riya@ops.test',
    name: 'Riya',
    memberships: [
      { team: 'Payments', role: 'MEMBER' },
      { team: 'Support', role: 'VIEWER' },
    ],
  },
  {
    email: 'sara.lead@ops.test',
    name: 'Sara',
    memberships: [{ team: 'Support', role: 'LEAD' }],
  },
  {
    email: 'vikram@ops.test',
    name: 'Vikram',
    memberships: [{ team: 'Support', role: 'MEMBER' }],
  },
  {
    email: 'dev@ops.test',
    name: 'Dev',
    memberships: [
      { team: 'Platform', role: 'LEAD' },
      { team: 'Compliance', role: 'MEMBER' },
    ],
  },
  {
    email: 'anita@ops.test',
    name: 'Anita',
    memberships: [{ team: 'Platform', role: 'MEMBER' }],
  },
  {
    email: 'kabir@ops.test',
    name: 'Kabir',
    memberships: [{ team: 'Compliance', role: 'LEAD' }],
  },
  {
    email: 'meera@ops.test',
    name: 'Meera',
    memberships: [{ team: 'Compliance', role: 'MEMBER' }],
  },
  {
    email: 'outsider@ops.test',
    name: 'Outsider',
    memberships: [{ team: 'Platform', role: 'MEMBER' }],
  },
];

async function seedUsersAndTeams() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.info('seed_users_skipped reason=already_seeded');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const name of TEAMS) {
    await prisma.team.create({ data: { name } });
  }
  const teams = await prisma.team.findMany();
  const teamIds = new Map(teams.map((t) => [t.name, t.id]));

  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        passwordHash,
        isAdmin: u.isAdmin ?? false,
      },
    });
    for (const m of u.memberships) {
      const teamId = teamIds.get(m.team);
      if (!teamId) {
        throw new Error(`Unknown team: ${m.team}`);
      }
      await prisma.membership.create({
        data: { userId: user.id, teamId, role: m.role },
      });
    }
  }
  console.info(`seed_users_ok count=${USERS.length} password=${DEMO_PASSWORD}`);
}

async function seedSampleItems() {
  const itemCount = await prisma.workItem.count();
  if (itemCount > 0) {
    console.info('seed_items_skipped reason=already_have_items');
    return;
  }

  const teams = await prisma.team.findMany();
  const teamByName = new Map(teams.map((t) => [t.name, t.id]));
  const paymentsId = teamByName.get('Payments')!;
  const supportId = teamByName.get('Support')!;
  const platformId = teamByName.get('Platform')!;

  const akhilesh = await prisma.user.findUniqueOrThrow({
    where: { email: 'akhilesh@ops.test' },
  });
  const member = await prisma.user.findUniqueOrThrow({
    where: { email: 'akhilesh.member@ops.test' },
  });
  const riya = await prisma.user.findUniqueOrThrow({ where: { email: 'riya@ops.test' } });
  const outsider = await prisma.user.findUniqueOrThrow({
    where: { email: 'outsider@ops.test' },
  });

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  type Row = {
    teamId: string;
    title: string;
    description: string;
    type: ItemType;
    priority: Priority;
    status: Status;
    assigneeId: string | null;
    createdById: string;
    dueDate?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  };

  const samples: Row[] = [
    // Unassigned urgent — shows in unassigned_urgent for Payments Lead
    {
      teamId: paymentsId,
      title: 'Urgent payment mismatch for order 8842',
      description: 'Customer charged twice. Needs investigation and refund decision.',
      type: 'PAYMENT',
      priority: 'URGENT',
      status: 'OPEN',
      assigneeId: null,
      createdById: riya.id,
    },
    {
      teamId: paymentsId,
      title: 'High priority wire transfer stuck',
      description: 'Wire shows pending in bank portal for 6 hours.',
      type: 'PAYMENT',
      priority: 'HIGH',
      status: 'OPEN',
      assigneeId: null,
      createdById: member.id,
    },
    // Assigned to Akhilesh — mine view
    {
      teamId: paymentsId,
      title: 'Review compliance hold on merchant X',
      description: 'Merchant flagged; confirm documents before release.',
      type: 'COMPLIANCE',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assigneeId: akhilesh.id,
      createdById: member.id,
    },
    // Awaiting approval — assignee is member, Lead Akhilesh can approve
    {
      teamId: paymentsId,
      title: 'Refund approval for dispute D-219',
      description: 'Member prepared refund; needs Lead approval before payout.',
      type: 'PAYMENT',
      priority: 'MEDIUM',
      status: 'AWAITING_APPROVAL',
      assigneeId: member.id,
      createdById: member.id,
    },
    {
      teamId: paymentsId,
      title: 'Large payout to vendor needs sign-off',
      description: 'Amount above threshold. Waiting for Lead.',
      type: 'PAYMENT',
      priority: 'URGENT',
      status: 'AWAITING_APPROVAL',
      assigneeId: riya.id,
      createdById: riya.id,
    },
    // Overdue
    {
      teamId: paymentsId,
      title: 'Overdue: reconcile failed batch',
      description: 'Batch failed last week and was never closed out.',
      type: 'TASK',
      priority: 'HIGH',
      status: 'OPEN',
      assigneeId: null,
      createdById: akhilesh.id,
      dueDate: yesterday,
    },
    // Stale (old updatedAt)
    {
      teamId: paymentsId,
      title: 'Stale incident: gateway timeout spike',
      description: 'Opened two weeks ago, no updates since.',
      type: 'INCIDENT',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      assigneeId: riya.id,
      createdById: riya.id,
      createdAt: twoWeeksAgo,
      updatedAt: twoWeeksAgo,
    },
    // Routine task (no approval path)
    {
      teamId: paymentsId,
      title: 'Update runbook for chargebacks',
      description: 'Document the weekly chargeback checklist.',
      type: 'TASK',
      priority: 'LOW',
      status: 'OPEN',
      assigneeId: null,
      createdById: akhilesh.id,
    },
    // Support team — Akhilesh Lead should NOT see in list (404 on detail)
    {
      teamId: supportId,
      title: 'Support-only customer ticket',
      description: 'Only Support team members should see this.',
      type: 'CUSTOMER_ISSUE',
      priority: 'MEDIUM',
      status: 'OPEN',
      assigneeId: null,
      createdById: (
        await prisma.user.findUniqueOrThrow({ where: { email: 'sara.lead@ops.test' } })
      ).id,
    },
    // Platform item for outsider demos
    {
      teamId: platformId,
      title: 'Platform deploy checklist',
      description: 'Visible to Platform members including outsider.',
      type: 'TASK',
      priority: 'LOW',
      status: 'OPEN',
      assigneeId: outsider.id,
      createdById: outsider.id,
    },
  ];

  // Extra filler so pagination is visible (limit default 20)
  for (let i = 1; i <= 25; i++) {
    samples.push({
      teamId: paymentsId,
      title: `Payments backlog item ${i}`,
      description: `Seeded backlog row ${i} for cursor pagination demos.`,
      type: i % 2 === 0 ? 'TASK' : 'CUSTOMER_ISSUE',
      priority: i % 5 === 0 ? 'HIGH' : 'MEDIUM',
      status: 'OPEN',
      assigneeId: null,
      createdById: akhilesh.id,
    });
  }

  for (const s of samples) {
    const item = await prisma.workItem.create({
      data: {
        teamId: s.teamId,
        title: s.title,
        description: s.description,
        type: s.type,
        priority: s.priority,
        status: s.status,
        assigneeId: s.assigneeId,
        createdById: s.createdById,
        dueDate: s.dueDate ?? null,
        ...(s.createdAt ? { createdAt: s.createdAt } : {}),
        ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
      },
    });
    await prisma.activityEvent.create({
      data: {
        itemId: item.id,
        actorId: s.createdById,
        kind: 'CREATED',
        toValue: s.status,
      },
    });
  }

  // Prisma @updatedAt may overwrite stale updatedAt on create — force for stale demo
  const stale = await prisma.workItem.findFirst({
    where: { title: 'Stale incident: gateway timeout spike' },
  });
  if (stale) {
    await prisma.$executeRaw`
      UPDATE "WorkItem" SET "updatedAt" = ${twoWeeksAgo} WHERE id = ${stale.id}::uuid
    `;
  }

  console.info(`seed_items_ok count=${samples.length}`);
}

async function main() {
  await seedUsersAndTeams();
  await seedSampleItems();
  console.info('seed_done main_login=akhilesh@ops.test');
}

main()
  .catch((err) => {
    console.error('seed_failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
