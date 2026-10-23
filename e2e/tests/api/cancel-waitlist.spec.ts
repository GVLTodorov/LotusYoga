import { expect, test } from '@playwright/test';
import {
  addDaysStr, admin, book, call, cancelBooking, clientWithCard, createSession, createUser, getSession, giveCard,
  inDays, inHours, inMinutes, joinWaitlist, moveSession, myCards, sofiaToday,
} from '../helpers/api';
import { expectNoMail, mailsTo, waitForMail } from '../helpers/mail';

test.beforeEach(() => { test.setTimeout(150_000); });
let instr: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => { instr = await createUser('INSTRUCTOR'); });
const sess = (startsAt: Date, capacity = 14, name?: string) => createSession({ instructorId: instr.id, startsAt, capacity, name });
const preview = (p: { token: string }, id: string) => call('GET', `/api/bookings/${id}/cancel-preview`, { token: p.token });

test.describe('AC-16 / AC-17 cancel', () => {
  test('AC-16 >= 6 h: preview says class returned; cancel returns the class', async () => {
    const c = await clientWithCard('PACK_8');
    const b = await book(c, (await sess(inDays(3))).id);
    const p = await preview(c, b.body.id);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ lateCancel: false, classReturned: true });
    expect(p.body.hoursUntilStart).toBeGreaterThan(70);
    expect((await myCards(c))[0].usedClasses).toBe(1);
    const r = await cancelBooking(c, b.body.id);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELLED');
    expect((await myCards(c))[0].usedClasses).toBe(0);
  });

  test('AC-17 < 6 h: warning in preview; cancel -> LATE_CANCELLED and class stays used', async () => {
    const c = await clientWithCard('PACK_8');
    const b = await book(c, (await sess(inHours(3))).id);
    const p = await preview(c, b.body.id);
    expect(p.body).toMatchObject({ lateCancel: true, classReturned: false });
    expect(p.body.hoursUntilStart).toBeLessThan(6);
    const r = await cancelBooking(c, b.body.id);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('LATE_CANCELLED');
    expect((await myCards(c))[0].usedClasses).toBe(1);
  });

  test('AC-17 boundary: 5h50 is late, 6h10 is not', async () => {
    const c = await clientWithCard('PACK_12');
    const late = await book(c, (await sess(inMinutes(350))).id);
    const free = await book(c, (await sess(inMinutes(370))).id);
    expect((await preview(c, late.body.id)).body.lateCancel).toBe(true);
    expect((await preview(c, free.body.id)).body.lateCancel).toBe(false);
  });

  test('AC-16 only the owner can see/cancel a booking; double cancel -> INVALID_STATE', async () => {
    const c = await clientWithCard();
    const other = await clientWithCard();
    const b = await book(c, (await sess(inDays(3))).id);
    expect((await cancelBooking(other, b.body.id)).status).toBe(404);
    expect((await preview(other, b.body.id)).status).toBe(404);
    expect((await cancelBooking(c, b.body.id)).status).toBe(200);
    const again = await cancelBooking(c, b.body.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await preview(c, b.body.id)).body.error.code).toBe('INVALID_STATE');
    expect((await myCards(c))[0].usedClasses).toBe(0); // returned only once
  });

  test('AC-19 no cancel (nor preview) after the session started', async () => {
    const c = await clientWithCard();
    const s = await sess(inHours(2));
    const b = await book(c, s.id);
    expect((await moveSession(s.id, inMinutes(-5))).status).toBe(200);
    const r = await cancelBooking(c, b.body.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SESSION_STARTED');
    expect((await preview(c, b.body.id)).body.error.code).toBe('SESSION_STARTED');
    expect((await myCards(c))[0].usedClasses).toBe(1);
  });
});

