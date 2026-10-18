import { Router } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess } from '../lib/envelope.js';
import { validationError } from '../lib/errors.js';
import { requireAuth } from './middleware.js';
import * as authService from './service.js';

const loginBody = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export const authRouter = Router();

/** POST /api/v1/auth/login — public; returns JWT + memberships */
authRouter.post('/auth/login', async (req, res) => {
  try {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      throw validationError('Invalid login body', parsed.error.flatten());
    }
    const data = await authService.login(parsed.data.email, parsed.data.password);
    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});

/** GET /api/v1/me — needs Authorization: Bearer <token> */
authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const data = await authService.getMe(req.auth!.userId);
    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});
