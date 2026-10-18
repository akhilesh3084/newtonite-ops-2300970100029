import type { Role } from '@prisma/client';

/** Who is calling the API — rebuilt from DB on every request (R9). */
export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
  /** teamId → role for that team */
  roles: Map<string, Role>;
};

export type JwtPayload = {
  sub: string;
  email: string;
};
