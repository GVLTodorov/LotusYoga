import { expect, test } from '@playwright/test';
import {
  PASSWORD, addDaysStr, admin, book, call, cancelBooking, clientWithCard, createSession, createUser, giveCard, inDays,
  inHours, inMinutes, moveSession, myCards, sofiaParts, sofiaToUtc, sofiaToday, uid,
} from '../helpers/api';

let instr: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => { instr = await createUser('INSTRUCTOR'); });
const sess = (startsAt: Date, capacity = 14) => createSession({ instructorId: instr.id, startsAt, capacity });

test.describe('AC-33 / AC-34 users', () => {
  test('AC-33 search by name/email/phone with phone, active card summary and blocked flag', async () => {
    const a = await admin();
    const tag = `Zq${uid()}`;
    const c = await clientWithCard('PACK_12', { name: `${tag} Ivanova` });
    const noCard = await createUser('CLIENT', { name: `${tag} Petrova` });
    await call('PATCH', `/api/admin/users/${noCard.id}`, { token: a.token, body: { blocked: true } });
    const r = await call('GET', `/api/admin/users?q=${tag}`, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    const by = Object.fromEntries(r.body.items.map((u: any) => [u.id, u]));
    expect(by[c.id]).toMatchObject({ phone: c.phone, blocked: false, activeCard: { type: 'PACK_12', remainingClasses: 12 } });
    expect(by[noCard.id]).toMatchObject({ blocked: true, activeCard: null });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon/);
    for (const q of [c.email, c.phone.slice(-6), tag.toLowerCase()]) {
      const x = await call('GET', `/api/admin/users?q=${encodeURIComponent(q)}`, { token: a.token });
      expect(x.body.items.map((u: any) => u.id), q).toContain(c.id);
    }
    const none = await call('GET', `/api/admin/users?q=${uid()}${uid()}`, { token: a.token });
    expect(none.body).toEqual({ items: [], total: 0 });
  });

  test('AC-33 role filter and pagination bounds', async () => {
    const a = await admin();
    const only = await call('GET', '/api/admin/users?role=INSTRUCTOR&pageSize=100', { token: a.token });
    expect(only.status).toBe(200);
    expect(only.body.items.every((u: any) => u.role === 'INSTRUCTOR')).toBe(true);
    const p1 = await call('GET', '/api/admin/users?page=1&pageSize=2', { token: a.token });
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBeGreaterThanOrEqual(2);
    const p2 = await call('GET', '/api/admin/users?page=2&pageSize=2', { token: a.token });
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    const far = await call('GET', '/api/admin/users?page=9999&pageSize=2', { token: a.token });
    expect(far.status).toBe(200);
    expect(far.body.items).toEqual([]);
    for (const bad of ['page=0', 'pageSize=0', 'pageSize=100000', 'page=-1', 'role=KING']) {
      expect((await call('GET', `/api/admin/users?${bad}`, { token: a.token })).status, bad).toBe(400);
    }
  });

  test('AC-34 create client/instructor/admin; EMAIL_TAKEN; validation; edit name, phone, role, lang', async () => {
    const a = await admin();
    for (const role of ['CLIENT', 'INSTRUCTOR', 'ADMIN'] as const) {
      const u = await createUser(role);
      expect(u.role).toBe(role);
    }
    const email = `dup-${uid()}@e2e.test`;
    const body = { email, password: PASSWORD, name: 'Dup', phone: '+359 888 111 222', role: 'CLIENT' };
    expect((await call('POST', '/api/admin/users', { token: a.token, body })).status).toBe(201);
    const dup = await call('POST', '/api/admin/users', { token: a.token, body });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    expect((await call('POST', '/api/admin/users', { token: a.token, body: { ...body, email: 'x@y.test', password: 'short' } })).status).toBe(400);
    expect((await call('POST', '/api/admin/users', { token: a.token, body: { ...body, email: 'x2@y.test', role: 'ROOT' } })).status).toBe(400);

    const c = await createUser('CLIENT');
    const edit = await call('PATCH', `/api/admin/users/${c.id}`, { token: a.token, body: { name: 'Преименуван', phone: '+359 877 000 111', role: 'INSTRUCTOR', lang: 'bg' } });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ name: 'Преименуван', phone: '+359 877 000 111', role: 'INSTRUCTOR', lang: 'bg' });
    expect((await call('PATCH', '/api/admin/users/nope', { token: a.token, body: { name: 'x' } })).status).toBe(404);
    // an admin can't remove their own ADMIN role
    const self = await call('PATCH', `/api/admin/users/${a.id}`, { token: a.token, body: { role: 'CLIENT' } });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('INVALID_STATE');
  });
});

