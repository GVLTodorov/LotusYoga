import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expireWaitlists } from '../src/services/booking.js';
import { cardExpiry } from '../src/services/cards.js';
import { inDays, inHours, inMinutes, makeEnv, mkCard, mkSession, mkUser, prisma, resetDb, T0, type TestEnv } from './helpers.js';

let env: TestEnv;
let teacher: Awaited<ReturnType<typeof mkUser>>;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb();
  env.setNow(T0);
  env.mailer.sent = [];
  teacher = await mkUser(env, 'INSTRUCTOR', { name: 'Elena' });
});

const book = (id: string, auth: Record<string, string>) => env.api().post(`/api/sessions/${id}/bookings`).set(auth);
const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;

describe('GET /api/sessions', () => {
  it('lists this and next week sorted, including cancelled, with public fields only (AC-6)', async () => {
    // T0 is Friday 2026-10-23: default range is Mon 2026-10-19 .. Sun 2026-11-01
    const a = await mkSession(teacher.user.id, new Date('2026-10-28T16:00:00Z'), { name: 'B' });
    const b = await mkSession(teacher.user.id, new Date('2026-10-20T16:00:00Z'), { name: 'A' });
    const c = await mkSession(teacher.user.id, new Date('2026-10-29T16:00:00Z'), { status: 'CANCELLED' });
    await mkSession(teacher.user.id, new Date('2026-11-01T22:00:00Z')); // Mon 2026-11-02 Sofia: outside
    await mkSession(teacher.user.id, new Date('2026-10-18T20:00:00Z')); // Sun 2026-10-18: outside
    const res = await env.api().get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id)).toEqual([b.id, a.id, c.id]);
    expect(res.body[0]).toMatchObject({ name: 'A', instructor: { name: 'Elena' }, capacity: 14, bookedCount: 0, freeSpots: 14, waitlistCount: 0, status: 'SCHEDULED' });
    expect(res.body[0].myState).toBeUndefined();
    expect(res.body[0].bookingOpensAt).toBe('2026-10-06T16:00:00.000Z');
    expect(res.body[0].bookingClosesAt).toBe('2026-10-20T15:30:00.000Z');
    expect(res.body[2].status).toBe('CANCELLED');
  });

  it('honours from/to with Sofia day boundaries and the 15 day limit', async () => {
    // 2026-11-02 00:30 Sofia = 2026-11-01T22:30Z
    const s = await mkSession(teacher.user.id, new Date('2026-11-01T22:30:00Z'));
    const res = await env.api().get('/api/sessions?from=2026-11-02&to=2026-11-02');
    expect(res.body.map((x: { id: string }) => x.id)).toEqual([s.id]);
    expect((await env.api().get('/api/sessions?from=2026-11-01&to=2026-11-01')).body).toEqual([]);
    expect((await env.api().get('/api/sessions?from=2026-11-01&to=2026-11-15')).status).toBe(200);
    expect((await env.api().get('/api/sessions?from=2026-11-01&to=2026-11-16')).status).toBe(400);
    expect((await env.api().get('/api/sessions?from=2026-11-05&to=2026-11-01')).status).toBe(400);
    expect((await env.api().get('/api/sessions?from=nope')).status).toBe(400);
  });

  it('adds the client state per session (AC-7)', async () => {
    const me = await mkUser(env);
    const other = await mkUser(env);
    await mkCard(me.user.id);
    const can = await mkSession(teacher.user.id, inHours(30));
    const booked = await mkSession(teacher.user.id, inHours(31));
    const full = await mkSession(teacher.user.id, inHours(32), { capacity: 1 });
    const waited = await mkSession(teacher.user.id, inHours(33), { capacity: 1 });
    const notOpen = await mkSession(teacher.user.id, inDays(15));
    const closed = await mkSession(teacher.user.id, inMinutes(10));
    const cancelled = await mkSession(teacher.user.id, inHours(34), { status: 'CANCELLED' });
    await prisma.booking.create({ data: { userId: me.user.id, sessionId: booked.id } });
    await prisma.booking.create({ data: { userId: other.user.id, sessionId: full.id } });
    await prisma.booking.create({ data: { userId: other.user.id, sessionId: waited.id } });
    await prisma.waitlistEntry.create({ data: { userId: other.user.id, sessionId: waited.id } });
    const w = await prisma.waitlistEntry.create({ data: { userId: me.user.id, sessionId: waited.id } });

    const res = await env.api().get('/api/sessions?from=2026-10-23&to=2026-11-06').set(me.auth);
    const by = Object.fromEntries(res.body.map((s: { id: string }) => [s.id, s]));
    expect(by[can.id].myState).toBe('CAN_BOOK');
    expect(by[booked.id]).toMatchObject({ myState: 'BOOKED', myWaitlistId: null });
    expect(by[booked.id].myBookingId).toBeTruthy();
    expect(by[full.id].myState).toBe('CAN_JOIN_WAITLIST');
    expect(by[waited.id]).toMatchObject({ myState: 'WAITLISTED', myWaitlistId: w.id, myWaitlistPosition: 2, waitlistCount: 2 });
    expect(by[closed.id].myState).toBe('CLOSED');
    expect(by[cancelled.id].myState).toBe('CANCELLED');
    const far = await env.api().get(`/api/sessions/${notOpen.id}`).set(me.auth);
    expect(far.body.myState).toBe('NOT_OPEN');
  });

  it('GET /api/sessions/:id returns 404 for unknown ids', async () => {
    const res = await env.api().get('/api/sessions/nope');
    expect(res.status).toBe(404);
    expect(code(res)).toBe('NOT_FOUND');
  });

  it('an invalid token on a public route is treated as anonymous', async () => {
    const res = await env.api().get('/api/sessions').set('Authorization', 'Bearer junk');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/sessions/:id/bookings', () => {
  it('books, takes one class from the card and queues a confirmation email (AC-8)', async () => {
    const me = await mkUser(env, 'CLIENT', { lang: 'bg', email: 'maria@example.com' });
    const card = await mkCard(me.user.id, 'PACK_8');
    const s = await mkSession(teacher.user.id, inHours(30));
    const res = await book(s.id, me.auth);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'BOOKED', walkIn: false, promotedLate: false, cardId: card.id, cancelledAt: null });
    expect(res.body.session).toMatchObject({ id: s.id, bookedCount: 1, freeSpots: 13 });
    expect(res.body.session.myState).toBeUndefined();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(1);
    const mail = await prisma.emailOutbox.findFirstOrThrow();
    expect(mail).toMatchObject({ to: 'maria@example.com', lang: 'bg', template: 'BOOKING_CONFIRMED', status: 'PENDING' });
  });

  it('SESSION_FULL when no spot is left (AC-9)', async () => {
    const [a, b] = [await mkUser(env), await mkUser(env)];
    await mkCard(a.user.id);
    await mkCard(b.user.id);
    const s = await mkSession(teacher.user.id, inHours(30), { capacity: 1 });
    expect((await book(s.id, a.auth)).status).toBe(201);
    const res = await book(s.id, b.auth);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SESSION_FULL');
  });

  it('NO_VALID_CARD without a card, with an exhausted, expired or not yet valid card (AC-10)', async () => {
    const me = await mkUser(env);
    const s = await mkSession(teacher.user.id, inHours(30));
    expect(code(await book(s.id, me.auth))).toBe('NO_VALID_CARD');
    await mkCard(me.user.id, 'SINGLE', { used: 1 });
    expect(code(await book(s.id, me.auth))).toBe('NO_VALID_CARD');
    await mkCard(me.user.id, 'PACK_8', { validFrom: '2026-08-01', expiresAt: new Date('2026-10-01T20:59:59.999Z') });
    expect(code(await book(s.id, me.auth))).toBe('NO_VALID_CARD');
    await mkCard(me.user.id, 'PACK_8', { validFrom: '2026-10-25' }); // starts after the class
    expect(code(await book(s.id, me.auth))).toBe('NO_VALID_CARD');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('a card expiring before the class date cannot be used for it, but can for earlier classes', async () => {
    const me = await mkUser(env);
    const card = await mkCard(me.user.id, 'SINGLE', { expiresAt: new Date('2026-10-26T20:59:59.999Z') }); // end of Mon 2026-10-26 (EET)
    const late = await mkSession(teacher.user.id, new Date('2026-10-27T16:00:00Z'));
    const ok = await mkSession(teacher.user.id, new Date('2026-10-26T16:00:00Z'));
    expect(code(await book(late.id, me.auth))).toBe('NO_VALID_CARD');
    expect((await book(ok.id, me.auth)).body.cardId).toBe(card.id);
  });

  it('BOOKING_NOT_OPEN more than 14 days ahead, BOOKING_CLOSED within 30 min (AC-11)', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id, 'PACK_12');
    const far = await mkSession(teacher.user.id, new Date(T0.getTime() + 14 * 24 * 3600e3 + 60e3));
    const edgeOpen = await mkSession(teacher.user.id, new Date(T0.getTime() + 14 * 24 * 3600e3));
    const soon = await mkSession(teacher.user.id, inMinutes(29));
    const edgeClosed = await mkSession(teacher.user.id, inMinutes(30));
    const started = await mkSession(teacher.user.id, inMinutes(-5));
    expect(code(await book(far.id, me.auth))).toBe('BOOKING_NOT_OPEN');
    expect((await book(edgeOpen.id, me.auth)).status).toBe(201);
    expect(code(await book(soon.id, me.auth))).toBe('BOOKING_CLOSED');
    expect(code(await book(edgeClosed.id, me.auth))).toBe('BOOKING_CLOSED');
    expect(code(await book(started.id, me.auth))).toBe('BOOKING_CLOSED');
    env.setNow(inMinutes(1));
    const s = await mkSession(teacher.user.id, inMinutes(32));
    expect((await book(s.id, me.auth)).status).toBe(201);
  });

  it('DAILY_LIMIT: Unlimited card allows one booking per Sofia day (AC-12)', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id, 'UNLIMITED_MONTH');
    // 2026-10-27 in Sofia (EET): 08:00 and 21:30 local = 06:00Z and 19:30Z; next day 00:30 local = 22:30Z on the 27th
    const morning = await mkSession(teacher.user.id, new Date('2026-10-27T06:00:00Z'));
    const evening = await mkSession(teacher.user.id, new Date('2026-10-27T19:30:00Z'));
    const nextDay = await mkSession(teacher.user.id, new Date('2026-10-27T22:30:00Z')); // 00:30 on 10-28 Sofia
    expect((await book(morning.id, me.auth)).status).toBe(201);
    const res = await book(evening.id, me.auth);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('DAILY_LIMIT');
    expect((await book(nextDay.id, me.auth)).status).toBe(201);
    expect((await prisma.card.findFirstOrThrow()).usedClasses).toBe(0); // unlimited never counts down
  });

  it('DAILY_LIMIT does not apply if another card can be used', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id, 'UNLIMITED_MONTH');
    const pack = await mkCard(me.user.id, 'PACK_8', { expiresAt: new Date('2027-06-01T00:00:00Z') });
    const a = await mkSession(teacher.user.id, new Date('2026-10-27T06:00:00Z'));
    const b = await mkSession(teacher.user.id, new Date('2026-10-27T19:30:00Z'));
    await book(a.id, me.auth);
    const res = await book(b.id, me.auth);
    expect(res.status).toBe(201);
    expect(res.body.cardId).toBe(pack.id);
  });

  it('USER_BLOCKED (AC-13)', async () => {
    const me = await mkUser(env, 'CLIENT', { blocked: true });
    await mkCard(me.user.id);
    const s = await mkSession(teacher.user.id, inHours(30));
    const res = await book(s.id, me.auth);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('USER_BLOCKED');
    const wl = await env.api().post(`/api/sessions/${s.id}/waitlist`).set(me.auth);
    expect(code(wl)).toBe('USER_BLOCKED');
  });

  it('uses the card that expires first (AC-15)', async () => {
    const me = await mkUser(env);
    const later = await mkCard(me.user.id, 'PACK_12');
    const sooner = await mkCard(me.user.id, 'SINGLE');
    const s1 = await mkSession(teacher.user.id, inHours(30));
    const s2 = await mkSession(teacher.user.id, inHours(31));
    expect((await book(s1.id, me.auth)).body.cardId).toBe(sooner.id);
    expect((await book(s2.id, me.auth)).body.cardId).toBe(later.id); // single is used up now
    expect(await prisma.card.findUniqueOrThrow({ where: { id: sooner.id } })).toMatchObject({ usedClasses: 1 });
  });

  it('ALREADY_BOOKED, SESSION_CANCELLED, 404', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id);
    const s = await mkSession(teacher.user.id, inHours(30));
    const c = await mkSession(teacher.user.id, inHours(30), { status: 'CANCELLED' });
    await book(s.id, me.auth);
    expect(code(await book(s.id, me.auth))).toBe('ALREADY_BOOKED');
    expect(code(await book(c.id, me.auth))).toBe('SESSION_CANCELLED');
    expect((await book('missing', me.auth)).status).toBe(404);
  });

  it('can re-book after cancelling', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id);
    const s = await mkSession(teacher.user.id, inHours(30));
    const first = await book(s.id, me.auth);
    await env.api().post(`/api/bookings/${first.body.id}/cancel`).set(me.auth);
    expect((await book(s.id, me.auth)).status).toBe(201);
    expect((await prisma.card.findFirstOrThrow()).usedClasses).toBe(1);
  });
});

