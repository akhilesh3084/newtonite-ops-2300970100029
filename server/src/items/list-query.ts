import { z } from 'zod';

export const listQuerySchema = z
  .object({
    view: z
      .enum(['mine', 'unassigned_urgent', 'awaiting_my_approval', 'overdue', 'stale'])
      .optional(),
    status: z
      .enum(['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED'])
      .optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    type: z
      .enum(['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK'])
      .optional(),
    teamId: z.string().uuid().optional(),
    assigneeId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),
    q: z.string().max(100).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListQuery = z.infer<typeof listQuerySchema>;
