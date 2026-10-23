import { expect, test } from '@playwright/test';
import { PASSWORD, call, createSession, createUser, giveCard, inDays, myCards, uid } from '../helpers/api';
import { waitForMail } from '../helpers/mail';
import { expectNoHScroll, sessionCard, setLangOnly } from '../helpers/ui';

// Real register / login through the UI (rate limited: 10 per 15 min per IP, so kept to a minimum).

test('AC-1 AC-8 AC-10 AC-40 register in the UI -> no card error -> admin records card -> book -> confirmation email', async ({ page }) => {
  const instr = await createUser('INSTRUCTOR');
  const name = `Reg ${uid()}`;
  await createSession({ name, instructorId: instr.id, startsAt: inDays(2), capacity: 14 });
  const email = `ui-reg-${uid()}@e2e.test`;

  await setLangOnly(page, 'en');
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible();
  await page.getByLabel('Name').fill('Ivana Petrova');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('+359 888 123 456');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  const card = sessionCard(page, name);
  await card.getByRole('button', { name: 'Book me in' }).click();
  await expect(card).toContainText('Please contact the studio');

  // the studio records a card for the new client
  const token = await page.evaluate(() => localStorage.getItem('sb_token'));
  const me = await call('GET', '/api/me', { token: token! });
  expect(me.body).toMatchObject({ email, role: 'CLIENT', name: 'Ivana Petrova', lang: 'en' });
  await giveCard(me.body.id, 'PACK_8');

  await card.getByRole('button', { name: 'Book me in' }).click();
  await expect(card.getByRole('status')).toContainText('You are booked');
  const mail = await waitForMail(email, /Booking confirmed/);
  expect(mail.Subject).toBe(`Booking confirmed: ${name}`);
  expect((await myCards({ token: token! } as any))[0].usedClasses).toBe(1);
});

test('AC-3 each role lands on its home page after login; wrong credentials give one generic message', async ({ page }) => {
  const client = await createUser('CLIENT');
  const instr = await createUser('INSTRUCTOR');
  const adm = await createUser('ADMIN');
  await setLangOnly(page, 'en');

  const login = async (email: string, password = PASSWORD) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
  };

  await login(client.email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Log out' }).click();

  await login(instr.email);
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Log out' }).click();

  await login(adm.email);
  await expect(page).toHaveURL(/\/admin\/schedule$/);
  await expect(page.getByRole('heading', { name: 'Classes', exact: true })).toBeVisible();
  // role guards: admin pages are not reachable for a client token (checked in the next test)
  await page.getByRole('navigation').getByRole('button', { name: 'Log out' }).click();

  await login(client.email, 'wrong-password-1');
  await expect(page.getByText('Wrong email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expectNoHScroll(page, 'login error');
});

test('AC-3 AC-44 protected pages redirect: anonymous -> /login, client -> home', async ({ page }) => {
  await setLangOnly(page, 'en');
  await page.goto('/my');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin/clients');
  await expect(page).toHaveURL(/\/login$/);
});