describe('no overbooking under concurrency (AC-14)', () => {
  it('exactly one of many simultaneous bookings gets the last spot', async () => {
    const s = await mkSession(teacher.user.id, inHours(30), { capacity: 1 });
    const users = await Promise.all(Array.from({ length: 12 }, () => mkUser(env)));
    await Promise.all(users.map((u) => mkCard(u.user.id)));
    const results = await Promise.all(users.map((u) => book(s.id, u.auth)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 201)) expect(code(r)).toBe('SESSION_FULL');
    expect(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } })).toBe(1);
    const used = await prisma.card.aggregate({ _sum: { usedClasses: true } });
    expect(used._sum.usedClasses).toBe(1); // losers were not charged
  });

  it('respects capacity N with 2N simultaneous requests', async () => {
    const s = await mkSession(teacher.user.id, inHours(30), { capacity: 5 });
    const users = await Promise.all(Array.from({ length: 10 }, () => mkUser(env)));
    await Promise.all(users.map((u) => mkCard(u.user.id)));
    const results = await Promise.all(users.map((u) => book(s.id, u.auth)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } })).toBe(5);
  });

  it('a double click books once and charges once', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id);
    const s = await mkSession(teacher.user.id, inHours(30));
    const results = await Promise.all([book(s.id, me.auth), book(s.id, me.auth), book(s.id, me.auth)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => code(r) === 'ALREADY_BOOKED')).toHaveLength(2);
    expect((await prisma.card.findFirstOrThrow()).usedClasses).toBe(1);
  });

  it('the last class of a card is never spent twice across different sessions', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id, 'SINGLE');
    const sessions = await Promise.all([30, 31, 32, 33].map((h) => mkSession(teacher.user.id, inHours(h))));
    const results = await Promise.all(sessions.map((s) => book(s.id, me.auth)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => code(r) === 'NO_VALID_CARD')).toHaveLength(3);
    expect((await prisma.card.findFirstOrThrow()).usedClasses).toBe(1);
  });

  it('concurrent cancel + book never leaves the session overbooked', async () => {
    const s = await mkSession(teacher.user.id, inHours(30), { capacity: 2 });
    const users = await Promise.all(Array.from({ length: 6 }, () => mkUser(env)));
    await Promise.all(users.map((u) => mkCard(u.user.id)));
    const first = await Promise.all(users.slice(0, 2).map((u) => book(s.id, u.auth)));
    const [cancel, ...others] = await Promise.all([
      env.api().post(`/api/bookings/${first[0].body.id}/cancel`).set(users[0].auth),
      ...users.slice(2).map((u) => book(s.id, u.auth)),
    ]);
    expect(cancel.status).toBe(200);
    const gained = others.filter((r) => r.status === 201).length;
    expect(gained).toBeLessThanOrEqual(1);
    expect(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } })).toBe(1 + gained);
  });
});

