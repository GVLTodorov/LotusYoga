import { expect, test } from '@playwright/test';
import {
  admin, book, call, clientWithCard, createSession, createUser, inHours, inMinutes, moveSession, myCards, sofiaParts,
} from '../helpers/api';

let instr: Awaited<ReturnType<typeof createUser>>;
let otherInstr: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => {
  instr = await createUser('INSTRUCTOR');
  otherInstr = await createUser('INSTRUCTOR');
});
const sess = (startsAt: Date, capacity = 14, who = instr) => createSession({ instructorId: who.id, startsAt, capacity });
const day = (d: Date) => sofiaParts(d).date;

test.describe('AC-25 instructor Today', () => {
  test('AC-25 shows own sessions with booked names and phones, sorted by name; other date selectable', async () => {
    const when = inHours(5);
    const mine = await sess(when);
    const theirs = await sess(when, 14, otherInstr);
    const z = await clientWithCard('PACK_8', { name: 'Zora Zlateva' });
    const a = await clientWithCard('PACK_8', { name: 'Anna Aleksandrova' });
    await book(z, mine.id);
    await book(a, mine.id);
    const r = await call('GET', `/api/instructor/sessions?date=${day(when)}`, { token: instr.token });
    expect(r.status).toBe(200);
    const ids = r.body.map((x: any) => x.session.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const row = r.body.find((x: any) => x.session.id === mine.id);
    expect(row.attendees.map((x: any) => x.name)).toEqual(['Anna Aleksandrova', 'Zora Zlateva']);
    expect(row.attendees[0]).toMatchObject({ phone: a.phone, status: 'BOOKED', walkIn: false });
    const other = await call('GET', `/api/instructor/sessions?date=2020-01-01`, { token: instr.token });
    expect(other.body).toEqual([]);
    // default date = today (Sofia): call works without param
    expect((await call('GET', '/api/instructor/sessions', { token: instr.token })).status).toBe(200);
  });

  test('AC-25 admin sees all sessions; cancelled ones are not listed; clients are refused', async () => {
    const when = inHours(5);
    const s1 = await sess(when);
    const s2 = await sess(when, 14, otherInstr);
    const s3 = await sess(when);
    await call('POST', `/api/admin/sessions/${s3.id}/cancel`, { token: (await admin()).token, body: {} });
    const r = await call('GET', `/api/instructor/sessions?date=${day(when)}`, { token: (await admin()).token });
    const ids = r.body.map((x: any) => x.session.id);
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id]));
    expect(ids).not.toContain(s3.id);
    const c = await clientWithCard();
    expect((await call('GET', `/api/instructor/sessions?date=${day(when)}`, { token: c.token })).status).toBe(403);
    expect((await call('GET', '/api/instructor/sessions?date=bad', { token: instr.token })).status).toBe(400);
  });
});