test.describe('AC-18 promoted inside the 6 h window cancels for free', () => {
  test('AC-18 promotedLate booking: preview and cancel return the class', async () => {
    const s = await sess(inHours(3), 1);
    const a = await clientWithCard();
    const b = await clientWithCard();
    const ba = await book(a, s.id);
    expect((await joinWaitlist(b, s.id)).status).toBe(201);
    expect((await cancelBooking(a, ba.body.id)).body.status).toBe('LATE_CANCELLED'); // frees the spot
    // b was promoted automatically
    const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: b.token });
    expect(up.body).toHaveLength(1);
    expect(up.body[0]).toMatchObject({ status: 'BOOKED', promotedLate: true });
    expect((await myCards(b))[0].usedClasses).toBe(1);
    const p = await preview(b, up.body[0].id);
    expect(p.body).toMatchObject({ lateCancel: false, classReturned: true });
    expect(p.body.hoursUntilStart).toBeLessThan(6);
    const r = await cancelBooking(b, up.body[0].id);
    expect(r.body.status).toBe('CANCELLED');
    expect((await myCards(b))[0].usedClasses).toBe(0);
  });

  test('AC-18 promoted far ahead of the window is a normal booking (promotedLate false)', async () => {
    const s = await sess(inDays(3), 1);
    const a = await clientWithCard();
    const b = await clientWithCard();
    const ba = await book(a, s.id);
    await joinWaitlist(b, s.id);
    await cancelBooking(a, ba.body.id);
    const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: b.token });
    expect(up.body[0].promotedLate).toBe(false);
  });
});

test.describe('AC-20 waiting list', () => {
  test('AC-20 join shows position; ordering; leave at any time (204, position shifts)', async () => {
    const s = await sess(inDays(2), 1);
    const a = await clientWithCard();
    const w1 = await clientWithCard();
    const w2 = await clientWithCard();
    await book(a, s.id);
    const e1 = await joinWaitlist(w1, s.id);
    const e2 = await joinWaitlist(w2, s.id);
    expect(e1.status).toBe(201);
    expect(e1.body).toMatchObject({ status: 'WAITING', position: 1 });
    expect(e2.body).toMatchObject({ status: 'WAITING', position: 2 });
    expect((await getSession(s.id)).waitlistCount).toBe(2);
    const mine = await call('GET', '/api/me/waitlist', { token: w2.token });
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].position).toBe(2);
    expect((await call('DELETE', `/api/waitlist/${e1.body.id}`, { token: w2.token })).status).toBe(404); // not yours
    expect((await call('DELETE', `/api/waitlist/${e1.body.id}`, { token: w1.token })).status).toBe(204);
    const after = await call('GET', '/api/me/waitlist', { token: w2.token });
    expect(after.body[0].position).toBe(1);
    expect((await call('GET', '/api/me/waitlist', { token: w1.token })).body).toHaveLength(0);
  });

  test('AC-20 errors: SESSION_NOT_FULL, ALREADY_ON_WAITLIST, ALREADY_BOOKED, NO_VALID_CARD, BOOKING_CLOSED, BOOKING_NOT_OPEN, SESSION_CANCELLED', async () => {
    const full = await sess(inDays(2), 1);
    const a = await clientWithCard();
    const b = await clientWithCard();
    const nocard = await createUser('CLIENT');
    await book(a, full.id);
    const open = await sess(inDays(2));
    const nf = await joinWaitlist(b, open.id);
    expect(nf.status).toBe(409);
    expect(nf.body.error.code).toBe('SESSION_NOT_FULL');
    const ab = await joinWaitlist(a, full.id);
    expect(ab.body.error.code).toBe('ALREADY_BOOKED');
    expect((await joinWaitlist(b, full.id)).status).toBe(201);
    expect((await joinWaitlist(b, full.id)).body.error.code).toBe('ALREADY_ON_WAITLIST');
    expect((await joinWaitlist(nocard, full.id)).body.error.code).toBe('NO_VALID_CARD');

    const closed = await sess(inMinutes(20), 1);
    const notOpen = await sess(inDays(20), 1);
    expect((await joinWaitlist(b, closed.id)).body.error.code).toBe('BOOKING_CLOSED');
    expect((await joinWaitlist(b, notOpen.id)).body.error.code).toBe('BOOKING_NOT_OPEN');
    const cancelled = await sess(inDays(2), 1);
    await call('POST', `/api/admin/sessions/${cancelled.id}/cancel`, { token: (await admin()).token, body: {} });
    expect((await joinWaitlist(b, cancelled.id)).body.error.code).toBe('SESSION_CANCELLED');
  });
});