describe('cancel (AC-16..19)', () => {
  async function booked(startsInHours: number, extra: { promotedLate?: boolean } = {}) {
    const me = await mkUser(env);
    const card = await mkCard(me.user.id);
    const s = await mkSession(teacher.user.id, inHours(startsInHours));
    const b = await prisma.booking.create({ data: { userId: me.user.id, sessionId: s.id, cardId: card.id, promotedLate: extra.promotedLate ?? false } });
    await prisma.card.update({ where: { id: card.id }, data: { usedClasses: 1 } });
    return { me, card, s, b };
  }

  it('>= 6 h before start: class returned', async () => {
    const { me, b, card } = await booked(6.5);
    const prev = await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(me.auth);
    expect(prev.body).toEqual({ lateCancel: false, classReturned: true, hoursUntilStart: 6.5 });
    const res = await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelledAt).toBeTruthy();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(0);
  });

  it('< 6 h before start: LATE_CANCELLED and the class stays used', async () => {
    const { me, b, card } = await booked(5.9);
    const prev = await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(me.auth);
    expect(prev.body).toMatchObject({ lateCancel: true, classReturned: false });
    const res = await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth);
    expect(res.body.status).toBe('LATE_CANCELLED');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(1);
  });

  it('exactly 6 h before start is still free', async () => {
    const { me, b } = await booked(6);
    expect((await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth)).body.status).toBe('CANCELLED');
  });

  it('promotedLate bookings are free to cancel inside the 6 h window (AC-18)', async () => {
    const { me, b, card } = await booked(3, { promotedLate: true });
    const prev = await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(me.auth);
    expect(prev.body).toMatchObject({ lateCancel: false, classReturned: true });
    expect((await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth)).body.status).toBe('CANCELLED');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(0);
  });

  it('SESSION_STARTED after the start (AC-19)', async () => {
    const { me, b } = await booked(1);
    env.setNow(inHours(1.01));
    for (const res of [await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(me.auth), await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth)]) {
      expect(res.status).toBe(409);
      expect(code(res)).toBe('SESSION_STARTED');
    }
  });

  it('INVALID_STATE when not BOOKED, 404 for someone else’s booking', async () => {
    const { me, b } = await booked(10);
    const other = await mkUser(env);
    expect((await env.api().post(`/api/bookings/${b.id}/cancel`).set(other.auth)).status).toBe(404);
    expect((await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(other.auth)).status).toBe(404);
    await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth);
    const again = await env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth);
    expect(again.status).toBe(409);
    expect(code(again)).toBe('INVALID_STATE');
    expect(code(await env.api().get(`/api/bookings/${b.id}/cancel-preview`).set(me.auth))).toBe('INVALID_STATE');
  });

  it('double cancel returns the class once', async () => {
    const { me, b, card } = await booked(10);
    const rs = await Promise.all([env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth), env.api().post(`/api/bookings/${b.id}/cancel`).set(me.auth)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(0);
  });
});

