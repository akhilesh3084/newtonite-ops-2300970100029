import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import {
  hashRequest,
  parseIdempotencyKey,
  withIdempotency,
} from '../idempotency/with-idempotency.js';
import { sendError, sendSuccess } from '../lib/envelope.js';
import { validationError } from '../lib/errors.js';
import { listQuerySchema } from './list-query.js';
import * as mutations from './mutations.js';
import * as itemsService from './service.js';

export const itemsRouter = Router();

const createBody = z
  .object({
    title: z.string(),
    description: z.string(),
    type: z.enum(['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK']),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    teamId: z.string().uuid(),
    dueDate: z.string().date().nullable().optional(),
  })
  .strict();

const patchBody = z
  .object({
    version: z.number().int().positive(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    dueDate: z.string().date().nullable().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.title !== undefined ||
      b.description !== undefined ||
      b.priority !== undefined ||
      b.dueDate !== undefined,
    { message: 'At least one field to update is required' },
  );

const assignBody = z
  .object({
    version: z.number().int().positive(),
    assigneeId: z.string().uuid().nullable(),
  })
  .strict();

const transitionBody = z
  .object({
    version: z.number().int().positive(),
    to: z.enum(['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED']),
    reason: z.string().optional(),
  })
  .strict();

const commentBody = z
  .object({
    body: z.string(),
  })
  .strict();

/** GET /api/v1/work-items/summary — before /:id */
itemsRouter.get('/work-items/summary', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await itemsService.summary(req.auth!));
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.get('/work-items', requireAuth, async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw validationError('Invalid list query', parsed.error.flatten());
    }
    sendSuccess(res, await itemsService.listWorkItems(req.auth!, parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});

/** POST create — Idempotency-Key required */
itemsRouter.post('/work-items', requireAuth, async (req, res) => {
  try {
    const key = parseIdempotencyKey(req.header('idempotency-key') ?? undefined);
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid create body', parsed.error.flatten());
    }
    const requestHash = hashRequest('POST', '/api/v1/work-items', parsed.data);
    const result = await withIdempotency(req.auth!.userId, key, requestHash, async (tx) => {
      const body = await mutations.createItem(req.auth!, parsed.data, tx);
      return { statusCode: 201, body };
    });
    sendSuccess(res, result.body, result.statusCode);
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.get('/work-items/:id', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await itemsService.getWorkItem(req.auth!, req.params.id!));
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.patch('/work-items/:id', requireAuth, async (req, res) => {
  try {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid patch body', parsed.error.flatten());
    }
    sendSuccess(res, await mutations.patchItem(req.auth!, req.params.id!, parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});

/** Claim — no idempotency key; same user is a no-op */
itemsRouter.post('/work-items/:id/claim', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await mutations.claimItem(req.auth!, req.params.id!));
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.post('/work-items/:id/assign', requireAuth, async (req, res) => {
  try {
    const key = parseIdempotencyKey(req.header('idempotency-key') ?? undefined);
    const parsed = assignBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid assign body', parsed.error.flatten());
    }
    const path = `/api/v1/work-items/${req.params.id}/assign`;
    const requestHash = hashRequest('POST', path, parsed.data);
    const result = await withIdempotency(req.auth!.userId, key, requestHash, async (tx) => {
      const body = await mutations.assignItem(req.auth!, req.params.id!, parsed.data, tx);
      return { statusCode: 200, body };
    });
    sendSuccess(res, result.body, result.statusCode);
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.post('/work-items/:id/transition', requireAuth, async (req, res) => {
  try {
    const key = parseIdempotencyKey(req.header('idempotency-key') ?? undefined);
    const parsed = transitionBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid transition body', parsed.error.flatten());
    }
    const path = `/api/v1/work-items/${req.params.id}/transition`;
    const requestHash = hashRequest('POST', path, parsed.data);
    const result = await withIdempotency(req.auth!.userId, key, requestHash, async (tx) => {
      const body = await mutations.transitionItem(req.auth!, req.params.id!, parsed.data, tx);
      return { statusCode: 200, body };
    });
    sendSuccess(res, result.body, result.statusCode);
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.get('/work-items/:id/activity', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await mutations.listActivity(req.auth!, req.params.id!));
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.get('/work-items/:id/comments', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await mutations.listComments(req.auth!, req.params.id!));
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.post('/work-items/:id/comments', requireAuth, async (req, res) => {
  try {
    const key = parseIdempotencyKey(req.header('idempotency-key') ?? undefined);
    const parsed = commentBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid comment body', parsed.error.flatten());
    }
    const path = `/api/v1/work-items/${req.params.id}/comments`;
    const requestHash = hashRequest('POST', path, parsed.data);
    const result = await withIdempotency(req.auth!.userId, key, requestHash, async (tx) => {
      const body = await mutations.addComment(req.auth!, req.params.id!, parsed.data.body, tx);
      return { statusCode: 201, body };
    });
    sendSuccess(res, result.body, result.statusCode);
  } catch (err) {
    sendError(res, err);
  }
});

itemsRouter.get('/teams/:id/members', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await itemsService.listTeamMembers(req.auth!, req.params.id!));
  } catch (err) {
    sendError(res, err);
  }
});