test.describe('AC-21 automatic promotion', () => {
  test('AC-21 first waiting client WITH a valid card is booked; clients without card are skipped; email in recipient language', async () => {
    const name = `Promo ${Date.now()}`;
    const s = await sess(inDays(2), 1, name);
    const a = await clientWithCard();
    const skipped = await clientWithCard('SINGLE', { lang: 'en' });
    const winner = await clientWithCard('PACK_8', { lang: 'bg' });
    const later = await clientWithCard();
    const ba = await book(a, s.id);
    await joinWaitlist(skipped, s.id);
    await joinWaitlist(winner, s.id);
    await joinWaitlist(later, s.id);
    // `skipped` loses the validity of their card while waiting
    const adm = await admin();
    const sc = (await myCards(skipped))[0];
    await call('PATCH', `/api/admin/cards/${sc.id}`, { token: adm.token, body: { expiresAt: addDaysStr(sofiaToday(), -1), note: 'expired while waiting' } });

    expect((await cancelBooking(a, ba.body.id)).status).toBe(200);

    const wb = await call('GET', '/api/me/bookings?scope=upcoming', { token: winner.token });
    expect(wb.body).toHaveLength(1);
    expect(wb.body[0].status).toBe('BOOKED');
    expect((await myCards(winner))[0].usedClasses).toBe(1);
    // skipped client keeps waiting (position 1), later client untouched and still waiting
    expect((await call('GET', '/api/me/bookings?scope=upcoming', { token: skipped.token })).body).toHaveLength(0);
    expect((await call('GET', '/api/me/waitlist', { token: skipped.token })).body).toHaveLength(1);
    expect((await call('GET', '/api/me/waitlist', { token: later.token })).body).toHaveLength(1);
    expect((await call('GET', '/api/me/waitlist', { token: winner.token })).body).toHaveLength(0);
    expect((await getSession(s.id))).toMatchObject({ bookedCount: 1, freeSpots: 0, waitlistCount: 2 });

    const mail = await waitForMail(winner.email, /Освободи се място/);
    expect(mail.Subject).toContain(name);
    await expectNoMail(skipped.email, /spot|място/i);
  });

  test('AC-21 admin capacity increase promotes waiting clients', async () => {
    const s = await sess(inDays(2), 1);
    const a = await clientWithCard();
    const w1 = await clientWithCard();
    const w2 = await clientWithCard();
    await book(a, s.id);
    await joinWaitlist(w1, s.id);
    await joinWaitlist(w2, s.id);
    const r = await call('PATCH', `/api/admin/sessions/${s.id}`, { token: (await admin()).token, body: { capacity: 2 } });
    expect(r.status).toBe(200);
    expect((await call('GET', '/api/me/bookings?scope=upcoming', { token: w1.token })).body).toHaveLength(1);
    expect((await call('GET', '/api/me/bookings?scope=upcoming', { token: w2.token })).body).toHaveLength(0);
    expect((await getSession(s.id))).toMatchObject({ bookedCount: 2, waitlistCount: 1 });
  });

  test('AC-21 promotion also works < 6 h before start, English email "You got a spot"', async () => {
    const name = `Late promo ${Date.now()}`;
    const s = await sess(inHours(2), 1, name);
    const a = await clientWithCard();
    const b = await clientWithCard('PACK_8', { lang: 'en' });
    const ba = await book(a, s.id);
    await joinWaitlist(b, s.id);
    await cancelBooking(a, ba.body.id);
    expect((await call('GET', '/api/me/bookings?scope=upcoming', { token: b.token })).body).toHaveLength(1);
    const mail = await waitForMail(b.email, /You got a spot/);
    expect(mail.Subject).toBe(`You got a spot: ${name}`);
    expect(mail.Text).toContain(name);
  });
});

