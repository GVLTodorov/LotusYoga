import { expect, test } from '@playwright/test';
import {
  addDaysStr, admin, book, call, clientWithCard, createSession, createUser, getSession, giveCard, inDays, inHours,
  inMinutes, joinWaitlist, myCards, sofiaToday, sofiaToUtc,
} from '../helpers/api';

let instr: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => { instr = await createUser('INSTRUCTOR'); });

const sess = (startsAt: Date, capacity = 14) => createSession({ instructorId: instr.id, startsAt, capacity });

test.describe('AC-6 / AC-7 public schedule and per-client state', () => {
  test('AC-6 anonymous list has required fields, no my* fields, Sofia-week default range, cancelled badge data', async () => {
    const s = await sess(inDays(1));
    const c = await sess(inDays(1));
    await call('POST', `/api/admin/sessions/${c.id}/cancel`, { token: (await admin()).token, body: { reason: 'holiday' } });
    const far = await sess(inDays(40));
    const r = await call('GET', '/api/sessions');
    expect(r.status).toBe(200);
    const byId = new Map(r.body.map((x: any) => [x.id, x]));
    const got: any = byId.get(s.id);
    expect(got).toMatchObject({ name: s.name, capacity: 14, bookedCount: 0, freeSpots: 14, status: 'SCHEDULED', instructor: { id: instr.id, name: instr.name } });
    expect(got.myState).toBeUndefined();
    expect(new Date(got.bookingClosesAt).getTime()).toBe(new Date(got.startsAt).getTime() - 30 * 60_000);
    expect(new Date(got.bookingOpensAt).getTime()).toBe(new Date(got.startsAt).getTime() - 14 * 86400_000);
    expect((byId.get(c.id) as any).status).toBe('CANCELLED');
    expect(byId.has(far.id)).toBe(false);
    const starts = r.body.map((x: any) => x.startsAt);
    expect(starts).toEqual([...starts].sort());
  });

  test('AC-6 range: explicit from/to and > 15 days rejected', async () => {
    const today = sofiaToday();
    const ok = await call('GET', `/api/sessions?from=${today}&to=${addDaysStr(today, 14)}`);
    expect(ok.status).toBe(200);
    const tooBig = await call('GET', `/api/sessions?from=${today}&to=${addDaysStr(today, 40)}`);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
    expect((await call('GET', '/api/sessions?from=garbage')).status).toBe(400);
  });

  test('AC-6 free spots drop and full shows 0', async () => {
    const s = await sess(inDays(2), 1);
    const c = await clientWithCard();
    await book(c, s.id);
    const g = await getSession(s.id);
    expect(g).toMatchObject({ bookedCount: 1, freeSpots: 0, waitlistCount: 0 });
  });

  test('AC-7 myState: CAN_BOOK, BOOKED, CAN_JOIN_WAITLIST, WAITLISTED(position), NOT_OPEN, CLOSED, CANCELLED', async () => {
    const c = await clientWithCard();
    const other = await clientWithCard();
    const open = await sess(inDays(2));
    const full = await sess(inDays(2), 1);
    const notOpen = await sess(inDays(20));
    const closed = await sess(inMinutes(20));
    const cancelled = await sess(inDays(2));
    await call('POST', `/api/admin/sessions/${cancelled.id}/cancel`, { token: (await admin()).token, body: {} });
    await book(other, full.id);
    const st = async (id: string) => (await call('GET', `/api/sessions/${id}`, { token: c.token })).body;

    expect((await st(open.id)).myState).toBe('CAN_BOOK');
    expect((await st(full.id)).myState).toBe('CAN_JOIN_WAITLIST');
    expect((await st(notOpen.id)).myState).toBe('NOT_OPEN');
    expect((await st(closed.id)).myState).toBe('CLOSED');
    expect((await st(cancelled.id)).myState).toBe('CANCELLED');

    const b = await book(c, open.id);
    const afterBook = await st(open.id);
    expect(afterBook).toMatchObject({ myState: 'BOOKED', myBookingId: b.body.id });
    const w = await joinWaitlist(c, full.id);
    const afterWl = await st(full.id);
    expect(afterWl).toMatchObject({ myState: 'WAITLISTED', myWaitlistId: w.body.id, myWaitlistPosition: 1 });
    // list endpoint carries the same per-user state
    const list = await call('GET', '/api/sessions', { token: c.token });
    expect(list.body.find((x: any) => x.id === open.id).myState).toBe('BOOKED');
  });
});

