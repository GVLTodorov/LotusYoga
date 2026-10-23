import { Prisma } from '@prisma/client';
import type { Ctx, Tx } from '../context.js';
import {
  ACTIVE_STATUSES,
  bookingDtos,
  closesAt,
  endsAt,
  opensAt,
  sessionInclude,
  waitlistDtos,
  type SessionRow,
} from '../dto.js';
import { AppError, conflictCode, forbidden, notFound, MESSAGES } from '../errors.js';
import { queueEmail } from '../email/outbox.js';
import { HOUR, MIN } from '../time.js';
import { pickCard, pickCardOrThrow, returnClass } from './cards.js';

export interface Actor {
  id: string;
  role: 'CLIENT' | 'INSTRUCTOR' | 'ADMIN';
}

const active = [...ACTIVE_STATUSES];
const blocked = () => new AppError(403, 'USER_BLOCKED', MESSAGES.USER_BLOCKED);

/** Lock the session row for the rest of the transaction; serialises everything that changes its capacity. */
export async function lockSession(tx: Tx, id: string): Promise<SessionRow> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClassSession" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Session not found');
  return tx.classSession.findUniqueOrThrow({ where: { id }, include: sessionInclude });
}

export const activeCount = (tx: Tx, sessionId: string) => tx.booking.count({ where: { sessionId, status: { in: active } } });

function assertBookingWindow(s: SessionRow, now: Date) {
  if (s.status === 'CANCELLED') throw conflictCode('SESSION_CANCELLED');
  if (now < opensAt(s.startsAt)) throw conflictCode('BOOKING_NOT_OPEN');
  if (now >= closesAt(s.startsAt)) throw conflictCode('BOOKING_CLOSED');
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function loadBookingDto(ctx: Ctx, id: string) {
  const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id }, include: { session: { include: sessionInclude } } });
  return (await bookingDtos(ctx.prisma, [b], ctx.now()))[0];
}

export async function bookSession(ctx: Ctx, userId: string, sessionId: string) {
  const now = ctx.now();
  let id: string;
  try {
    id = await ctx.prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, sessionId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.blocked) throw blocked();
      assertBookingWindow(session, now);
      if ((await tx.booking.count({ where: { userId, sessionId, status: { in: active } } })) > 0) throw conflictCode('ALREADY_BOOKED');
      if ((await activeCount(tx, sessionId)) >= session.capacity) throw conflictCode('SESSION_FULL');
      const card = await pickCardOrThrow(tx, userId, session);
      const booking = await tx.booking.create({ data: { userId, sessionId, cardId: card.cardId, status: 'BOOKED' } });
      await tx.waitlistEntry.updateMany({ where: { userId, sessionId, status: 'WAITING' }, data: { status: 'PROMOTED' } });
      await queueEmail(tx, ctx.config.appUrl, {
        to: user.email,
        lang: user.lang,
        template: 'BOOKING_CONFIRMED',
        payload: { name: user.name, sessionName: session.name, startsAt: session.startsAt.toISOString(), instructor: session.instructor.name },
      });
      return booking.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflictCode('ALREADY_BOOKED');
    throw e;
  }
  return loadBookingDto(ctx, id);
}

/**
 * Fill free spots from the waiting list (first come first served, clients without a valid card are skipped).
 * Caller must hold the session lock (lockSession) in the same transaction.
 */
