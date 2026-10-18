import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db.js';
import { unauthenticated } from '../lib/errors.js';
import { signAccessToken } from './jwt.js';

export async function login(emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { team: true },
      },
    },
  });

  // Same message for bad email and bad password — don't leak which one failed
  const invalid = () => unauthenticated('Invalid email or password');

  if (!user) {
    throw invalid();
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw invalid();
  }

  const token = signAccessToken({ sub: user.id, email: user.email });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
    },
    memberships: user.memberships.map((m) => ({
      teamId: m.teamId,
      teamName: m.team.name,
      role: m.role,
    })),
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      memberships: {
        include: { team: true },
      },
    },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    memberships: user.memberships.map((m) => ({
      teamId: m.teamId,
      teamName: m.team.name,
      role: m.role,
    })),
  };
}
