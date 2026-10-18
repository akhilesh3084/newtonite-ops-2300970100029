import type { Role, WorkItem } from '@prisma/client';
import type { AuthContext } from '../auth/types.js';

/**
 * Every permission decision goes through here (R8).
 * Routes must not check roles inline.
 */

export type Action =
  | 'read'
  | 'comment'
  | 'create'
  | 'claim'
  | 'edit'
  | 'assign'
  | 'transition:start'
  | 'transition:release'
  | 'transition:submit'
  | 'transition:resolve'
  | 'transition:approve'
  | 'transition:reject'
  | 'transition:close'
  | 'transition:reopen';

export type CanResult = { ok: true } | { ok: false; status: 403 | 404 };

function roleOnTeam(ctx: AuthContext, teamId: string): Role | null {
  if (ctx.isAdmin) {
    return 'LEAD'; // admin acts with lead-level powers everywhere
  }
  return ctx.roles.get(teamId) ?? null;
}

/** Invisible team → 404. Visible but wrong role → 403. (R10) */
function visibility(ctx: AuthContext, teamId: string): CanResult | null {
  if (ctx.isAdmin) {
    return null;
  }
  if (!ctx.roles.has(teamId)) {
    return { ok: false, status: 404 };
  }
  return null;
}

export function can(ctx: AuthContext, action: Action, item: WorkItem): CanResult {
  const hidden = visibility(ctx, item.teamId);
  if (hidden) {
    return hidden;
  }

  const role = roleOnTeam(ctx, item.teamId);
  const isAssignee = item.assigneeId === ctx.userId;
  const isCreator = item.createdById === ctx.userId;
  const closed = item.status === 'CLOSED';

  switch (action) {
    case 'read':
      return { ok: true };

    case 'comment':
      if (role === 'VIEWER') {
        return { ok: false, status: 403 };
      }
      return { ok: true };

    case 'create':
      // create is checked against teamId before an item exists — use canCreateTeam
      return { ok: false, status: 403 };

    case 'claim':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (role === 'VIEWER') {
        return { ok: false, status: 403 };
      }
      return { ok: true };

    case 'edit':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (role === 'VIEWER') {
        return { ok: false, status: 403 };
      }
      if (role === 'LEAD' || ctx.isAdmin) {
        return { ok: true };
      }
      // Member: assignee or creator
      if (isAssignee || isCreator) {
        return { ok: true };
      }
      return { ok: false, status: 403 };

    case 'assign':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (role === 'LEAD' || ctx.isAdmin) {
        return { ok: true };
      }
      return { ok: false, status: 403 };

    case 'transition:start':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (!isAssignee && !ctx.isAdmin) {
        return { ok: false, status: 403 };
      }
      return { ok: true };

    case 'transition:release':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (isAssignee || role === 'LEAD' || ctx.isAdmin) {
        return { ok: true };
      }
      return { ok: false, status: 403 };

    case 'transition:submit':
    case 'transition:resolve':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (!isAssignee && !ctx.isAdmin) {
        return { ok: false, status: 403 };
      }
      return { ok: true };

    case 'transition:approve':
    case 'transition:reject':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (!(role === 'LEAD' || ctx.isAdmin)) {
        return { ok: false, status: 403 };
      }
      // Self-approval is a business rule (422), not 403 — checked in workflow
      return { ok: true };

    case 'transition:close':
    case 'transition:reopen':
      if (closed) {
        return { ok: false, status: 403 };
      }
      if (role === 'LEAD' || ctx.isAdmin || isCreator) {
        return { ok: true };
      }
      return { ok: false, status: 403 };

    default:
      return { ok: false, status: 403 };
  }
}

export function canCreateOnTeam(ctx: AuthContext, teamId: string): CanResult {
  const hidden = visibility(ctx, teamId);
  if (hidden) {
    return hidden;
  }
  const role = roleOnTeam(ctx, teamId);
  if (role === 'VIEWER') {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}

/** Same rules as can() — used so the UI never re-implements permissions (R12). */
export function allowedActions(ctx: AuthContext, item: WorkItem): Action[] {
  const actions: Action[] = [
    'read',
    'comment',
    'claim',
    'edit',
    'assign',
    'transition:start',
    'transition:release',
    'transition:submit',
    'transition:resolve',
    'transition:approve',
    'transition:reject',
    'transition:close',
    'transition:reopen',
  ];
  return actions.filter((a) => can(ctx, a, item).ok);
}
