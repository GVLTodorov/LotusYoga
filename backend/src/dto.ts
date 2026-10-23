import type { Prisma } from '@prisma/client';
import type { Db } from './context.js';
import { DAY, MIN } from './time.js';

export const ACTIVE_STATUSES = ['BOOKED', 'ATTENDED', 'NO_SHOW'] as const;
export const OPEN_BEFORE_MS = 14 * DAY;
export const CLOSE_BEFORE_MS = 30 * MIN;

export const sessionInclude = { instructor: { select: { id: true, name: true } } } satisfies Prisma.ClassSessionInclude;
export type SessionRow = Prisma.ClassSessionGetPayload<{ include: typeof sessionInclude }>;

export const opensAt = (startsAt: Date) => new Date(startsAt.getTime() - OPEN_BEFORE_MS);
export const closesAt = (startsAt: Date) => new Date(startsAt.getTime() - CLOSE_BEFORE_MS);
export const endsAt = (s: { startsAt: Date; durationMin: number }) => new Date(s.startsAt.getTime() + s.durationMin * MIN);

export interface Viewer {
  id: string;
  role: string;
}

export async function sessionDtos(db: Db, rows: SessionRow[], now: Date, viewer?: Viewer | null) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [booked, waiting] = await Promise.all([
    db.booking.groupBy({ by: ['sessionId'], where: { sessionId: { in: ids }, status: { in: [...ACTIVE_STATUSES] } }, _count: { _all: true } }),
    db.waitlistEntry.findMany({
      where: { sessionId: { in: ids }, status: 'WAITING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, userId: true, sessionId: true },
    }),
  ]);
  const bookedBy = new Map(booked.map((b) => [b.sessionId, b._count._all]));
  const waitBy = new Map<string, { id: string; userId: string }[]>();
  for (const w of waiting) {
    const list = waitBy.get(w.sessionId) ?? [];
    list.push(w);
    waitBy.set(w.sessionId, list);
  }
  const isClient = viewer?.role === 'CLIENT';
  const mine = isClient
    ? new Map(
        (
          await db.booking.findMany({
            where: { userId: viewer!.id, sessionId: { in: ids }, status: { in: [...ACTIVE_STATUSES] } },
            select: { id: true, sessionId: true },
          })
        ).map((b) => [b.sessionId, b.id]),
      )
    : null;

  return rows.map((s) => {
    const bookedCount = bookedBy.get(s.id) ?? 0;
    const wl = waitBy.get(s.id) ?? [];
    const dto: Record<string, unknown> = {
      id: s.id,
      templateId: s.templateId,
      name: s.name,
      startsAt: s.startsAt.toISOString(),
      durationMin: s.durationMin,
      instructor: s.instructor,
      capacity: s.capacity,
      bookedCount,
      freeSpots: Math.max(0, s.capacity - bookedCount),
      waitlistCount: wl.length,
      status: s.status,
      bookingOpensAt: opensAt(s.startsAt).toISOString(),
      bookingClosesAt: closesAt(s.startsAt).toISOString(),
    };
    if (isClient) {
      const myBookingId = mine!.get(s.id) ?? null;
      const idx = wl.findIndex((w) => w.userId === viewer!.id);
      const myWaitlistId = idx >= 0 ? wl[idx].id : null;
      let myState: string;
      if (s.status === 'CANCELLED') myState = 'CANCELLED';
      else if (myBookingId) myState = 'BOOKED';
      else if (myWaitlistId) myState = 'WAITLISTED';
      else if (now < opensAt(s.startsAt)) myState = 'NOT_OPEN';
      else if (now >= closesAt(s.startsAt)) myState = 'CLOSED';
      else myState = bookedCount < s.capacity ? 'CAN_BOOK' : 'CAN_JOIN_WAITLIST';
      Object.assign(dto, { myState, myBookingId, myWaitlistId, myWaitlistPosition: idx >= 0 ? idx + 1 : null });
    }
    return dto;
  });
}

export async function sessionDto(db: Db, row: SessionRow, now: Date, viewer?: Viewer | null) {
  return (await sessionDtos(db, [row], now, viewer))[0];
}