test.describe('AC-35 card recording and validity (Sofia end-of-day, DST aware)', () => {
  // [type, validFrom, total, expiresAt (UTC) = end of (validFrom + period - 1 day) in Europe/Sofia]
  const cases: [string, string, number | null, string][] = [
    ['SINGLE', '2026-11-03', 1, '2026-12-02T21:59:59.999Z'], // winter, UTC+2
    ['PACK_8', '2026-11-03', 8, '2027-01-02T21:59:59.999Z'],
    ['PACK_12', '2026-11-03', 12, '2027-02-02T21:59:59.999Z'],
    ['UNLIMITED_MONTH', '2026-11-03', null, '2026-12-02T21:59:59.999Z'],
    ['SINGLE', '2026-03-01', 1, '2026-03-31T20:59:59.999Z'], // DST began 2026-03-29 -> UTC+3
    ['SINGLE', '2026-09-01', 1, '2026-09-30T20:59:59.999Z'], // summer
    ['SINGLE', '2026-09-30', 1, '2026-10-29T21:59:59.999Z'], // start in summer, expiry after DST ended (2026-10-25)
    ['PACK_8', '2026-02-20', 8, '2026-04-19T20:59:59.999Z'], // start in winter, expiry in summer time
  ];
  for (const [type, validFrom, total, expiresAt] of cases) {
    test(`AC-35 ${type} from ${validFrom} -> ${expiresAt}`, async () => {
      const c = await createUser('CLIENT');
      const card = await giveCard(c.id, type as any, { validFrom, priceBgn: 40 });
      expect(card).toMatchObject({ type, totalClasses: total, usedClasses: 0, validFrom, expiresAt, paymentMethod: 'CASH', priceBgn: 40 });
      // expiry is the last millisecond of a Sofia-local day
      const p = sofiaParts(new Date(new Date(expiresAt).getTime() + 1));
      expect(p.time).toBe('00:00');
    });
  }

  test('AC-35 start date defaults to today (Sofia); bank transfer; optional price; validation', async () => {
    const a = await admin();
    const c = await createUser('CLIENT');
    const card = await call('POST', `/api/admin/users/${c.id}/cards`, { token: a.token, body: { type: 'SINGLE', paymentMethod: 'BANK_TRANSFER' } });
    expect(card.status).toBe(201);
    expect(card.body).toMatchObject({ validFrom: sofiaToday(), paymentMethod: 'BANK_TRANSFER', priceBgn: null });
    for (const bad of [{ type: 'PACK_99' }, { paymentMethod: 'BITCOIN' }, { priceBgn: -5 }, { validFrom: '03/11/2026' }]) {
      const r = await call('POST', `/api/admin/users/${c.id}/cards`, { token: a.token, body: { type: 'SINGLE', paymentMethod: 'CASH', ...bad } });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('POST', '/api/admin/users/nope/cards', { token: a.token, body: { type: 'SINGLE', paymentMethod: 'CASH' } })).status).toBe(404);
    const client = await createUser('CLIENT');
    expect((await call('POST', `/api/admin/users/${c.id}/cards`, { token: client.token, body: { type: 'SINGLE', paymentMethod: 'CASH' } })).status).toBe(403);
  });
});

test('AC-36 extending a card is saved, logged with old/new date, admin and note, and revives an expired card', async () => {
  const a = await admin();
  const c = await createUser('CLIENT');
  const card = await giveCard(c.id, 'PACK_8', { validFrom: addDaysStr(sofiaToday(), -70) }); // expired ~10 days ago
  const s = await sess(inDays(2));
  expect((await book(c, s.id)).body.error.code).toBe('NO_VALID_CARD');
  const newDate = addDaysStr(sofiaToday(), 30);
  const r = await call('PATCH', `/api/admin/cards/${card.id}`, { token: a.token, body: { expiresAt: newDate, note: 'Paid late, extended' } });
  expect(r.status).toBe(200);
  expect(sofiaParts(new Date(new Date(r.body.expiresAt).getTime() + 1))).toMatchObject({ date: addDaysStr(newDate, 1), time: '00:00' });
  const ev = r.body.events.find((e: any) => e.type === 'EXPIRY_CHANGED');
  expect(ev).toMatchObject({ oldExpiresAt: card.expiresAt, newExpiresAt: r.body.expiresAt, note: 'Paid late, extended', byUser: { id: a.id } });
  expect(r.body.events.some((e: any) => e.type === 'CREATED')).toBe(true);
  expect((await book(c, s.id)).status).toBe(201);
  expect((await myCards(c))[0].events).toBeUndefined();
  expect((await call('PATCH', `/api/admin/cards/${card.id}`, { token: a.token, body: { expiresAt: 'bad' } })).status).toBe(400);
  expect((await call('PATCH', '/api/admin/cards/nope', { token: a.token, body: { expiresAt: newDate } })).status).toBe(404);
  expect((await call('PATCH', `/api/admin/cards/${card.id}`, { token: c.token, body: { expiresAt: newDate } })).status).toBe(403);
});

