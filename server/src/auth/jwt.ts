import jwt from 'jsonwebtoken';
import { loadEnv } from '../lib/env.js';
import type { JwtPayload } from './types.js';

export function signAccessToken(payload: JwtPayload): string {
  const env = loadEnv();
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  const env = loadEnv();
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded)) {
    throw new Error('invalid_token');
  }
  const sub = String((decoded as { sub: unknown }).sub);
  const email = String((decoded as { email?: unknown }).email ?? '');
  return { sub, email };
}
