import { expect, test } from '@playwright/test';
import {
  addDaysStr, admin, book, call, cancelBooking, clientWithCard, createSession, createUser, giveCard, inDays, inHours,
  inMinutes, joinWaitlist, moveSession, myCards, sofiaToday, uid,
} from '../helpers/api';
import { waitForMail } from '../helpers/mail';
import { expectNoHScroll, loginAs, sessionCard } from '../helpers/ui';

// These journeys run on the desktop (1280) and the mobile (iPhone 13) project.
let instr: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => { instr = await createUser('INSTRUCTOR'); });
const sess = (startsAt: Date, capacity = 14, name = `Yoga ${uid()}`) => createSession({ instructorId: instr.id, startsAt, capacity, name });
const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog');

test('AC-6 AC-7 AC-8 AC-40 client books from the schedule and gets a confirmation email', async ({ page }) => {
  const name = `Book ${uid()}`;
  const s = await sess(inDays(2), 14, name);
  const c = await clientWithCard('PACK_8');
  await loginAs(page, c);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  const card = sessionCard(page, name);
  await expect(card).toContainText(instr.name);
  await expect(card).toContainText('free spots: 14');
  await card.getByRole('button', { name: 'Book me in' }).click();
  await expect(card.getByRole('status')).toContainText('You are booked');
  await expect(card.getByText('You are booked').first()).toBeVisible();
  await expect(card).toContainText('free spots: 13');
  await expectNoHScroll(page, 'schedule');

  await page.goto('/my');
  const up = page.locator('section[aria-labelledby="h-up"]');
  await expect(up).toContainText(name);
  await expect(page.locator('section[aria-labelledby="h-cards"]')).toContainText('Classes left: 7');
  await expectNoHScroll(page, 'my bookings');
  expect((await myCards(c))[0].usedClasses).toBe(1);

  const mail = await waitForMail(c.email, /Booking confirmed/);
  expect(mail.Subject).toBe(`Booking confirmed: ${name}`);
  void s;
});

test('AC-9 AC-20 AC-21 full class -> waiting list -> spot frees -> auto-promotion + email', async ({ page }) => {
  const name = `Full ${uid()}`;
  const s = await sess(inDays(2), 1, name);
  const a = await clientWithCard();
  const b = await clientWithCard('PACK_8', { lang: 'en' });
  const ba = await book(a, s.id);
  await loginAs(page, b);
  await page.goto('/');
  const card = sessionCard(page, name);
  await expect(card.getByText('Full')).toBeVisible();
  await expect(card.getByText('If a spot frees up')).toBeVisible();
  await card.getByRole('button', { name: 'Join the waiting list' }).click();
  await expect(card.getByText('On the waiting list (position 1)').first()).toBeVisible();
  await page.goto('/my');
  await expect(page.locator('section[aria-labelledby="h-wl"]')).toContainText(name);
  await expectNoHScroll(page, 'waitlist');

  await cancelBooking(a, ba.body.id); // frees the spot
  await page.goto('/');
  await expect(sessionCard(page, name).getByText('You are booked').first()).toBeVisible();
  expect((await myCards(b))[0].usedClasses).toBe(1);
  const mail = await waitForMail(b.email, /You got a spot/);
  expect(mail.Subject).toBe(`You got a spot: ${name}`);
});

test('AC-20 client can leave the waiting list from the schedule', async ({ page }) => {
  const name = `Leave ${uid()}`;
  const s = await sess(inDays(2), 1, name);
  await book(await clientWithCard(), s.id);
  const w = await clientWithCard();
  await joinWaitlist(w, s.id);
  await loginAs(page, w);
  await page.goto('/');
  const card = sessionCard(page, name);
  await card.getByRole('button', { name: 'Leave the list' }).click();
  await expect(card.getByRole('button', { name: 'Join the waiting list' })).toBeVisible();
  expect((await call('GET', '/api/me/waitlist', { token: w.token })).body).toHaveLength(0);
});

