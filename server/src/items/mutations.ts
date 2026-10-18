import type { ItemType, Priority, Prisma, Status, WorkItem } from '@prisma/client';
import type { AuthContext } from '../auth/types.js';
import { can, canCreateOnTeam } from '../authz/permissions.js';
import { prisma } from '../lib/db.js';
import {
  alreadyClaimed,
  AppError,
  assigneeNotEligible,
  forbidden,
  invalidTransition,
  itemClosed,
  notFound,
  reasonRequired,
  selfApprovalForbidden,
  validationError,
  versionConflict,
} from '../lib/errors.js';
import { presentItem } from './serialize.js';
import {
  actionForTransition,
  APPROVAL_TYPES,
  isTransitionAllowed,
} from './workflow.js';

const itemInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  team: { select: { id: true, name: true } },
} as const;

function assertUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw notFound();
  }
}

function throwCan(result: { ok: true } | { ok: false; status: 403 | 404 }): void {
  if (result.ok) return;
  if (result.status === 404) throw notFound();
  throw forbidden();
}

async function loadItem(tx: Prisma.TransactionClient, id: string) {
  const item = await tx.workItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) throw notFound();
  return item;
}

async function reloadPresented(ctx: AuthContext, tx: Prisma.TransactionClient, id: string) {
  const item = await loadItem(tx, id);
  return presentItem(ctx, item);
}

async function enqueue(
  tx: Prisma.TransactionClient,
  type: string,
  payload: Prisma.InputJsonValue,
) {
  await tx.outboxJob.create({
    data: { type, payload },
  });
}

/** B1 — atomic claim */
export async function claimItem(ctx: AuthContext, id: string) {
  assertUuid(id);

  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, id);
    throwCan(can(ctx, 'claim', item));

    // Same user retry → 200 no-op (no new events)
    if (item.assigneeId === ctx.userId) {
      return presentItem(ctx, item);
    }

    if (item.status !== 'OPEN') {
      throw invalidTransition('Only OPEN unassigned items can be claimed');
    }

    const updated = await tx.workItem.updateMany({
      where: { id, assigneeId: null, status: 'OPEN' },
      data: {
        assigneeId: ctx.userId,
        status: 'IN_PROGRESS',
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const current = await reloadPresented(ctx, tx, id);
      if (current.assigneeId === ctx.userId) {
        return current;
      }
      throw alreadyClaimed(current);
    }

    await tx.activityEvent.createMany({
      data: [
        {
          itemId: id,
          actorId: ctx.userId,
          kind: 'ASSIGNEE_CHANGED',
          fromValue: null,
          toValue: ctx.userId,
        },
        {
          itemId: id,
          actorId: ctx.userId,
          kind: 'STATUS_CHANGED',
          fromValue: 'OPEN',
          toValue: 'IN_PROGRESS',
        },
      ],
    });

    // No notify-self
    return reloadPresented(ctx, tx, id);
  });
}

export type CreateInput = {
  title: string;
  description: string;
  type: ItemType;
  priority?: Priority;
  teamId: string;
  dueDate?: string | null;
};

export async function createItem(
  ctx: AuthContext,
  input: CreateInput,
  tx: Prisma.TransactionClient,
) {
  throwCan(canCreateOnTeam(ctx, input.teamId));

  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 3 || title.length > 200) {
    throw validationError('title must be 3–200 characters');
  }
  if (description.length < 10 || description.length > 5000) {
    throw validationError('description must be 10–5000 characters');
  }

  const item = await tx.workItem.create({
    data: {
      title,
      description,
      type: input.type,
      priority: input.priority ?? 'MEDIUM',
      teamId: input.teamId,
      createdById: ctx.userId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      status: 'OPEN',
    },
    include: itemInclude,
  });

  await tx.activityEvent.create({
    data: {
      itemId: item.id,
      actorId: ctx.userId,
      kind: 'CREATED',
      toValue: 'OPEN',
    },
  });

  return presentItem(ctx, item);
}

export type PatchInput = {
  version: number;
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
};

