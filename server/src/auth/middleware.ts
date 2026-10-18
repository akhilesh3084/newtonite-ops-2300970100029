import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/db.js';
import { sendError } from '../lib/envelope.js';
import { unauthenticated } from '../lib/errors.js';
import { verifyAccessToken } from './jwt.js';
import type { AuthContext } from './types.js';
import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Reads Bearer token → loads user + memberships from DB → attaches req.auth.
 * Roles are NOT stored in the JWT so a Lead demotion takes effect immediately (R9).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw unauthenticated();
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw unauthenticated();
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw unauthenticated('Invalid or expired token');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: true },
    });
    if (!user) {
      throw unauthenticated('Invalid or expired token');
    }

    const roles = new Map<string, Role>();
    for (const m of user.memberships) {
      roles.set(m.teamId, m.role);
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      roles,
    };
    next();
  } catch (err) {
    sendError(res, err);
  }
}
