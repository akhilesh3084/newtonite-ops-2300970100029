import { describe, expect, it } from 'vitest';
import type { Role, WorkItem } from '@prisma/client';
import type { AuthContext } from '../../src/auth/types.js';
import { can } from '../../src/authz/permissions.js';

function ctx(partial: {
  userId?: string;
  isAdmin?: boolean;
  roles?: [string, Role][];
}): AuthContext {
  return {
    userId: partial.userId ?? 'user-1',
    email: 'u@test',
    name: 'U',
    isAdmin: partial.isAdmin ?? false,
    roles: new Map(partial.roles ?? []),
  };
}

function item(partial: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'item-1',
    teamId: 'team-pay',
    title: 't',
    description: 'd',
    type: 'TASK',
    priority: 'MEDIUM',
    status: 'OPEN',
    assigneeId: null,
    createdById: 'creator-1',
    dueDate: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe('can()', () => {
  it('should return 404 when user is not on the item team', () => {
    const result = can(ctx({ roles: [['other', 'MEMBER']] }), 'read', item());
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('should allow Viewer to read but not claim', () => {
    const viewer = ctx({ roles: [['team-pay', 'VIEWER']] });
    expect(can(viewer, 'read', item()).ok).toBe(true);
    expect(can(viewer, 'claim', item())).toEqual({ ok: false, status: 403 });
  });

  it('should allow Member to claim', () => {
    const member = ctx({ roles: [['team-pay', 'MEMBER']] });
    expect(can(member, 'claim', item()).ok).toBe(true);
  });

  it('should allow Lead to assign', () => {
    const lead = ctx({ roles: [['team-pay', 'LEAD']] });
    expect(can(lead, 'assign', item()).ok).toBe(true);
  });

  it('should forbid Member from assign', () => {
    const member = ctx({ roles: [['team-pay', 'MEMBER']] });
    expect(can(member, 'assign', item())).toEqual({ ok: false, status: 403 });
  });

  it('should allow admin to read any team', () => {
    const admin = ctx({ isAdmin: true, roles: [] });
    expect(can(admin, 'read', item()).ok).toBe(true);
  });
});