test('AC-37 history shows cards with events, all bookings newest first, and totals', async () => {
  const a = await admin();
  const c = await clientWithCard('PACK_12');
  const attended = await sess(inHours(3));
  const noshow = await sess(inHours(3));
  const late = await sess(inHours(3));
  const normal = await sess(inDays(3));
  const ba = await book(c, attended.id);
  const bn = await book(c, noshow.id);
  const bl = await book(c, late.id);
  const bc = await book(c, normal.id);
  for (const s of [attended, noshow]) await moveSession(s.id, inMinutes(5));
  expect((await call('PATCH', `/api/bookings/${ba.body.id}/attendance`, { token: instr.token, body: { status: 'ATTENDED' } })).status).toBe(200);
  expect((await call('PATCH', `/api/bookings/${bn.body.id}/attendance`, { token: instr.token, body: { status: 'NO_SHOW' } })).status).toBe(200);
  expect((await cancelBooking(c, bl.body.id)).body.status).toBe('LATE_CANCELLED');
  expect((await cancelBooking(c, bc.body.id)).body.status).toBe('CANCELLED');
  const h = await call('GET', `/api/admin/users/${c.id}/history`, { token: a.token });
  expect(h.status).toBe(200);
  expect(h.body.user.id).toBe(c.id);
  expect(h.body.stats).toEqual({ attended: 1, noShows: 1, lateCancels: 1 });
  expect(h.body.cards).toHaveLength(1);
  expect(h.body.cards[0].events[0]).toMatchObject({ type: 'CREATED', byUser: { id: a.id } });
  expect(h.body.bookings).toHaveLength(4);
  expect(h.body.bookings.map((b: any) => b.status).sort()).toEqual(['ATTENDED', 'CANCELLED', 'LATE_CANCELLED', 'NO_SHOW']);
  const times = h.body.bookings.map((b: any) => b.session.startsAt);
  expect(times).toEqual([...times].sort().reverse());
  const client = await createUser('CLIENT');
  expect((await call('GET', `/api/admin/users/${c.id}/history`, { token: client.token })).status).toBe(403);
  expect((await call('GET', '/api/admin/users/nope/history', { token: a.token })).status).toBe(404);
});

