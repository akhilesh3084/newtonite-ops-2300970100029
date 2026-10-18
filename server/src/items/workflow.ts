import type { ItemType, Status, WorkItem } from '@prisma/client';

/**
 * Single source of truth for status jumps (R17 / live-edit friendly).
 * Mutations in Phase 4 will call this; Phase 3 uses it for nextStep + allowedTransitions.
 */

export type TransitionAction =
  | 'start'
  | 'release'
  | 'submit'
  | 'resolve'
  | 'approve'
  | 'reject'
  | 'close'
  | 'reopen';

/** Types that must go through approval before resolve */
export const APPROVAL_TYPES: ReadonlySet<ItemType> = new Set(['PAYMENT', 'COMPLIANCE']);

type Edge = {
  to: Status;
  action: TransitionAction;
};

/** from → allowed targets */
export const TRANSITIONS: Record<Status, Edge[]> = {
  OPEN: [
    { to: 'IN_PROGRESS', action: 'start' },
    // claim is separate (OPEN → IN_PROGRESS + assign self)
  ],
  IN_PROGRESS: [
    { to: 'OPEN', action: 'release' },
    { to: 'AWAITING_APPROVAL', action: 'submit' },
    { to: 'RESOLVED', action: 'resolve' },
  ],
  AWAITING_APPROVAL: [
    { to: 'RESOLVED', action: 'approve' },
    { to: 'IN_PROGRESS', action: 'reject' },
  ],
  RESOLVED: [
    { to: 'CLOSED', action: 'close' },
    { to: 'IN_PROGRESS', action: 'reopen' },
  ],
  CLOSED: [],
};

export function isTransitionAllowed(from: Status, to: Status): boolean {
  return (TRANSITIONS[from] ?? []).some((e) => e.to === to);
}

export function actionForTransition(from: Status, to: Status): TransitionAction | null {
  return (TRANSITIONS[from] ?? []).find((e) => e.to === to)?.action ?? null;
}

export function allowedTransitions(item: WorkItem): Status[] {
  const edges = TRANSITIONS[item.status] ?? [];
  return edges
    .filter((e) => {
      if (e.action === 'submit') {
        return APPROVAL_TYPES.has(item.type);
      }
      if (e.action === 'resolve') {
        return !APPROVAL_TYPES.has(item.type);
      }
      if (e.action === 'start') {
        return item.assigneeId != null;
      }
      return true;
    })
    .map((e) => e.to);
}

/** Human hint on the detail page — "what requires attention next" (Gap 3). */
export function nextStep(
  item: WorkItem & { assignee?: { name: string } | null },
  viewerId?: string,
): string {
  const overdue =
    item.dueDate != null &&
    item.dueDate < new Date(new Date().toISOString().slice(0, 10)) &&
    item.status !== 'RESOLVED' &&
    item.status !== 'CLOSED';

  const prefix = overdue ? 'OVERDUE · ' : '';

  switch (item.status) {
    case 'OPEN':
      if (!item.assigneeId) {
        return `${prefix}Needs an owner — claim it, or a Lead can assign someone`;
      }
      return `${prefix}Assignee can start work`;
    case 'IN_PROGRESS':
      return `${prefix}Being worked on by ${item.assignee?.name ?? 'assignee'}`;
    case 'AWAITING_APPROVAL':
      if (viewerId && item.assigneeId === viewerId) {
        return `${prefix}Another Lead must approve — you cannot approve your own work`;
      }
      return `${prefix}Waiting for a team Lead to approve`;
    case 'RESOLVED':
      return `${prefix}Can be closed by a Lead or the creator`;
    case 'CLOSED':
      return 'Closed — read-only (comments still allowed)';
    default:
      return prefix.trim() || '—';
  }
}
