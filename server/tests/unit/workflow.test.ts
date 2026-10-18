import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@prisma/client';
import {
  APPROVAL_TYPES,
  allowedTransitions,
  isTransitionAllowed,
} from '../../src/items/workflow.js';

function item(partial: Partial<WorkItem>): WorkItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    teamId: '00000000-0000-4000-8000-000000000002',
    title: 't',
    description: 'd',
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'OPEN',
    assigneeId: null,
    createdById: '00000000-0000-4000-8000-000000000003',
    dueDate: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe('workflow transitions', () => {
  it('should allow OPEN → IN_PROGRESS via start map when checking pairs', () => {
    expect(isTransitionAllowed('OPEN', 'IN_PROGRESS')).toBe(true);
  });

  it('should reject OPEN → CLOSED', () => {
    expect(isTransitionAllowed('OPEN', 'CLOSED')).toBe(false);
  });

  it('should reject OPEN → RESOLVED', () => {
    expect(isTransitionAllowed('OPEN', 'RESOLVED')).toBe(false);
  });

  it('should not list resolve for PAYMENT items', () => {
    const transitions = allowedTransitions(
      item({ type: 'PAYMENT', status: 'IN_PROGRESS', assigneeId: 'x' }),
    );
    expect(transitions).toContain('AWAITING_APPROVAL');
    expect(transitions).not.toContain('RESOLVED');
  });

  it('should not list submit for TASK items', () => {
    const transitions = allowedTransitions(
      item({ type: 'TASK', status: 'IN_PROGRESS', assigneeId: 'x' }),
    );
    expect(transitions).toContain('RESOLVED');
    expect(transitions).not.toContain('AWAITING_APPROVAL');
  });

  it('should treat PAYMENT and COMPLIANCE as approval types', () => {
    expect(APPROVAL_TYPES.has('PAYMENT')).toBe(true);
    expect(APPROVAL_TYPES.has('COMPLIANCE')).toBe(true);
    expect(APPROVAL_TYPES.has('TASK')).toBe(false);
  });

  it('should check all 25 status pairs have a deterministic answer', () => {
    const statuses = [
      'OPEN',
      'IN_PROGRESS',
      'AWAITING_APPROVAL',
      'RESOLVED',
      'CLOSED',
    ] as const;
    for (const from of statuses) {
      for (const to of statuses) {
        expect(typeof isTransitionAllowed(from, to)).toBe('boolean');
      }
    }
  });
});