export async function patchItem(ctx: AuthContext, id: string, input: PatchInput) {
  assertUuid(id);

  return prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, id);
    throwCan(can(ctx, 'edit', item));
    if (item.status === 'CLOSED') throw itemClosed();

    const data: Prisma.WorkItemUpdateManyMutationInput = {};
    const events: Prisma.ActivityEventCreateManyInput[] = [];

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (title.length < 3 || title.length > 200) {
        throw validationError('title must be 3–200 characters');
      }
      if (title !== item.title) {
        data.title = title;
        events.push({
          itemId: id,
          actorId: ctx.userId,
          kind: 'FIELD_CHANGED',
          field: 'title',
          fromValue: item.title,
          toValue: title,
        });
      }
    }
    if (input.description !== undefined) {
      const description = input.description.trim();
      if (description.length < 10 || description.length > 5000) {
        throw validationError('description must be 10–5000 characters');
      }
      if (description !== item.description) {
        data.description = description;
        events.push({
          itemId: id,
          actorId: ctx.userId,
          kind: 'FIELD_CHANGED',
          field: 'description',
          fromValue: item.description,
          toValue: description,
        });
      }
    }
    if (input.priority !== undefined && input.priority !== item.priority) {
      data.priority = input.priority;
      events.push({
        itemId: id,
        actorId: ctx.userId,
        kind: 'PRIORITY_CHANGED',
        fromValue: item.priority,
        toValue: input.priority,
      });
    }
    if (input.dueDate !== undefined) {
      const next = input.dueDate === null ? null : new Date(input.dueDate);
      const prev = item.dueDate;
      const same =
        (prev === null && next === null) ||
        (prev !== null && next !== null && prev.toISOString().slice(0, 10) === next.toISOString().slice(0, 10));
      if (!same) {
        data.dueDate = next;
        events.push({
          itemId: id,
          actorId: ctx.userId,
          kind: 'FIELD_CHANGED',
          field: 'dueDate',
          fromValue: prev?.toISOString().slice(0, 10) ?? null,
          toValue: next?.toISOString().slice(0, 10) ?? null,
        });
      }
    }

    if (events.length === 0) {
      return presentItem(ctx, item);
    }

    data.version = { increment: 1 };

    const updated = await tx.workItem.updateMany({
      where: { id, version: input.version },
      data,
    });
    if (updated.count === 0) {
      throw versionConflict(await reloadPresented(ctx, tx, id));
    }

    await tx.activityEvent.createMany({ data: events });
    return reloadPresented(ctx, tx, id);
  });
}

export type AssignInput = { version: number; assigneeId: string | null };