export async function promoteWaitlist(tx: Tx, ctx: Pick<Ctx, 'config'>, now: Date, sessionId: string) {
  const session = await tx.classSession.findUniqueOrThrow({ where: { id: sessionId }, include: sessionInclude });
  if (session.status !== 'SCHEDULED' || now >= closesAt(session.startsAt)) return;
  let free = session.capacity - (await activeCount(tx, sessionId));
  if (free <= 0) return;
  const entries = await tx.waitlistEntry.findMany({
    where: { sessionId, status: 'WAITING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: true },
  });
  for (const e of entries) {
    if (free <= 0) break;
    if (e.user.blocked || e.user.deletedAt) continue;
    if ((await tx.booking.count({ where: { userId: e.userId, sessionId, status: { in: active } } })) > 0) continue;
    const pick = await pickCard(tx, e.userId, session, true);
    if ('error' in pick) continue;
    await tx.booking.create({
      data: { userId: e.userId, sessionId, cardId: pick.cardId, status: 'BOOKED', promotedLate: session.startsAt.getTime() - now.getTime() < 6 * HOUR },
    });
    await tx.waitlistEntry.update({ where: { id: e.id }, data: { status: 'PROMOTED' } });
    await queueEmail(tx, ctx.config.appUrl, {
      to: e.user.email,
      lang: e.user.lang,
      template: 'WAITLIST_PROMOTED',
      payload: { name: e.user.name, sessionName: session.name, startsAt: session.startsAt.toISOString(), instructor: session.instructor.name },
    });
    free--;
  }
}

async function ownBooking(ctx: Ctx, userId: string, id: string) {
  const b = await ctx.prisma.booking.findFirst({ where: { id, userId }, include: { session: true } });
  if (!b) throw notFound('Booking not found');
  return b;
}

function cancelFlags(b: { promotedLate: boolean; session: { startsAt: Date } }, now: Date) {
  const ms = b.session.startsAt.getTime() - now.getTime();
  const lateCancel = ms < 6 * HOUR && !b.promotedLate;
  return { lateCancel, classReturned: !lateCancel, hoursUntilStart: Math.round((ms / HOUR) * 100) / 100 };
}

export async function cancelPreview(ctx: Ctx, userId: string, bookingId: string) {
  const now = ctx.now();
  const b = await ownBooking(ctx, userId, bookingId);
  if (b.status !== 'BOOKED') throw conflictCode('INVALID_STATE');
  if (now >= b.session.startsAt) throw conflictCode('SESSION_STARTED');
  return cancelFlags(b, now);
}

export async function cancelBooking(ctx: Ctx, userId: string, bookingId: string) {
  const now = ctx.now();
  const first = await ownBooking(ctx, userId, bookingId);
  await ctx.prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, first.sessionId);
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { session: true } });
    if (b.status !== 'BOOKED') throw conflictCode('INVALID_STATE');
    if (now >= b.session.startsAt) throw conflictCode('SESSION_STARTED');
    const { lateCancel } = cancelFlags(b, now);
    await tx.booking.update({ where: { id: b.id }, data: { status: lateCancel ? 'LATE_CANCELLED' : 'CANCELLED', cancelledAt: now } });
    if (!lateCancel) await returnClass(tx, b.cardId);
    await promoteWaitlist(tx, ctx, now, session.id);
  });
  return loadBookingDto(ctx, bookingId);
}

export async function listMyBookings(ctx: Ctx, userId: string, scope: 'upcoming' | 'past') {
  const now = ctx.now();
  const rows = await ctx.prisma.booking.findMany({
    where: { userId },
    include: { session: { include: sessionInclude } },
    orderBy: { session: { startsAt: 'asc' } },
  });
  const isUpcoming = (b: (typeof rows)[number]) => b.status === 'BOOKED' && endsAt(b.session) > now;
  const picked = scope === 'upcoming' ? rows.filter(isUpcoming) : rows.filter((b) => !isUpcoming(b)).reverse().slice(0, 100);
  return bookingDtos(ctx.prisma, picked, now);
}

// ---------------------------------------------------------------- waiting list

export async function joinWaitlist(ctx: Ctx, userId: string, sessionId: string) {
  const now = ctx.now();
  let id: string;
  try {
    id = await ctx.prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, sessionId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.blocked) throw blocked();
      assertBookingWindow(session, now);
      if ((await tx.booking.count({ where: { userId, sessionId, status: { in: active } } })) > 0) throw conflictCode('ALREADY_BOOKED');
      if ((await tx.waitlistEntry.count({ where: { userId, sessionId, status: 'WAITING' } })) > 0) throw conflictCode('ALREADY_ON_WAITLIST');
      if ((await activeCount(tx, sessionId)) < session.capacity) throw conflictCode('SESSION_NOT_FULL');
      await pickCardOrThrow(tx, userId, session, false);
      return (await tx.waitlistEntry.create({ data: { userId, sessionId } })).id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflictCode('ALREADY_ON_WAITLIST');
    throw e;
  }
  return loadWaitlistDto(ctx, id);
}

async function loadWaitlistDto(ctx: Ctx, id: string) {
  const w = await ctx.prisma.waitlistEntry.findUniqueOrThrow({ where: { id }, include: { session: { include: sessionInclude } } });
  return (await waitlistDtos(ctx.prisma, [w], ctx.now()))[0];
}

