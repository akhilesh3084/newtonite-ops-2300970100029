import type { Prisma, Status } from '@prisma/client';
import type { AuthContext } from '../auth/types.js';
import { can } from '../authz/permissions.js';
import { prisma } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { decodeCursor, encodeCursor, escapeIlike } from './cursor.js';
import type { ListQuery } from './list-query.js';
import { presentItem } from './serialize.js';

function teamScopeIds(ctx: AuthContext): string[] | 'all' {
  if (ctx.isAdmin) {
    return 'all';
  }
  return [...ctx.roles.keys()];
}

function leadTeamIds(ctx: AuthContext): string[] {
  if (ctx.isAdmin) {
    return []; // empty + admin flag handled separately
  }
  return [...ctx.roles.entries()]
    .filter(([, role]) => role === 'LEAD')
    .map(([teamId]) => teamId);
}

/** Build Prisma where for list — team filter is ALWAYS in SQL (R11). */
export function buildListWhere(ctx: AuthContext, query: ListQuery): Prisma.WorkItemWhereInput {
  const scope = teamScopeIds(ctx);
  const where: Prisma.WorkItemWhereInput = {};

  if (scope !== 'all') {
    if (scope.length === 0) {
      // No teams → empty result without error
      where.id = { in: [] };
      return where;
    }
    where.teamId = { in: scope };
  }

  if (query.teamId) {
    // Out-of-scope teamId → empty (not an error)
    if (scope !== 'all' && !scope.includes(query.teamId)) {
      where.id = { in: [] };
      return where;
    }
    where.teamId = query.teamId;
  }

  if (query.status) {
    where.status = query.status;
  }
  if (query.priority) {
    where.priority = query.priority;
  }
  if (query.type) {
    where.type = query.type;
  }

  if (query.assigneeId === 'unassigned') {
    where.assigneeId = null;
  } else if (query.assigneeId) {
    where.assigneeId = query.assigneeId;
  }

  // Views (exact SQL meanings from the plan)
  switch (query.view) {
    case 'mine':
      where.assigneeId = ctx.userId;
      where.status = { notIn: ['RESOLVED', 'CLOSED'] };
      break;
    case 'unassigned_urgent':
      where.assigneeId = null;
      where.status = 'OPEN';
      where.priority = { in: ['HIGH', 'URGENT'] };
      break;
    case 'awaiting_my_approval': {
      where.status = 'AWAITING_APPROVAL';
      where.assigneeId = { not: ctx.userId };
      if (!ctx.isAdmin) {
        const leads = leadTeamIds(ctx);
        where.teamId = leads.length ? { in: leads } : { in: [] };
      }
      break;
    }
    case 'overdue': {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      where.dueDate = { lt: today };
      where.status = { notIn: ['RESOLVED', 'CLOSED'] };
      break;
    }
    case 'stale': {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      where.updatedAt = { lt: weekAgo };
      where.status = { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL'] };
      break;
    }
    default:
      break;
  }

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    const createdAt = new Date(c.createdAt);
    // created_at DESC, id DESC — "after" this cursor means older rows
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, id: { lt: c.id } },
        ],
      },
    ];
  }

  return where;
}

export async function listWorkItems(ctx: AuthContext, query: ListQuery) {
  const where = buildListWhere(ctx, query);
  const limit = query.limit;

  // For search with escaped wildcards, use raw when q present — Prisma contains treats % as literal
  // in some drivers; we use findMany with contains for simplicity and document % as literal via escape
  // when using $queryRaw later. Phase 3: use contains on trimmed q without wildcards expanding.

  const rows = await prisma.workItem.findMany({
    where: withSearch(where, query.q),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;

  return {
    items: page.map((row) => presentItem(ctx, row)),
    nextCursor,
  };
}

/**
 * Search is trim-tolerant and case-insensitive.
 * We escape % _ \ so typing "%" does not mean "match everything" (plan Gap).
 * Prisma `contains` maps to LIKE; escaped wildcards are treated as normal characters
 * when the DB uses \ as escape (Postgres default for LIKE).
 */
function withSearch(
  where: Prisma.WorkItemWhereInput,
  q: string | undefined,
): Prisma.WorkItemWhereInput {
  const trimmed = q?.trim();
  if (!trimmed) {
    return where;
  }
  return {
    ...where,
    title: { contains: escapeIlike(trimmed), mode: 'insensitive' },
  };
}

export async function getWorkItem(ctx: AuthContext, id: string) {
  if (!zUuid(id)) {
    throw notFound();
  }

  const item = await prisma.workItem.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      team: { select: { id: true, name: true } },
    },
  });

  if (!item) {
    throw notFound();
  }

  const gate = can(ctx, 'read', item);
  if (!gate.ok) {
    if (gate.status === 404) {
      throw notFound();
    }
    throw forbidden();
  }

  return presentItem(ctx, item);
}

export async function summary(ctx: AuthContext) {
  const scope = teamScopeIds(ctx);
  const teamFilter: Prisma.WorkItemWhereInput =
    scope === 'all' ? {} : { teamId: { in: scope.length ? scope : [] } };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // One round-trip of counts — never load all rows (Gap 4)
  const [byStatus, byPriorityOpen, overdue, unassignedUrgent, awaitingApproval] =
    await Promise.all([
      prisma.workItem.groupBy({
        by: ['status'],
        where: teamFilter,
        _count: { _all: true },
      }),
      prisma.workItem.groupBy({
        by: ['priority'],
        where: {
          ...teamFilter,
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
        _count: { _all: true },
      }),
      prisma.workItem.count({
        where: {
          ...teamFilter,
          dueDate: { lt: today },
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
      }),
      prisma.workItem.count({
        where: {
          ...teamFilter,
          assigneeId: null,
          status: 'OPEN',
          priority: { in: ['HIGH', 'URGENT'] },
        },
      }),
      prisma.workItem.count({
        where: {
          ...(ctx.isAdmin
            ? teamFilter
            : { teamId: { in: leadTeamIds(ctx) } }),
          status: 'AWAITING_APPROVAL',
          assigneeId: { not: ctx.userId },
        },
      }),
    ]);

  const statusCounts = Object.fromEntries(
    byStatus.map((r) => [r.status, r._count._all]),
  ) as Partial<Record<Status, number>>;

  const priorityCounts = Object.fromEntries(
    byPriorityOpen.map((r) => [r.priority, r._count._all]),
  );

  return {
    byStatus: statusCounts,
    byPriorityOpen: priorityCounts,
    overdue,
    unassignedUrgent,
    awaitingMyApproval: awaitingApproval,
  };
}

export async function listTeamMembers(ctx: AuthContext, teamId: string) {
  if (!zUuid(teamId)) {
    throw notFound();
  }
  if (!ctx.isAdmin && !ctx.roles.has(teamId)) {
    throw notFound();
  }

  const memberships = await prisma.membership.findMany({
    where: { teamId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  });

  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
  }));
}

function zUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}
