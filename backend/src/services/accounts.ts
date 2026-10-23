import bcrypt from 'bcryptjs';
import { Prisma, type Lang, type Role } from '@prisma/client';
import type { Ctx } from '../context.js';
import { conflictCode, AppError, notFound } from '../errors.js';
import { lockSession, promoteWaitlist } from './booking.js';
import { returnClass } from './cards.js';

const ROUNDS = 10;
// compared against when the account does not exist, so response time does not reveal registered emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);

export const hashPassword = (p: string) => bcrypt.hash(p, ROUNDS);
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function createUser(
  ctx: Ctx,
  input: { email: string; password: string; name: string; phone: string; role: Role; lang: Lang },
) {
  const email = normalizeEmail(input.email);
  if (await ctx.prisma.user.findUnique({ where: { email } })) throw conflictCode('EMAIL_TAKEN');
  try {
    return await ctx.prisma.user.create({
      data: { email, passwordHash: await hashPassword(input.password), name: input.name.trim(), phone: input.phone.trim(), role: input.role, lang: input.lang },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflictCode('EMAIL_TAKEN');
    throw e;
  }
}

export async function authenticate(ctx: Ctx, email: string, password: string) {
  const user = await ctx.prisma.user.findFirst({ where: { email: normalizeEmail(email), deletedAt: null } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
  return user;
}

/** GDPR erase: anonymise the user, cancel future bookings (class returned, no email) and leave waiting lists. */
export async function deleteAccount(ctx: Ctx, userId: string) {
  const now = ctx.now();
  await ctx.prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw notFound('User not found');
    // erase queued / sent mail content addressed to this email (PII)
    await tx.emailOutbox.deleteMany({ where: { to: user.email, status: 'PENDING' } });
    await tx.emailOutbox.updateMany({ where: { to: user.email, status: { in: ['SENT', 'FAILED'] } }, data: { to: '', payload: {} } });
    await tx.user.update({
      where: { id: userId },
      data: { name: 'Deleted client', email: `deleted-${userId}@invalid`, phone: '', passwordHash: null, deletedAt: now },
    });
    const bookings = await tx.booking.findMany({ where: { userId, status: 'BOOKED', session: { startsAt: { gt: now } } } });
    await tx.waitlistEntry.updateMany({ where: { userId, status: 'WAITING' }, data: { status: 'LEFT' } });
    const sessionIds = [...new Set(bookings.map((b) => b.sessionId))].sort();
    for (const sid of sessionIds) {
      await lockSession(tx, sid);
      for (const b of bookings.filter((x) => x.sessionId === sid)) {
        const r = await tx.booking.updateMany({ where: { id: b.id, status: 'BOOKED' }, data: { status: 'CANCELLED', cancelledAt: now } });
        if (r.count === 1) await returnClass(tx, b.cardId);
      }
      await promoteWaitlist(tx, ctx, now, sid);
    }
  });
}

/** Create the initial admin from env if no ADMIN exists yet. */
export async function ensureInitialAdmin(ctx: Ctx): Promise<boolean> {
  const { adminEmail, adminPassword } = ctx.config;
  if (!adminEmail || !adminPassword) return false;
  if ((await ctx.prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } })) > 0) return false;
  const email = normalizeEmail(adminEmail);
  const existing = await ctx.prisma.user.findUnique({ where: { email } });
  if (existing) {
    await ctx.prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', passwordHash: await hashPassword(adminPassword) } });
  } else {
    await ctx.prisma.user.create({
      data: { email, passwordHash: await hashPassword(adminPassword), name: 'Administrator', phone: '', role: 'ADMIN', lang: 'bg' },
    });
  }
  return true;
}