describe('waiting list (AC-20..22)', () => {
  const join = (id: string, auth: Record<string, string>) => env.api().post(`/api/sessions/${id}/waitlist`).set(auth);

  async function fullSession(startsInHours = 30) {
    const holder = await mkUser(env);
    await mkCard(holder.user.id);
    const s = await mkSession(teacher.user.id, inHours(startsInHours), { capacity: 1 });
    const b = await book(s.id, holder.auth);
    return { s, holder, bookingId: b.body.id as string };
  }

  it('joins a full session and sees the position; leaves any time', async () => {
    const { s } = await fullSession();
    const [a, b] = [await mkUser(env), await mkUser(env)];
    await mkCard(a.user.id);
    await mkCard(b.user.id);
    const ja = await join(s.id, a.auth);
    const jb = await join(s.id, b.auth);
    expect(ja.status).toBe(201);
    expect(ja.body).toMatchObject({ status: 'WAITING', position: 1 });
    expect(jb.body.position).toBe(2);
    const mine = await env.api().get('/api/me/waitlist').set(b.auth);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ id: jb.body.id, position: 2 });
    expect((await env.api().delete(`/api/waitlist/${ja.body.id}`).set(a.auth)).status).toBe(204);
    expect((await env.api().get('/api/me/waitlist').set(b.auth)).body[0].position).toBe(1);
    expect(await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: ja.body.id } })).toMatchObject({ status: 'LEFT' });
    expect((await env.api().delete(`/api/waitlist/${ja.body.id}`).set(a.auth)).status).toBe(409);
    expect((await env.api().delete(`/api/waitlist/${jb.body.id}`).set(a.auth)).status).toBe(404);
  });

  it('error cases', async () => {
    const { s, holder } = await fullSession();
    const free = await mkSession(teacher.user.id, inHours(31));
    const me = await mkUser(env);
    expect(code(await join(s.id, me.auth))).toBe('NO_VALID_CARD');
    await mkCard(me.user.id);
    expect(code(await join(free.id, me.auth))).toBe('SESSION_NOT_FULL');
    expect(code(await join(s.id, holder.auth))).toBe('ALREADY_BOOKED');
    expect((await join(s.id, me.auth)).status).toBe(201);
    expect(code(await join(s.id, me.auth))).toBe('ALREADY_ON_WAITLIST');
    const far = await mkSession(teacher.user.id, inDays(16), { capacity: 1 });
    expect(code(await join(far.id, me.auth))).toBe('BOOKING_NOT_OPEN');
    const soon = await mkSession(teacher.user.id, inMinutes(20), { capacity: 1 });
    expect(code(await join(soon.id, me.auth))).toBe('BOOKING_CLOSED');
    const cancelled = await mkSession(teacher.user.id, inHours(40), { capacity: 1, status: 'CANCELLED' });
    expect(code(await join(cancelled.id, me.auth))).toBe('SESSION_CANCELLED');
  });

  it('a cancellation promotes the first waiting client with a card, takes the class and emails (AC-21)', async () => {
    const { s, holder, bookingId } = await fullSession();
    const noCard = await mkUser(env);
    const first = await mkUser(env, 'CLIENT', { lang: 'bg' });
    const second = await mkUser(env);
    const c1 = await mkCard(first.user.id);
    await mkCard(second.user.id);
    await mkCard(noCard.user.id);
    await join(s.id, noCard.auth).then(() => undefined);
    // noCard joined only because they had a card; now their card is gone
    await prisma.card.deleteMany({ where: { userId: noCard.user.id } });
    await join(s.id, first.auth);
    await join(s.id, second.auth);
    env.mailer.sent = [];
    await prisma.emailOutbox.deleteMany();

    const res = await env.api().post(`/api/bookings/${bookingId}/cancel`).set(holder.auth);
    expect(res.status).toBe(200);
    const promoted = await prisma.booking.findFirstOrThrow({ where: { sessionId: s.id, status: 'BOOKED' } });
    expect(promoted.userId).toBe(first.user.id);
    expect(promoted.cardId).toBe(c1.id);
    expect(promoted.promotedLate).toBe(false);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: c1.id } })).usedClasses).toBe(1);
    expect(await prisma.waitlistEntry.count({ where: { status: 'WAITING' } })).toBe(2); // noCard skipped (still waiting), second still waits
    const mails = await prisma.emailOutbox.findMany();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ template: 'WAITLIST_PROMOTED', lang: 'bg' });
  });

  it('promotes even inside the 6 h window and marks promotedLate', async () => {
    const { s, holder, bookingId } = await fullSession(8);
    const w = await mkUser(env);
    await mkCard(w.user.id);
    await join(s.id, w.auth);
    env.setNow(inHours(3)); // 5 h before start, still before booking closes
    await env.api().post(`/api/bookings/${bookingId}/cancel`).set(holder.auth);
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: w.user.id } });
    expect(b).toMatchObject({ status: 'BOOKED', promotedLate: true });
    // so cancelling it is free
    const res = await env.api().post(`/api/bookings/${b.id}/cancel`).set(w.auth);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('a late cancel by the holder still frees the spot for the waiting list', async () => {
    const { s, holder, bookingId } = await fullSession(8);
    const w = await mkUser(env);
    await mkCard(w.user.id);
    await join(s.id, w.auth);
    env.setNow(inHours(4));
    const res = await env.api().post(`/api/bookings/${bookingId}/cancel`).set(holder.auth);
    expect(res.body.status).toBe('LATE_CANCELLED');
    expect(await prisma.booking.count({ where: { userId: w.user.id, status: 'BOOKED' } })).toBe(1);
  });

  it('does not promote after booking closed; remaining entries expire (AC-22)', async () => {
    const { s, holder, bookingId } = await fullSession(8);
    const w = await mkUser(env);
    await mkCard(w.user.id);
    const j = await join(s.id, w.auth);
    env.setNow(new Date(s.startsAt.getTime() - 29 * 60e3));
    await env.api().post(`/api/bookings/${bookingId}/cancel`).set(holder.auth);
    expect(await prisma.booking.count({ where: { userId: w.user.id } })).toBe(0);
    expect(await expireWaitlists(env.ctx)).toBe(1);
    expect(await expireWaitlists(env.ctx)).toBe(0); // idempotent
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: j.body.id } })).status).toBe('EXPIRED');
    expect((await env.api().get('/api/me/waitlist').set(w.auth)).body).toEqual([]);
  });

  it('booking directly while waiting marks the entry promoted', async () => {
    const { s, holder, bookingId } = await fullSession();
    const w = await mkUser(env);
    await mkCard(w.user.id);
    const j = await join(s.id, w.auth);
    // a spot frees up without the waiting list being served (e.g. the only waiting entry was skipped earlier)
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    const res = await book(s.id, w.auth);
    expect(res.status).toBe(201);
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: j.body.id } })).status).toBe('PROMOTED');
    expect(holder.user.id).toBeTruthy();
  });
});