test('AC-22 waiting entries expire once booking has closed', async () => {
  const s = await sess(inMinutes(45), 1);
  const a = await clientWithCard();
  const b = await clientWithCard();
  await book(a, s.id);
  await joinWaitlist(b, s.id);
  expect((await call('GET', '/api/me/waitlist', { token: b.token })).body).toHaveLength(1);
  await moveSession(s.id, inMinutes(20)); // booking closes (30 min before) -> now closed
  // expiry job runs every minute
  await expect
    .poll(async () => (await call('GET', '/api/me/waitlist', { token: b.token })).body.length, { timeout: 100_000, intervals: [2000] })
    .toBe(0);
  const mails = await mailsTo(b.email);
  expect(mails.filter((m) => /spot|място/i.test(m.Subject))).toHaveLength(0);
  // can't join any more either
  const c = await clientWithCard();
  expect((await joinWaitlist(c, s.id)).body.error.code).toBe('BOOKING_CLOSED');
});

test('AC-32 admin cancel: classes returned, waitlist cleared, session CANCELLED, email', async () => {
  const name = `Holiday ${Date.now()}`;
  const s = await sess(inDays(2), 1, name);
  const a = await clientWithCard('PACK_8', { lang: 'en' });
  const w = await clientWithCard();
  await book(a, s.id);
  await joinWaitlist(w, s.id);
  expect((await myCards(a))[0].usedClasses).toBe(1);
  const adm = await admin();
  const r = await call('POST', `/api/admin/sessions/${s.id}/cancel`, { token: adm.token, body: { reason: 'Public holiday' } });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('CANCELLED');
  expect((await myCards(a))[0].usedClasses).toBe(0);
  const past = await call('GET', '/api/me/bookings?scope=past', { token: a.token });
  expect(past.body.find((b: any) => b.session.id === s.id).status).toBe('CLASS_CANCELLED');
  expect((await call('GET', '/api/me/waitlist', { token: w.token })).body).toHaveLength(0);
  const again = await call('POST', `/api/admin/sessions/${s.id}/cancel`, { token: adm.token, body: {} });
  expect(again.status).toBe(409);
  expect(again.body.error.code).toBe('SESSION_CANCELLED');
  const mail = await waitForMail(a.email, /Class cancelled/);
  expect(mail.Subject).toBe(`Class cancelled: ${name}`);
  expect(mail.Text).toContain('Public holiday');
});

test('AC-32 cannot cancel a session that already started', async () => {
  const s = await sess(inMinutes(-20));
  const r = await call('POST', `/api/admin/sessions/${s.id}/cancel`, { token: (await admin()).token, body: {} });
  expect(r.status).toBe(409);
  expect(r.body.error.code).toBe('SESSION_STARTED');
});

test('AC-40 booking confirmation e-mail in the client language (bg and en)', async () => {
  const nameBg = `Потвърди ${Date.now()}`;
  const bg = await clientWithCard('PACK_8', { lang: 'bg' });
  const en = await clientWithCard('PACK_8', { lang: 'en' });
  const s = await sess(inDays(2), 14, nameBg);
  await book(bg, s.id);
  await book(en, s.id);
  const m1 = await waitForMail(bg.email, /Потвърдена резервация/);
  expect(m1.Subject).toBe(`Потвърдена резервация: ${nameBg}`);
  const m2 = await waitForMail(en.email, /Booking confirmed/);
  expect(m2.Subject).toBe(`Booking confirmed: ${nameBg}`);
  // card was not charged twice and a user with no email language change keeps their language
  expect((await myCards(bg))[0].usedClasses).toBe(1);
  void giveCard;
});