export async function leaveWaitlist(ctx: Ctx, userId: string, id: string) {
  const w = await ctx.prisma.waitlistEntry.findFirst({ where: { id, userId } });
  if (!w) throw notFound('Waiting list entry not found');
  if (w.status !== 'WAITING') throw conflictCode('INVALID_STATE');
  await ctx.prisma.waitlistEntry.updateMany({ where: { id, status: 'WAITING' }, data: { status: 'LEFT' } });
}

export async function listMyWaitlist(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const rows = await ctx.prisma.waitlistEntry.findMany({
    where: { userId, status: 'WAITING' },
    include: { session: { include: sessionInclude } },
    orderBy: { session: { startsAt: 'asc' } },
  });
  return waitlistDtos(ctx.prisma, rows.filter((w) => endsAt(w.session) > now), now);
}

/** Worker job: at booking close the remaining WAITING entries expire. Idempotent. */
export async function expireWaitlists(ctx: Ctx): Promise<number> {
  const limit = new Date(ctx.now().getTime() + 30 * MIN);
  const r = await ctx.prisma.waitlistEntry.updateMany({
    where: { status: 'WAITING', session: { startsAt: { lte: limit } } },
    data: { status: 'EXPIRED' },
  });
  return r.count;
}

// ---------------------------------------------------------------- instructor actions

export const attendeeSelect = { user: { select: { id: true, name: true, phone: true } } } satisfies Prisma.BookingInclude;

export function attendeeDto(b: { id: string; status: string; walkIn: boolean; user: { id: string; name: string; phone: string } }) {
  return { bookingId: b.id, userId: b.user.id, name: b.user.name, phone: b.user.phone, status: b.status, walkIn: b.walkIn };
}

function assertTeaches(actor: Actor, session: { instructorId: string }) {
  if (actor.role !== 'ADMIN' && session.instructorId !== actor.id) throw forbidden('You do not teach this class');
}

export async function setAttendance(ctx: Ctx, actor: Actor, bookingId: string, status: 'ATTENDED' | 'NO_SHOW') {
  const now = ctx.now();
  const b = await ctx.prisma.booking.findUnique({ where: { id: bookingId }, include: { session: true } });
  if (!b) throw notFound('Booking not found');
  assertTeaches(actor, b.session);
  if (!active.includes(b.status as (typeof active)[number])) throw conflictCode('INVALID_STATE');
  const t = b.session.startsAt.getTime();
  if (now.getTime() < t - 30 * MIN || now.getTime() > t + 24 * HOUR) throw conflictCode('ATTENDANCE_WINDOW');
  const upd = await ctx.prisma.booking.update({ where: { id: bookingId }, data: { status }, include: attendeeSelect });
  return attendeeDto(upd);
}

export async function addWalkIn(ctx: Ctx, actor: Actor, sessionId: string, userId: string) {
  const now = ctx.now();
  let id: string;
  try {
    id = await ctx.prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, sessionId);
      assertTeaches(actor, session);
      const user = await tx.user.findFirst({ where: { id: userId, role: 'CLIENT', deletedAt: null } });
      if (!user) throw notFound('Client not found');
      if (user.blocked) throw blocked();
      if (session.status === 'CANCELLED') throw conflictCode('SESSION_CANCELLED');
      const t = session.startsAt.getTime();
      if (now.getTime() < t - 30 * MIN || now > endsAt(session)) throw conflictCode('ATTENDANCE_WINDOW');
      if ((await tx.booking.count({ where: { userId, sessionId, status: { in: active } } })) > 0) throw conflictCode('ALREADY_BOOKED');
      if ((await activeCount(tx, sessionId)) >= session.capacity) throw conflictCode('SESSION_FULL');
      const card = await pickCardOrThrow(tx, userId, session);
      const booking = await tx.booking.create({ data: { userId, sessionId, cardId: card.cardId, status: 'ATTENDED', walkIn: true } });
      await tx.waitlistEntry.updateMany({ where: { userId, sessionId, status: 'WAITING' }, data: { status: 'PROMOTED' } });
      return booking.id;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflictCode('ALREADY_BOOKED');
    throw e;
  }
  return attendeeDto(await ctx.prisma.booking.findUniqueOrThrow({ where: { id }, include: attendeeSelect }));
}