test.describe('AC-39 monthly report', () => {
  test('AC-39 classes held, average attendance, no-show count/rate; month boundaries are Sofia-local', async () => {
    const a = await admin();
    // Pick an old, empty month (June: no DST change) so numbers are exact and the test is repeatable.
    let year = 2000 + Math.floor(Math.random() * 15);
    for (let i = 0; i < 20; i++) {
      const base = await call('GET', `/api/admin/reports/monthly?month=${year}-06`, { token: a.token });
      expect(base.status).toBe(200);
      if (base.body.classesHeld === 0 && base.body.noShowCount === 0) break;
      year++;
    }
    const month = `${year}-06`;
    const nextMonth = `${year}-07`;
    const held = async (startsAt: Date, who: Awaited<ReturnType<typeof clientWithCard>>[] , statuses: ('ATTENDED' | 'NO_SHOW')[]) => {
      const s = await sess(inHours(3), 5);
      const bookings = [];
      for (const w of who) bookings.push((await book(w, s.id)).body);
      await moveSession(s.id, inMinutes(5)); // inside the attendance window
      for (let i = 0; i < bookings.length; i++) {
        const r = await call('PATCH', `/api/bookings/${bookings[i].id}/attendance`, { token: a.token, body: { status: statuses[i] } });
        expect(r.status).toBe(200);
      }
      const mv = await moveSession(s.id, startsAt);
      expect(mv.status, JSON.stringify(mv.body)).toBe(200);
      return s;
    };
    const [c1, c2, c3] = await Promise.all([clientWithCard('PACK_8'), clientWithCard('PACK_8'), clientWithCard('PACK_8')]);
    await held(sofiaToUtc(`${year}-06-10`, '10:00'), [c1, c2, c3], ['ATTENDED', 'ATTENDED', 'NO_SHOW']);
    await held(sofiaToUtc(`${year}-06-20`, '18:00'), [c1, c2], ['ATTENDED', 'NO_SHOW']);
    // empty classes that started but nobody came
    await held(sofiaToUtc(`${year}-06-30`, '23:30'), [], []); // last Sofia evening of June (UTC: still June)
    await held(sofiaToUtc(`${year}-07-01`, '00:30'), [], []); // July in Sofia (UTC: 21:30 on June 30)

    const june = await call('GET', `/api/admin/reports/monthly?month=${month}`, { token: a.token });
    expect(june.body.month).toBe(month);
    expect(june.body.classesHeld).toBe(3); // 2 + the 23:30 one; the 00:30 belongs to July
    expect(june.body.noShowCount).toBe(2);
    expect(june.body.avgAttendance).toBeCloseTo(3 / 3, 5); // 3 attended / 3 held
    expect(june.body.noShowRate).toBeCloseTo(2 / (3 + 2), 5);
    const july = await call('GET', `/api/admin/reports/monthly?month=${nextMonth}`, { token: a.token });
    expect(july.body.classesHeld).toBeGreaterThanOrEqual(1);
    expect(july.body.noShowCount).toBe(0);
    expect(july.body.noShowRate).toBe(0);
  });

  test('AC-39 empty month has zeros (no division by zero); validation; admin only', async () => {
    const a = await admin();
    const r = await call('GET', '/api/admin/reports/monthly?month=1990-01', { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ month: '1990-01', classesHeld: 0, avgAttendance: 0, noShowCount: 0, noShowRate: 0 });
    expect(r.body.cardsSold).toEqual({ SINGLE: 0, PACK_8: 0, PACK_12: 0, UNLIMITED_MONTH: 0, total: 0 });
    for (const bad of ['', 'month=2026-13', 'month=2026', 'month=abc']) {
      expect((await call('GET', `/api/admin/reports/monthly?${bad}`, { token: a.token })).status, bad).toBe(400);
    }
  });

  test('AC-39 cards sold are counted by the month the card was recorded (createdAt), not validFrom', async () => {
    const a = await admin();
    const month = sofiaParts(new Date()).date.slice(0, 7);
    const before = (await call('GET', `/api/admin/reports/monthly?month=${month}`, { token: a.token })).body.cardsSold;
    const c = await createUser('CLIENT');
    await giveCard(c.id, 'PACK_12', { validFrom: '2019-01-05' }); // old validFrom, recorded now
    await giveCard(c.id, 'UNLIMITED_MONTH');
    await giveCard(c.id, 'UNLIMITED_MONTH');
    const after = (await call('GET', `/api/admin/reports/monthly?month=${month}`, { token: a.token })).body.cardsSold;
    expect(after.PACK_12 - before.PACK_12).toBe(1);
    expect(after.UNLIMITED_MONTH - before.UNLIMITED_MONTH).toBe(2);
    expect(after.total - before.total).toBe(3);
    const old = (await call('GET', '/api/admin/reports/monthly?month=2019-01', { token: a.token })).body.cardsSold;
    expect(old.PACK_12).toBe(0);
  });
});

test('AC-38 blocking is visible in the user list and does not remove existing bookings', async () => {
  const a = await admin();
  const c = await clientWithCard();
  const s = await sess(inDays(2));
  const b = await book(c, s.id);
  await call('PATCH', `/api/admin/users/${c.id}`, { token: a.token, body: { blocked: true } });
  const list = await call('GET', `/api/admin/users?q=${encodeURIComponent(c.email)}`, { token: a.token });
  expect(list.body.items[0].blocked).toBe(true);
  const att = await call('GET', `/api/admin/sessions/${s.id}/attendees`, { token: a.token });
  expect(att.body.attendees.map((x: any) => x.bookingId)).toContain(b.body.id);
  // a blocked client may still cancel (and gets the class back)
  expect((await cancelBooking(c, b.body.id)).status).toBe(200);
});