export async function loadSessionDto(db: Db, id: string, now: Date, viewer?: Viewer | null) {
  const row = await db.classSession.findUnique({ where: { id }, include: sessionInclude });
  return row ? sessionDto(db, row, now, viewer) : null;
}

export function userDto(u: {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: string;
  lang: string;
  blocked: boolean;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    lang: u.lang,
    blocked: u.blocked,
    createdAt: u.createdAt.toISOString(),
  };
}

export type CardRow = Prisma.CardGetPayload<{ include: { events: { include: { byUser: { select: { id: true; name: true } } } } } }>;
type CardBase = Omit<CardRow, 'events'> & { events?: CardRow['events'] };

export const isCardActive = (c: { expiresAt: Date; totalClasses: number | null; usedClasses: number }, now: Date) =>
  c.expiresAt > now && (c.totalClasses === null || c.usedClasses < c.totalClasses);

export function cardDto(c: CardBase, now: Date, withEvents = false) {
  const dto: Record<string, unknown> = {
    id: c.id,
    userId: c.userId,
    type: c.type,
    totalClasses: c.totalClasses,
    usedClasses: c.usedClasses,
    remainingClasses: c.totalClasses === null ? null : c.totalClasses - c.usedClasses,
    validFrom: c.validFrom,
    expiresAt: c.expiresAt.toISOString(),
    paymentMethod: c.paymentMethod,
    priceBgn: c.priceBgn,
    createdAt: c.createdAt.toISOString(),
    isActive: isCardActive(c, now),
  };
  if (withEvents) {
    dto.events = (c.events ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => ({
        id: e.id,
        type: e.type,
        oldExpiresAt: e.oldExpiresAt?.toISOString() ?? null,
        newExpiresAt: e.newExpiresAt?.toISOString() ?? null,
        note: e.note,
        byUser: e.byUser,
        createdAt: e.createdAt.toISOString(),
      }));
  }
  return dto;
}

export function bookingDtoFrom(
  b: {
    id: string;
    status: string;
    walkIn: boolean;
    promotedLate: boolean;
    cardId: string | null;
    createdAt: Date;
    cancelledAt: Date | null;
  },
  session: Record<string, unknown>,
) {
  return {
    id: b.id,
    status: b.status,
    walkIn: b.walkIn,
    promotedLate: b.promotedLate,
    cardId: b.cardId,
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    session,
  };
}

/** Booking DTOs with their (viewer-less) session DTOs. */
export async function bookingDtos(
  db: Db,
  rows: (Parameters<typeof bookingDtoFrom>[0] & { session: SessionRow })[],
  now: Date,
) {
  const sessions = await sessionDtos(db, [...new Map(rows.map((r) => [r.session.id, r.session])).values()], now);
  const byId = new Map(sessions.map((s) => [s.id as string, s]));
  return rows.map((r) => bookingDtoFrom(r, byId.get(r.session.id)!));
}

export async function waitlistPositions(db: Db, sessionId: string): Promise<Map<string, number>> {
  const list = await db.waitlistEntry.findMany({
    where: { sessionId, status: 'WAITING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return new Map(list.map((w, i) => [w.id, i + 1]));
}

export async function waitlistDtos(
  db: Db,
  rows: { id: string; status: string; createdAt: Date; session: SessionRow }[],
  now: Date,
) {
  const sessions = await sessionDtos(db, [...new Map(rows.map((r) => [r.session.id, r.session])).values()], now);
  const byId = new Map(sessions.map((s) => [s.id as string, s]));
  const posBySession = new Map<string, Map<string, number>>();
  const out = [];
  for (const r of rows) {
    let pos: number | null = null;
    if (r.status === 'WAITING') {
      if (!posBySession.has(r.session.id)) posBySession.set(r.session.id, await waitlistPositions(db, r.session.id));
      pos = posBySession.get(r.session.id)!.get(r.id) ?? null;
    }
    out.push({ id: r.id, status: r.status, position: pos, createdAt: r.createdAt.toISOString(), session: byId.get(r.session.id)! });
  }
  return out;
}
