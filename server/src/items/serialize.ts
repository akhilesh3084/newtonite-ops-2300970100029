import type { Status, WorkItem } from '@prisma/client';
import type { AuthContext } from '../auth/types.js';
import { can, allowedActions } from '../authz/permissions.js';
import { actionForTransition, allowedTransitions, nextStep } from './workflow.js';

type ItemWithPeople = WorkItem & {
  assignee?: { id: string; name: string; email?: string } | null;
  createdBy?: { id: string; name: string; email?: string };
  team?: { id: string; name: string };
};

/** Transitions the current user can actually run (R12 — UI must not guess). */
export function allowedTransitionsFor(
  ctx: AuthContext,
  item: WorkItem,
): Status[] {
  return allowedTransitions(item).filter((to) => {
    const action = actionForTransition(item.status, to);
    if (!action) return false;
    if (!can(ctx, `transition:${action}`, item).ok) return false;
    // Same rule as mutations — hide self-approve/reject so the UI never dead-ends
    if (
      (action === 'approve' || action === 'reject') &&
      item.assigneeId === ctx.userId
    ) {
      return false;
    }
    return true;
  });
}

export function presentItem(ctx: AuthContext, item: ItemWithPeople) {
  return {
    ...item,
    allowedActions: allowedActions(ctx, item),
    allowedTransitions: allowedTransitionsFor(ctx, item),
    nextStep: nextStep(item, ctx.userId),
  };
}