test.describe('AC-26 attendance', () => {
  test('AC-26 allowed once the class starts within 30 min; can be changed; saved', async () => {
    const s = await sess(inHours(2));
    const c = await clientWithCard();
    const b = await book(c, s.id);
    // too early (2 h before)
    const early = await call('PATCH', `/api/bookings/${b.body.id}/attendance`, { token: instr.token, body: { status: 'ATTENDED' } });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ATTENDANCE_WINDOW');
    await moveSession(s.id, inMinutes(20));
    const ok = await call('PATCH', `/api/bookings/${b.body.id}/attendance`, { token: instr.token, body: { status: 'ATTENDED' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ bookingId: b.body.id, status: 'ATTENDED', userId: c.id });
    const change = await call('PATCH', `/api/bookings/${b.body.id}/attendance`, { token: instr.token, body: { status: 'NO_SHOW' } });
    expect(change.body.status).toBe('NO_SHOW');
    const list = await call('GET', `/api/instructor/sessions?date=${day(inMinutes(20))}`, { token: instr.token });
    expect(list.body.find((x: any) => x.session.id === s.id).attendees[0].status).toBe('NO_SHOW');
    // no-show keeps the class used
    expect((await myCards(c))[0].usedClasses).toBe(1);
    const hist = await call('GET', '/api/me/bookings?scope=upcoming', { token: c.token });
    expect(hist.status).toBe(200);
  });

  test('AC-26 window ends 24 h after start', async () => {
    const s = await sess(inHours(2));
    const c = await clientWithCard();
    const b = await book(c, s.id);
    await moveSession(s.id, inHours(-23));
    expect((await call('PATCH', `/api/bookings/${b.body.id}/attendance`, { token: instr.token, body: { status: 'ATTENDED' } })).status).toBe(200);
    await moveSession(s.id, inHours(-25));
    const late = await call('PATCH', `/api/bookings/${b.body.id}/attendance`, { token: instr.token, body: { status: 'NO_SHOW' } });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ATTENDANCE_WINDOW');
  });

  test('AC-26 an instructor cannot mark sessions they do not teach; clients cannot; admin can; bad status / non-active booking rejected', async () => {
    const s = await sess(inHours(2));
    const c = await clientWithCard();
    const b = await book(c, s.id);
    await moveSession(s.id, inMinutes(10));
    const url = `/api/bookings/${b.body.id}/attendance`;
    expect((await call('PATCH', url, { token: otherInstr.token, body: { status: 'ATTENDED' } })).status).toBe(403);
    expect((await call('PATCH', url, { token: c.token, body: { status: 'ATTENDED' } })).status).toBe(403);
    expect((await call('PATCH', url, { body: { status: 'ATTENDED' } })).status).toBe(401);
    expect((await call('PATCH', url, { token: instr.token, body: { status: 'BOOKED' } })).status).toBe(400);
    expect((await call('PATCH', url, { token: (await admin()).token, body: { status: 'ATTENDED' } })).status).toBe(200);
    expect((await call('PATCH', '/api/bookings/nope/attendance', { token: instr.token, body: { status: 'ATTENDED' } })).status).toBe(404);

    const s2 = await sess(inHours(2));
    const c2 = await clientWithCard();
    const b2 = await book(c2, s2.id);
    await call('POST', `/api/bookings/${b2.body.id}/cancel`, { token: c2.token });
    await moveSession(s2.id, inMinutes(10));
    const inactive = await call('PATCH', `/api/bookings/${b2.body.id}/attendance`, { token: instr.token, body: { status: 'ATTENDED' } });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe('INVALID_STATE');
  });
});

test.describe('AC-27 walk-ins', () => {
  test('AC-27 search needs >= 2 chars, matches name/phone/email, only clients with hasValidCard flag', async () => {
    const withCard = await clientWithCard('PACK_8', { name: 'Walkin Zeta Kirilova' });
    const noCard = await createUser('CLIENT', { name: 'Walkin Zeta Nocard' });
    const one = await call('GET', '/api/instructor/clients?q=W', { token: instr.token });
    expect(one.status).toBe(400);
    const byName = await call('GET', '/api/instructor/clients?q=Walkin%20Zeta', { token: instr.token });
    expect(byName.status).toBe(200);
    const m = Object.fromEntries(byName.body.map((x: any) => [x.id, x]));
    expect(m[withCard.id]).toMatchObject({ name: 'Walkin Zeta Kirilova', phone: withCard.phone, hasValidCard: true });
    expect(m[noCard.id].hasValidCard).toBe(false);
    expect(byName.body.length).toBeLessThanOrEqual(20);
    const byEmail = await call('GET', `/api/instructor/clients?q=${encodeURIComponent(withCard.email)}`, { token: instr.token });
    expect(byEmail.body.map((x: any) => x.id)).toEqual([withCard.id]);
    const byPhone = await call('GET', `/api/instructor/clients?q=${encodeURIComponent(withCard.phone.slice(-6))}`, { token: instr.token });
    expect(byPhone.body.map((x: any) => x.id)).toContain(withCard.id);
    const staff = await call('GET', `/api/instructor/clients?q=${encodeURIComponent(otherInstr.email)}`, { token: instr.token });
    expect(staff.body).toEqual([]); // CLIENT role only
  });

  test('AC-27 walk-in creates an ATTENDED walk-in booking and takes a class; booking window does not apply', async () => {
    const s = await sess(inMinutes(10)); // booking is already closed
    const c = await clientWithCard('PACK_8');
    expect((await book(c, s.id)).body.error.code).toBe('BOOKING_CLOSED');
    const r = await call('POST', `/api/sessions/${s.id}/walk-ins`, { token: instr.token, body: { userId: c.id } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'ATTENDED', walkIn: true, userId: c.id, name: c.name });
    expect((await myCards(c))[0].usedClasses).toBe(1);
    const again = await call('POST', `/api/sessions/${s.id}/walk-ins`, { token: instr.token, body: { userId: c.id } });
    expect(again.body.error.code).toBe('ALREADY_BOOKED');
    const list = await call('GET', `/api/instructor/sessions?date=${day(inMinutes(10))}`, { token: instr.token });
    const att = list.body.find((x: any) => x.session.id === s.id).attendees;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ walkIn: true, status: 'ATTENDED' });
  });

  test('AC-27 NO_VALID_CARD, SESSION_FULL, USER_BLOCKED, permissions, not-in-window', async () => {
    const s = await sess(inMinutes(10), 1);
    const nocard = await createUser('CLIENT');
    const r1 = await call('POST', `/api/sessions/${s.id}/walk-ins`, { token: instr.token, body: { userId: nocard.id } });
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('NO_VALID_CARD');
    const a = await clientWithCard();
    const b = await clientWithCard();
    expect((await call('POST', `/api/sessions/${s.id}/walk-ins`, { token: instr.token, body: { userId: a.id } })).status).toBe(201);
    const full = await call('POST', `/api/sessions/${s.id}/walk-ins`, { token: instr.token, body: { userId: b.id } });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SESSION_FULL');
    expect((await myCards(b))[0].usedClasses).toBe(0);

    const s2 = await sess(inMinutes(10));
    const blocked = await clientWithCard();
    await call('PATCH', `/api/admin/users/${blocked.id}`, { token: (await admin()).token, body: { blocked: true } });
    const rb = await call('POST', `/api/sessions/${s2.id}/walk-ins`, { token: instr.token, body: { userId: blocked.id } });
    expect(rb.status).toBe(403);
    expect(rb.body.error.code).toBe('USER_BLOCKED');
    expect((await call('POST', `/api/sessions/${s2.id}/walk-ins`, { token: otherInstr.token, body: { userId: b.id } })).status).toBe(403);
    expect((await call('POST', `/api/sessions/${s2.id}/walk-ins`, { token: b.token, body: { userId: b.id } })).status).toBe(403);
    expect((await call('POST', `/api/sessions/${s2.id}/walk-ins`, { token: instr.token, body: { userId: 'nope' } })).status).toBe(404);
    const far = await sess(inHours(30));
    const early = await call('POST', `/api/sessions/${far.id}/walk-ins`, { token: instr.token, body: { userId: b.id } });
    expect(early.body.error.code).toBe('ATTENDANCE_WINDOW');
    const ok = await call('POST', `/api/sessions/${s2.id}/walk-ins`, { token: (await admin()).token, body: { userId: b.id } });
    expect(ok.status).toBe(201); // admins may add walk-ins to any session
  });
});