test.describe('AC-8 .. AC-13, AC-15 booking rules', () => {
  test('AC-8 booking takes one class from the card and is listed in my bookings', async () => {
    const c = await clientWithCard('PACK_8');
    const s = await sess(inDays(2));
    const r = await book(c, s.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'BOOKED', walkIn: false, promotedLate: false });
    const [card] = await myCards(c);
    expect(card).toMatchObject({ type: 'PACK_8', totalClasses: 8, usedClasses: 1, remainingClasses: 7, isActive: true });
    const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: c.token });
    expect(up.body.map((b: any) => b.id)).toContain(r.body.id);
    expect(up.body[0].session.id).toBe(s.id);
  });

  test('AC-8 ALREADY_BOOKED, 404 on unknown session, 401 anonymous', async () => {
    const c = await clientWithCard();
    const s = await sess(inDays(2));
    expect((await book(c, s.id)).status).toBe(201);
    const again = await book(c, s.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_BOOKED');
    expect((await myCards(c))[0].usedClasses).toBe(1);
    expect((await book(c, 'does-not-exist')).status).toBe(404);
    expect((await call('POST', `/api/sessions/${s.id}/bookings`)).status).toBe(401);
  });

  test('AC-8 cancelled session cannot be booked (SESSION_CANCELLED)', async () => {
    const c = await clientWithCard();
    const s = await sess(inDays(2));
    await call('POST', `/api/admin/sessions/${s.id}/cancel`, { token: (await admin()).token, body: {} });
    const r = await book(c, s.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SESSION_CANCELLED');
  });

  test('AC-9 full session -> SESSION_FULL and waitlist is possible', async () => {
    const s = await sess(inDays(2), 1);
    const a = await clientWithCard();
    const b = await clientWithCard();
    expect((await book(a, s.id)).status).toBe(201);
    const r = await book(b, s.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SESSION_FULL');
    expect((await myCards(b))[0].usedClasses).toBe(0);
    expect((await joinWaitlist(b, s.id)).status).toBe(201);
  });

  test('AC-10 NO_VALID_CARD: no card / expired / used up / not yet valid', async () => {
    const s = await sess(inDays(2));
    const none = await createUser('CLIENT');
    const r = await book(none, s.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_VALID_CARD');
    expect(r.body.error.message).toMatch(/studio/i);

    const expired = await createUser('CLIENT');
    await giveCard(expired.id, 'SINGLE', { validFrom: addDaysStr(sofiaToday(), -90) });
    expect((await book(expired, s.id)).body.error.code).toBe('NO_VALID_CARD');

    const used = await clientWithCard('SINGLE');
    expect((await book(used, s.id)).status).toBe(201);
    const s2 = await sess(inDays(3));
    expect((await book(used, s2.id)).body.error.code).toBe('NO_VALID_CARD');

    const future = await createUser('CLIENT');
    await giveCard(future.id, 'PACK_8', { validFrom: addDaysStr(sofiaToday(), 10) });
    expect((await book(future, s.id)).body.error.code).toBe('NO_VALID_CARD');
    // ... but that same card is valid for a session on/after its start date
    const later = await sess(inDays(11));
    expect((await book(future, later.id)).status).toBe(201);
  });

  test('AC-10 a card that expires before the session date is not valid for it', async () => {
    const c = await createUser('CLIENT');
    const card = await giveCard(c.id, 'SINGLE');
    const a = await admin();
    // shrink expiry to yesterday -> expired
    const patch = await call('PATCH', `/api/admin/cards/${card.id}`, { token: a.token, body: { expiresAt: addDaysStr(sofiaToday(), -1), note: 'e2e' } });
    expect(patch.status).toBe(200);
    expect((await book(c, (await sess(inDays(2))).id)).body.error.code).toBe('NO_VALID_CARD');
  });

  test('AC-11 BOOKING_NOT_OPEN (> 14 d) and BOOKING_CLOSED (< 30 min); boundaries', async () => {
    const c = await clientWithCard();
    const far = await sess(inDays(15));
    const rf = await book(c, far.id);
    expect(rf.status).toBe(409);
    expect(rf.body.error.code).toBe('BOOKING_NOT_OPEN');
    const soon = await sess(inMinutes(20));
    const rs = await book(c, soon.id);
    expect(rs.status).toBe(409);
    expect(rs.body.error.code).toBe('BOOKING_CLOSED');
    const started = await sess(inMinutes(-10));
    expect((await book(c, started.id)).body.error.code).toBe('BOOKING_CLOSED');
    // just inside the window both ways
    expect((await book(c, (await sess(inMinutes(40))).id)).status).toBe(201);
    expect((await book(c, (await sess(new Date(Date.now() + 14 * 86400_000 - 3600_000))).id)).status).toBe(201);
    expect((await myCards(c))[0].usedClasses).toBe(2);
  });

  test('AC-12 Unlimited card: second booking on same Sofia day -> DAILY_LIMIT; other day ok', async () => {
    const c = await clientWithCard('UNLIMITED_MONTH');
    const day = addDaysStr(sofiaToday(), 3);
    const a = await sess(sofiaToUtc(day, '09:00'));
    const b = await sess(sofiaToUtc(day, '19:00'));
    const next = await sess(sofiaToUtc(addDaysStr(day, 1), '09:00'));
    expect((await book(c, a.id)).status).toBe(201);
    const r = await book(c, b.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DAILY_LIMIT');
    expect((await book(c, next.id)).status).toBe(201);
    const [card] = await myCards(c);
    expect(card).toMatchObject({ type: 'UNLIMITED_MONTH', remainingClasses: null, isActive: true });
  });

  test('AC-12 unless another card can be used: unlimited + pack -> second same-day booking uses the pack', async () => {
    const c = await clientWithCard('UNLIMITED_MONTH');
    await giveCard(c.id, 'PACK_8');
    const day = addDaysStr(sofiaToday(), 4);
    const a = await sess(sofiaToUtc(day, '09:00'));
    const b = await sess(sofiaToUtc(day, '19:00'));
    expect((await book(c, a.id)).status).toBe(201);
    expect((await book(c, b.id)).status).toBe(201);
    const cards = await myCards(c);
    expect(cards.find((x: any) => x.type === 'PACK_8').usedClasses).toBe(1);
  });

  test('AC-13 blocked client: book + waitlist -> 403 USER_BLOCKED; existing booking stays; unblock restores', async () => {
    const c = await clientWithCard('PACK_8');
    const a = await admin();
    const mine = await sess(inDays(2));
    const full = await sess(inDays(2), 1);
    const taker = await clientWithCard();
    await book(taker, full.id);
    const existing = await book(c, mine.id);
    expect((await call('PATCH', `/api/admin/users/${c.id}`, { token: a.token, body: { blocked: true } })).status).toBe(200);
    const open = await sess(inDays(2));
    const rb = await book(c, open.id);
    expect(rb.status).toBe(403);
    expect(rb.body.error.code).toBe('USER_BLOCKED');
    expect(rb.body.error.message).toMatch(/studio/i);
    const rw = await joinWaitlist(c, full.id);
    expect(rw.status).toBe(403);
    expect(rw.body.error.code).toBe('USER_BLOCKED');
    const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: c.token });
    expect(up.body.map((b: any) => b.id)).toContain(existing.body.id);
    await call('PATCH', `/api/admin/users/${c.id}`, { token: a.token, body: { blocked: false } });
    expect((await book(c, open.id)).status).toBe(201);
  });

  test('AC-15 card that expires first is used (SINGLE before PACK_12, regardless of purchase order)', async () => {
    const c = await createUser('CLIENT');
    const pack = await giveCard(c.id, 'PACK_12');
    const single = await giveCard(c.id, 'SINGLE');
    expect(new Date(single.expiresAt).getTime()).toBeLessThan(new Date(pack.expiresAt).getTime());
    const s = await sess(inDays(2));
    const r = await book(c, s.id);
    expect(r.body.cardId).toBe(single.id);
    const cards = await myCards(c);
    expect(cards.find((x: any) => x.id === single.id).usedClasses).toBe(1);
    expect(cards.find((x: any) => x.id === pack.id).usedClasses).toBe(0);
    // next booking: single is used up -> pack
    const r2 = await book(c, (await sess(inDays(3))).id);
    expect(r2.body.cardId).toBe(pack.id);
  });
});

test.describe('AC-14 concurrency (no overbooking)', () => {
  for (const [capacity, clients] of [[1, 10], [3, 12]] as const) {
    test(`AC-14 ${clients} simultaneous bookings for capacity ${capacity}: exactly ${capacity} succeed`, async () => {
      const s = await sess(inDays(2), capacity);
      const people = await Promise.all(Array.from({ length: clients }, () => clientWithCard('PACK_8')));
      const results = await Promise.all(people.map((p) => book(p, s.id)));
      const ok = results.filter((r) => r.status === 201);
      const full = results.filter((r) => r.status === 409 && r.body.error.code === 'SESSION_FULL');
      expect(ok).toHaveLength(capacity);
      expect(full).toHaveLength(clients - capacity);
      const g = await getSession(s.id);
      expect(g.bookedCount).toBe(capacity);
      expect(g.freeSpots).toBe(0);
      // losers' cards were not charged
      let used = 0;
      for (const p of people) used += (await myCards(p))[0].usedClasses;
      expect(used).toBe(capacity);
    });
  }

  test('AC-14 same client double-submitting books once and is charged once', async () => {
    const c = await clientWithCard('PACK_8');
    const s = await sess(inDays(2));
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => book(c, s.id)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'ALREADY_BOOKED')).toBe(true);
    expect((await myCards(c))[0].usedClasses).toBe(1);
  });

  test('AC-14 simultaneous cancel + book on a full session never overbooks', async () => {
    const s = await sess(inDays(2), 1);
    const a = await clientWithCard();
    const b = await clientWithCard();
    const c = await clientWithCard();
    const ba = await book(a, s.id);
    const [rc, rb, rcc] = await Promise.all([
      call('POST', `/api/bookings/${ba.body.id}/cancel`, { token: a.token }),
      book(b, s.id),
      book(c, s.id),
    ]);
    expect(rc.status).toBe(200);
    const g = await getSession(s.id);
    expect(g.bookedCount).toBeLessThanOrEqual(1);
    expect([rb, rcc].filter((r) => r.status === 201).length).toBeLessThanOrEqual(1);
  });
});