export async function assignItem(ctx: AuthContext, id: string, input: AssignInput, tx: Prisma.TransactionClient) {
  assertUuid(id);
  const item = await loadItem(tx, id);
  throwCan(can(ctx, 'assign', item));
  if (item.status === 'CLOSED') throw itemClosed();
  if (item.status !== 'OPEN' && item.status !== 'IN_PROGRESS') {
    throw invalidTransition('Assign is only allowed in OPEN or IN_PROGRESS');
  }

  if (input.assigneeId !== null) {
    const membership = await tx.membership.findUnique({
      where: {
        userId_teamId: { userId: input.assigneeId, teamId: item.teamId },
      },
    });
    if (!membership || membership.role === 'VIEWER') {
      throw assigneeNotEligible();
    }
  }

  if (input.assigneeId === item.assigneeId) {
    return presentItem(ctx, item);
  }

  const updated = await tx.workItem.updateMany({
    where: { id, version: input.version },
    data: {
      assigneeId: input.assigneeId,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) {
    throw versionConflict(await reloadPresented(ctx, tx, id));
  }

  await tx.activityEvent.create({
    data: {
      itemId: id,
      actorId: ctx.userId,
      kind: 'ASSIGNEE_CHANGED',
      fromValue: item.assigneeId,
      toValue: input.assigneeId,
    },
  });

  if (input.assigneeId && input.assigneeId !== ctx.userId) {
    await enqueue(tx, 'ITEM_ASSIGNED', {
      itemId: id,
      userId: input.assigneeId,
      actorId: ctx.userId,
    });
  }

  return reloadPresented(ctx, tx, id);
}

export type TransitionInput = { version: number; to: Status; reason?: string };

export async function transitionItem(
  ctx: AuthContext,
  id: string,
  input: TransitionInput,
  tx: Prisma.TransactionClient,
) {
  assertUuid(id);
  const item = await loadItem(tx, id);
  if (item.status === 'CLOSED') throw itemClosed();

  if (!isTransitionAllowed(item.status, input.to)) {
    throw invalidTransition(`Cannot move from ${item.status} to ${input.to}`);
  }

  const action = actionForTransition(item.status, input.to);
  if (!action) {
    throw invalidTransition(`Cannot move from ${item.status} to ${input.to}`);
  }

  throwCan(can(ctx, `transition:${action}`, item));

  // Type rules
  if (action === 'submit' && !APPROVAL_TYPES.has(item.type)) {
    throw invalidTransition('Only PAYMENT and COMPLIANCE items submit for approval');
  }
  if (action === 'resolve' && APPROVAL_TYPES.has(item.type)) {
    throw invalidTransition('PAYMENT and COMPLIANCE must be approved, not resolved directly');
  }
  if (action === 'start' && !item.assigneeId) {
    throw invalidTransition('Assign someone before starting');
  }

  if ((action === 'approve' || action === 'reject') && item.assigneeId === ctx.userId) {
    throw selfApprovalForbidden();
  }

  const needsReason = action === 'reject' || action === 'reopen' || action === 'resolve';
  const reason = input.reason?.trim() ?? '';
  if (needsReason && reason.length < 5) {
    throw reasonRequired(
      action === 'resolve'
        ? 'Resolution note is required (min 5 characters)'
        : 'A reason is required (min 5 characters)',
    );
  }

  const updated = await tx.workItem.updateMany({
    where: { id, version: input.version, status: item.status },
    data:
      action === 'release'
        ? { status: input.to, version: { increment: 1 }, assigneeId: null }
        : { status: input.to, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw versionConflict(await reloadPresented(ctx, tx, id));
  }

  await tx.activityEvent.create({
    data: {
      itemId: id,
      actorId: ctx.userId,
      kind: 'STATUS_CHANGED',
      fromValue: item.status,
      toValue: input.to,
    },
  });

  if (action === 'release') {
    await tx.activityEvent.create({
      data: {
        itemId: id,
        actorId: ctx.userId,
        kind: 'ASSIGNEE_CHANGED',
        fromValue: item.assigneeId,
        toValue: null,
      },
    });
  }

  if (needsReason && reason) {
    await tx.comment.create({
      data: { itemId: id, authorId: ctx.userId, body: reason },
    });
    await tx.activityEvent.create({
      data: {
        itemId: id,
        actorId: ctx.userId,
        kind: 'COMMENTED',
        toValue: reason.slice(0, 200),
      },
    });
  }

  // Outbox (worker in Phase 5)
  if (action === 'submit') {
    await enqueue(tx, 'APPROVAL_REQUESTED', {
      itemId: id,
      teamId: item.teamId,
      actorId: ctx.userId,
      assigneeId: item.assigneeId,
    });
  }
  if (action === 'approve' || action === 'reject') {
    await enqueue(tx, 'ITEM_DECIDED', {
      itemId: id,
      decision: action,
      actorId: ctx.userId,
      assigneeId: item.assigneeId,
      createdById: item.createdById,
    });
  }
  if (action === 'reopen' && item.assigneeId) {
    await enqueue(tx, 'ITEM_REOPENED', {
      itemId: id,
      actorId: ctx.userId,
      assigneeId: item.assigneeId,
    });
  }
  if (action === 'resolve' && item.createdById !== ctx.userId) {
    await enqueue(tx, 'ITEM_DECIDED', {
      itemId: id,
      decision: 'resolve',
      actorId: ctx.userId,
      assigneeId: item.assigneeId,
      createdById: item.createdById,
    });
  }

  return reloadPresented(ctx, tx, id);
}

export async function addComment(
  ctx: AuthContext,
  id: string,
  body: string,
  tx: Prisma.TransactionClient,
) {
  assertUuid(id);
  const item = await loadItem(tx, id);
  throwCan(can(ctx, 'comment', item));

  const text = body.trim();
  if (text.length < 1 || text.length > 5000) {
    throw validationError('body must be 1–5000 characters');
  }

  const comment = await tx.comment.create({
    data: { itemId: id, authorId: ctx.userId, body: text },
  });
  await tx.activityEvent.create({
    data: {
      itemId: id,
      actorId: ctx.userId,
      kind: 'COMMENTED',
      toValue: text.slice(0, 200),
    },
  });

  return comment;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUserId(value: string | null): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export async function listActivity(ctx: AuthContext, id: string, limit = 20) {
  assertUuid(id);
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw notFound();
  throwCan(can(ctx, 'read', item));

  const rows = await prisma.activityEvent.findMany({
    where: { itemId: id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { actor: { select: { id: true, name: true } } },
  });

  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'ASSIGNEE_CHANGED') {
      if (looksLikeUserId(row.fromValue)) userIds.add(row.fromValue);
      if (looksLikeUserId(row.toValue)) userIds.add(row.toValue);
    }
  }

  const users =
    userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        })
      : [];
  const names = new Map(users.map((u) => [u.id, u.name]));

  return {
    items: rows.map((row) => {
      if (row.kind !== 'ASSIGNEE_CHANGED') return row;
      return {
        ...row,
        fromValue: row.fromValue
          ? (names.get(row.fromValue) ?? 'Someone')
          : null,
        toValue: row.toValue ? (names.get(row.toValue) ?? 'Someone') : null,
      };
    }),
  };
}

export async function listComments(ctx: AuthContext, id: string, limit = 20) {
  assertUuid(id);
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw notFound();
  throwCan(can(ctx, 'read', item));

  const rows = await prisma.comment.findMany({
    where: { itemId: id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { author: { select: { id: true, name: true } } },
  });
  return { items: rows };
}

/** Re-throw AppError; used by routes after idempotency wrapper */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export type { WorkItem };