describe('my bookings and cards (AC-23, AC-24)', () => {
  it('upcoming vs past, ordered', async () => {
    const me = await mkUser(env);
    await mkCard(me.user.id);
    const mk = async (h: number, status: 'BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'LATE_CANCELLED' | 'CANCELLED' | 'CLASS_CANCELLED', duration = 60) => {
      const s = await mkSession(teacher.user.id, inHours(h), { durationMin: duration });
      return prisma.booking.create({ data: { userId: me.user.id, sessionId: s.id, status } });
    };
    const up2 = await mk(50, 'BOOKED');
    const up1 = await mk(10, 'BOOKED');
    const running = await mk(-0.5, 'BOOKED'); // started 30 min ago, 60 min long: still upcoming
    const ended = await mk(-3, 'BOOKED'); // ended, never marked
    const att = await mk(-24, 'ATTENDED');
    const cancelled = await mk(20, 'CANCELLED');
    const upcoming = await env.api().get('/api/me/bookings').set(me.auth);
    expect(upcoming.body.map((b: { id: string }) => b.id)).toEqual([running.id, up1.id, up2.id]);
    const past = await env.api().get('/api/me/bookings?scope=past').set(me.auth);
    expect(past.body.map((b: { id: string }) => b.id)).toEqual([cancelled.id, ended.id, att.id]);
    expect(past.body.map((b: { status: string }) => b.status)).toEqual(['CANCELLED', 'BOOKED', 'ATTENDED']);
    expect((await env.api().get('/api/me/bookings?scope=x').set(me.auth)).status).toBe(400);
  });

  it('cards: active first, then by expiry descending, with remaining classes', async () => {
    const me = await mkUser(env);
    const expired = await mkCard(me.user.id, 'PACK_8', { validFrom: '2026-01-01', expiresAt: new Date('2026-03-01T00:00:00Z') });
    const used = await mkCard(me.user.id, 'SINGLE', { used: 1 });
    const pack = await mkCard(me.user.id, 'PACK_12', { used: 2 });
    const unlimited = await mkCard(me.user.id, 'UNLIMITED_MONTH');
    const res = await env.api().get('/api/me/cards').set(me.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([pack.id, unlimited.id, used.id, expired.id]);
    expect(res.body[0]).toMatchObject({ type: 'PACK_12', totalClasses: 12, usedClasses: 2, remainingClasses: 10, isActive: true });
    expect(res.body[0].events).toBeUndefined();
    expect(res.body[1]).toMatchObject({ remainingClasses: null, isActive: true });
    expect(res.body[2].isActive).toBe(false);
    expect(res.body[3].isActive).toBe(false);
    expect(res.body[0].expiresAt).toBe(cardExpiry('2026-10-23', 'PACK_12').toISOString());
  });
});