test('AC-23 / AC-24 my bookings and cards listing', async () => {
  const c = await clientWithCard('PACK_8');
  const old = await giveCard(c.id, 'SINGLE', { validFrom: addDaysStr(sofiaToday(), -90) });
  const s = await sess(inDays(2));
  const b = await book(c, s.id);
  const cards = await call('GET', '/api/me/cards', { token: c.token });
  expect(cards.status).toBe(200);
  const active = cards.body.filter((x: any) => x.isActive);
  const expired = cards.body.filter((x: any) => !x.isActive);
  expect(active.map((x: any) => x.type)).toEqual(['PACK_8']);
  expect(expired.map((x: any) => x.id)).toEqual([old.id]);
  expect(cards.body[0].isActive).toBe(true); // active first
  expect(cards.body[0].events).toBeUndefined();
  expect(active[0]).toMatchObject({ remainingClasses: 7, totalClasses: 8 });
  expect(active[0].expiresAt).toMatch(/Z$/);

  // cancelled shows up in past with status
  await call('POST', `/api/bookings/${b.body.id}/cancel`, { token: c.token });
  const past = await call('GET', '/api/me/bookings?scope=past', { token: c.token });
  expect(past.body.find((x: any) => x.id === b.body.id).status).toBe('CANCELLED');
  const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: c.token });
  expect(up.body).toHaveLength(0);
  expect((await call('GET', '/api/me/bookings?scope=bogus', { token: c.token })).status).toBe(400);
});