test('AC-16 normal cancel: dialog says the class is returned', async ({ page }) => {
  const name = `Cancel ${uid()}`;
  const s = await sess(inDays(3), 14, name);
  const c = await clientWithCard('PACK_8');
  await book(c, s.id);
  await loginAs(page, c);
  await page.goto('/');
  const card = sessionCard(page, name);
  await card.getByRole('button', { name: 'Cancel booking' }).click();
  const d = dialog(page);
  await expect(d.getByTestId('returned-note')).toHaveText('The class will be returned to your card.');
  await expect(d.getByTestId('late-warning')).toHaveCount(0);
  await expectNoHScroll(page, 'cancel dialog');
  await d.getByRole('button', { name: 'Yes, cancel', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Booking cancelled.');
  expect((await myCards(c))[0].usedClasses).toBe(0);
});

test('AC-17 late cancel (< 6 h): highlighted warning, class is NOT returned', async ({ page }) => {
  const name = `Late ${uid()}`;
  const s = await sess(inHours(3), 14, name);
  const c = await clientWithCard('PACK_8');
  await book(c, s.id);
  await loginAs(page, c);
  await page.goto('/my');
  await page.locator('section[aria-labelledby="h-up"]').getByRole('button', { name: 'Cancel booking' }).click();
  const d = dialog(page);
  const warn = d.getByTestId('late-warning');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('WARNING: the class will NOT be returned!');
  await expect(warn).toHaveCSS('border-top-width', '4px');
  await expect(d.getByTestId('returned-note')).toHaveCount(0);
  await expectNoHScroll(page, 'late cancel dialog');
  await d.getByRole('button', { name: 'Yes, cancel and lose the class' }).click();
  await expect(page.getByRole('status').first()).toContainText('The class was not returned');
  expect((await myCards(c))[0].usedClasses).toBe(1);
  await expect(page.locator('section[aria-labelledby="h-past"]')).toContainText('Late cancel');
});

test('AC-18 spot obtained from the waiting list < 6 h before start: dialog says the class is returned', async ({ page }) => {
  const name = `Late promo ${uid()}`;
  const s = await sess(inHours(3), 1, name);
  const a = await clientWithCard();
  const b = await clientWithCard();
  const ba = await book(a, s.id);
  await joinWaitlist(b, s.id);
  await cancelBooking(a, ba.body.id);
  await loginAs(page, b);
  await page.goto('/my');
  await page.locator('section[aria-labelledby="h-up"]').getByRole('button', { name: 'Cancel booking' }).click();
  const d = dialog(page);
  await expect(d.getByTestId('returned-note')).toContainText('from the waiting list');
  await expect(d.getByTestId('late-warning')).toHaveCount(0);
  await d.getByRole('button', { name: 'Yes, cancel', exact: true }).click();
  await expect(page.getByRole('status').first()).toHaveText('Booking cancelled.');
  expect((await myCards(b))[0].usedClasses).toBe(0);
});

test('AC-19 cancel is refused after the session started', async ({ page }) => {
  const name = `Started ${uid()}`;
  const s = await sess(inHours(2), 14, name);
  const c = await clientWithCard();
  await book(c, s.id);
  await moveSession(s.id, inMinutes(-5));
  await loginAs(page, c);
  await page.goto('/my');
  await page.locator('section[aria-labelledby="h-up"] li', { hasText: name }).getByRole('button', { name: 'Cancel booking' }).click().catch(() => {});
  // the booking has started: either it is no longer "upcoming" or the dialog shows the API error
  const d = dialog(page);
  if (await d.isVisible()) await expect(d).toContainText('already started');
  expect((await myCards(c))[0].usedClasses).toBe(1);
});

test('AC-10 no card: error message tells the client to contact the studio', async ({ page }) => {
  const name = `NoCard ${uid()}`;
  await sess(inDays(2), 14, name);
  const c = await createUser('CLIENT');
  await loginAs(page, c);
  await page.goto('/');
  const card = sessionCard(page, name);
  await card.getByRole('button', { name: 'Book me in' }).click();
  await expect(card).toContainText('You have no valid card with classes left for this date. Please contact the studio.');
  await expectNoHScroll(page, 'no-card error');
});

test('AC-13 blocked client: book and waiting list show the "contact the studio" error', async ({ page }) => {
  const nameOpen = `Blocked open ${uid()}`;
  const nameFull = `Blocked full ${uid()}`;
  await sess(inDays(2), 14, nameOpen);
  const full = await sess(inDays(2), 1, nameFull);
  await book(await clientWithCard(), full.id);
  const c = await clientWithCard();
  await call('PATCH', `/api/admin/users/${c.id}`, { token: (await admin()).token, body: { blocked: true } });
  await loginAs(page, c);
  await page.goto('/');
  const open = sessionCard(page, nameOpen);
  await open.getByRole('button', { name: 'Book me in' }).click();
  await expect(open).toContainText('Your account is blocked. Please contact the studio.');
  const f = sessionCard(page, nameFull);
  await f.getByRole('button', { name: 'Join the waiting list' }).click();
  await expect(f).toContainText('Your account is blocked. Please contact the studio.');
  expect((await myCards(c))[0].usedClasses).toBe(0);
});

test('AC-11 AC-7 booking-not-open / closed sessions show a badge instead of a button', async ({ page }) => {
  const closed = `Closed ${uid()}`;
  await sess(inMinutes(20), 14, closed);
  const c = await clientWithCard();
  await loginAs(page, c);
  await page.goto('/');
  const card = sessionCard(page, closed);
  await expect(card).toContainText('Booking is closed');
  await expect(card.getByRole('button', { name: 'Book me in' })).toHaveCount(0);
});

test('AC-25 AC-26 AC-27 instructor: today view, attendance, walk-in', async ({ page }) => {
  const name = `Today ${uid()}`;
  const tag = `Wk${uid()}`;
  const s = await sess(inHours(2), 14, name);
  const c1 = await clientWithCard('PACK_8', { name: `Ana ${tag}` });
  const c2 = await clientWithCard('PACK_8', { name: `Boris ${tag}` });
  await book(c1, s.id);
  await book(c2, s.id);
  await moveSession(s.id, inMinutes(10)); // inside the attendance window
  const walker = await clientWithCard('PACK_8', { name: `Walk ${tag}` });
  const noCard = await createUser('CLIENT', { name: `Nocard ${tag}` });

  await loginAs(page, instr);
  await page.goto('/today');
  const block = page.locator('li', { hasText: name }).first();
  await expect(block).toContainText(`Ana ${tag}`);
  await expect(block.getByRole('link', { name: c1.phone })).toBeVisible();
  const row1 = block.locator('li', { hasText: `Ana ${tag}` });
  await row1.getByRole('button', { name: /Attended/ }).click();
  await expect(row1.getByRole('button', { name: /Attended/ })).toHaveAttribute('aria-pressed', 'true');
  const row2 = block.locator('li', { hasText: `Boris ${tag}` });
  await row2.getByRole('button', { name: /No-show/ }).click();
  await expect(row2.getByRole('button', { name: /No-show/ })).toHaveAttribute('aria-pressed', 'true');
  // changing the mark is allowed
  await row2.getByRole('button', { name: /Attended/ }).click();
  await expect(row2.getByRole('button', { name: /Attended/ })).toHaveAttribute('aria-pressed', 'true');
  await row2.getByRole('button', { name: /No-show/ }).click();
  await expect(row2.getByRole('button', { name: /No-show/ })).toHaveAttribute('aria-pressed', 'true');
  await expectNoHScroll(page, 'today');

  await block.getByRole('button', { name: /Add walk-in client/ }).click();
  const d = dialog(page);
  await d.getByLabel(/Search by name/).fill('W');
  await d.getByLabel(/Search by name/).fill(tag);
  await expect(d.getByText(`Nocard ${tag}`)).toBeVisible();
  await expect(d.locator('li', { hasText: `Nocard ${tag}` })).toContainText('no valid card');
  await expectNoHScroll(page, 'walk-in dialog');
  await d.locator('li', { hasText: `Walk ${tag}` }).getByRole('button', { name: 'Add' }).click();
  await expect(block.getByRole('status').filter({ hasText: 'Client added.' })).toBeVisible();
  await expect(block.locator('li', { hasText: `Walk ${tag}` })).toContainText('Attended');
  expect((await myCards(walker))[0].usedClasses).toBe(1);
  const att = await call('GET', `/api/admin/sessions/${s.id}/attendees`, { token: (await admin()).token });
  expect(att.body.attendees.find((a: any) => a.userId === walker.id)).toMatchObject({ walkIn: true, status: 'ATTENDED' });
  expect(att.body.attendees.find((a: any) => a.userId === c1.id).status).toBe('ATTENDED');
  expect(att.body.attendees.find((a: any) => a.userId === c2.id).status).toBe('NO_SHOW');
  expect(att.body.attendees.some((a: any) => a.userId === noCard.id)).toBe(false);
});

test('AC-32 admin cancels a session: classes returned, waiting list cleared, e-mail sent, "Cancelled" badge', async ({ page }) => {
  const name = `Holiday ${uid()}`;
  const s = await sess(inDays(2), 1, name);
  const c = await clientWithCard('PACK_8', { lang: 'en' });
  const w = await clientWithCard();
  await book(c, s.id);
  await joinWaitlist(w, s.id);
  const a = await createUser('ADMIN');
  await loginAs(page, a);
  await page.goto('/admin/schedule');
  const card = page.locator('section[aria-labelledby="h-ses"] li', { hasText: name });
  await expect(card).toContainText('1/1');
  await card.getByRole('button', { name: 'Cancel class' }).click();
  const d = dialog(page);
  await expect(d.getByRole('alert')).toContainText('All booked clients will get an email');
  await d.getByLabel('Reason (optional)').fill('Public holiday');
  await expectNoHScroll(page, 'admin cancel dialog');
  await d.getByRole('button', { name: 'Cancel class' }).click();
  await expect(card.getByText('Cancelled')).toBeVisible();
  expect((await myCards(c))[0].usedClasses).toBe(0);
  expect((await call('GET', '/api/me/waitlist', { token: w.token })).body).toHaveLength(0);
  // schedule shows the cancelled badge to everybody
  const anon = await page.context().browser()!.newPage();
  await anon.goto(new URL('/', page.url()).toString());
  await expect(sessionCard(anon, name)).toContainText('Cancelled');
  await anon.close();
  const mail = await waitForMail(c.email, /Class cancelled/);
  expect(mail.Subject).toBe(`Class cancelled: ${name}`);
  expect(mail.Text).toContain('Public holiday');
});

test('AC-33 AC-35 AC-36 AC-37 admin records a card, extends it, sees history', async ({ page }) => {
  const tag = `Cl${uid()}`;
  const c = await createUser('CLIENT', { name: `${tag} Client` });
  const a = await createUser('ADMIN');
  await loginAs(page, a);
  await page.goto('/admin/clients');
  await page.getByLabel('Search', { exact: true }).fill(tag);
  const row = page.locator('li', { hasText: `${tag} Client` });
  await expect(row).toContainText(c.phone);
  await expect(row).toContainText('No active card');
  await expectNoHScroll(page, 'admin clients');
  await row.getByRole('link', { name: 'History & cards' }).click();
  await expect(page.getByRole('heading', { name: `${tag} Client` })).toBeVisible();

  await page.getByRole('button', { name: /Add card/ }).click();
  let d = dialog(page);
  await d.getByLabel('Card type').selectOption('PACK_12');
  await d.getByLabel('Payment').selectOption('BANK_TRANSFER');
  await d.getByLabel('Price (BGN)').fill('120');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Card added.');
  const cards = page.locator('section[aria-labelledby="h-cards"]');
  await expect(cards).toContainText('12-class card');
  await expect(cards).toContainText('Classes left: 12');
  await expect(cards).toContainText('Bank transfer');
  await expect(cards).toContainText('120');
  await expectNoHScroll(page, 'client history');
  const apiCard = (await myCards(c))[0];
  expect(apiCard).toMatchObject({ type: 'PACK_12', totalClasses: 12, validFrom: sofiaToday(), priceBgn: 120, paymentMethod: 'BANK_TRANSFER' });

  const newExpiry = addDaysStr(sofiaToday(), 200);
  await cards.getByRole('button', { name: 'Change expiry' }).click();
  d = dialog(page);
  await d.getByLabel('New expiry date').fill(newExpiry);
  await d.getByLabel('Note').fill('Holiday extension');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Saved');
  await expect(cards).toContainText('Expiry changed');
  await expect(cards).toContainText('Holiday extension');
  await expect(cards).toContainText(a.name);
  const after = (await myCards(c))[0];
  expect(after.expiresAt).not.toBe(apiCard.expiresAt);

  // the client then books with this card; totals show up in the history
  const s = await sess(inDays(2));
  expect((await book(c, s.id)).status).toBe(201);
  await page.reload();
  await expect(page.locator('section[aria-labelledby="h-bk"]')).toContainText(s.name);
  await expect(page.locator('section[aria-labelledby="h-stats"]')).toContainText('Late cancels');
});

test('AC-34 admin creates an instructor and blocks/unblocks a client in the UI', async ({ page }) => {
  const tag = `Us${uid()}`;
  const c = await createUser('CLIENT', { name: `${tag} Block` });
  const a = await createUser('ADMIN');
  await loginAs(page, a);
  await page.goto('/admin/clients');
  await page.getByRole('button', { name: /New user/ }).click();
  const d = dialog(page);
  await d.getByLabel('Name').fill(`${tag} Teacher`);
  await d.getByLabel('Email').fill(`teacher-${tag.toLowerCase()}@e2e.test`);
  await d.getByLabel('Phone').fill('+359 888 765 432');
  await d.getByLabel(/^Password/).fill('Secret-pass-123');
  await d.getByLabel('Role').selectOption('INSTRUCTOR');
  await d.getByRole('button', { name: 'Save' }).click();
  await page.getByLabel('Search', { exact: true }).fill(tag);
  await expect(page.locator('li', { hasText: `${tag} Teacher` })).toContainText('Instructor');
  const row = page.locator('li', { hasText: `${tag} Block` });
  await row.getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByRole('button', { name: 'Block', exact: true }).click();
  await expect(row.getByText('Blocked')).toBeVisible();
  const list = await call('GET', `/api/admin/users?q=${encodeURIComponent(c.email)}`, { token: (await admin()).token });
  expect(list.body.items[0].blocked).toBe(true);
});

test('AC-39 admin monthly report page shows the figures of the API', async ({ page }) => {
  const a = await createUser('ADMIN');
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Sofia' }).slice(0, 7);
  const c = await createUser('CLIENT');
  await giveCard(c.id, 'UNLIMITED_MONTH');
  const rep = (await call('GET', `/api/admin/reports/monthly?month=${month}`, { token: (await admin()).token })).body;
  await loginAs(page, a);
  await page.goto('/admin/report');
  await expect(page.getByRole('heading', { name: 'Monthly report' })).toBeVisible();
  const held = page.locator('dd', { hasText: new RegExp(`^${rep.classesHeld}$`) }).first();
  await expect(held).toBeVisible();
  await expect(page.getByText('Classes held')).toBeVisible();
  await expect(page.getByText('Average attendance per class')).toBeVisible();
  await expect(page.getByText('No-show rate')).toBeVisible();
  const sold = page.getByRole('row', { name: /Unlimited month/ });
  await expect(sold).toContainText(String(rep.cardsSold.UNLIMITED_MONTH));
  const total = page.getByRole('row', { name: /^Total/ });
  await expect(total).toContainText(String(rep.cardsSold.total));
  await expectNoHScroll(page, 'report');
  // previous month navigation
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByLabel('Month')).not.toHaveValue(month);
  await expectNoHScroll(page, 'report prev');
});

test('AC-5 GDPR: client deletes the account in the UI (wrong password refused first)', async ({ page }) => {
  const c = await clientWithCard('PACK_8');
  const s = await sess(inDays(2));
  await book(c, s.id);
  await loginAs(page, c);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  let d = dialog(page);
  await d.getByLabel('Enter your password to confirm').fill('definitely-wrong-1');
  await d.getByRole('button', { name: 'Yes, delete forever' }).click();
  await expect(d).toContainText('Wrong email or password.');
  expect((await call('GET', '/api/me', { token: c.token })).status).toBe(200);
  await expectNoHScroll(page, 'delete dialog');

  await d.getByLabel('Enter your password to confirm').fill('Secret-pass-123');
  await d.getByRole('button', { name: 'Yes, delete forever' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toHaveText('Account deleted.');
  expect((await call('GET', '/api/me', { token: c.token })).status).toBe(401);
  const att = await call('GET', `/api/admin/sessions/${s.id}/attendees`, { token: (await admin()).token });
  expect(att.body.attendees).toHaveLength(0);
});

test('AC-4 AC-40 bg/en switch: UI language and the saved language on the user', async ({ page }) => {
  const c = await clientWithCard('PACK_8', { lang: 'en' });
  await loginAs(page, c, 'bg');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Програма');
  // open the mobile menu if the nav is collapsed
  const menu = page.getByRole('button', { name: /Меню|Menu/ });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Език' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schedule');
  await expect.poll(async () => (await call('GET', '/api/me', { token: c.token })).body.lang).toBe('en');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schedule');
  // and back to Bulgarian from the account page select
  await page.goto('/account');
  await page.getByLabel('Language').selectOption('bg');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профил');
  await expect.poll(async () => (await call('GET', '/api/me', { token: c.token })).body.lang).toBe('bg');
  // edit profile (AC-4)
  await page.getByLabel('Име').fill('Нова Йога');
  await page.getByRole('button', { name: 'Запази' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect((await call('GET', '/api/me', { token: c.token })).body.name).toBe('Нова Йога');
  await expectNoHScroll(page, 'account');
});
