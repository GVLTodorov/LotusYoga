import { expect, test, type Page } from '@playwright/test';
import {
  admin, book, call, cancelBooking, clientWithCard, createSession, createUser, giveCard, inDays, inHours, inMinutes,
  joinWaitlist, moveSession, addDaysStr, sofiaToday, uid,
} from '../helpers/api';
import { expectNoHScroll, loginAs, setLangOnly } from '../helpers/ui';

// AC-42: 360 / 768 / 1280 px, no horizontal page scroll on every page (both languages for Bulgarian, the longer one).
const WIDTHS = [360, 768, 1280];
const LONG = 'Много дълго име на занимание за проверка на пренасянето на редове';

let instr: Awaited<ReturnType<typeof createUser>>;
let client: Awaited<ReturnType<typeof clientWithCard>>;
let adm: Awaited<ReturnType<typeof createUser>>;
let late: { bookingId: string };

test.beforeAll(async () => {
  instr = await createUser('INSTRUCTOR', { name: 'Инструктор с изключително дълго име за тест Иванова-Петрова' });
  adm = await createUser('ADMIN');
  client = await clientWithCard('PACK_8', { name: 'Клиент с изключително дълго име за тест Иванова-Петрова', email: `very-long-email-address-for-layout-testing-${uid()}@example-long-domain.test` });
  await giveCard(client.id, 'SINGLE', { validFrom: addDaysStr(sofiaToday(), -90) }); // expired card
  const s1 = await createSession({ name: LONG, instructorId: instr.id, startsAt: inDays(2), capacity: 14 });
  const full = await createSession({ name: `${LONG} пълно`, instructorId: instr.id, startsAt: inDays(2), capacity: 1 });
  const lateS = await createSession({ name: `${LONG} късно`, instructorId: instr.id, startsAt: inHours(3), capacity: 14 });
  const today = await createSession({ name: `${LONG} днес`, instructorId: instr.id, startsAt: inHours(2), capacity: 14 });
  await book(client, s1.id);
  const b = await book(client, lateS.id);
  late = { bookingId: b.body.id };
  const other = await clientWithCard();
  await book(other, full.id);
  await joinWaitlist(client, full.id);
  await book(client, today.id);
  await moveSession(today.id, inMinutes(10));
  const c = await createSession({ name: `${LONG} отменено`, instructorId: instr.id, startsAt: inDays(3), capacity: 5 });
  await call('POST', `/api/admin/sessions/${c.id}/cancel`, { token: (await admin()).token, body: {} });
  void cancelBooking;
});

for (const width of WIDTHS) {
  test.describe(`AC-42 ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    const visit = async (page: Page, path: string, label: string, ready: RegExp | string) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (ready) await expect(page.locator('main')).toContainText(ready);
      await page.waitForLoadState('networkidle');
      await expectNoHScroll(page, `${label} @${width}`);
    };

    for (const lang of ['bg', 'en'] as const) {
      test(`public pages (${lang})`, async ({ page }) => {
        await setLangOnly(page, lang);
        await visit(page, '/', 'schedule anonymous', LONG);
        await visit(page, '/login', 'login', '');
        await visit(page, '/register', 'register', '');
        await visit(page, '/no-such-page', 'not found', '');
      });
    }

    test('client pages (bg)', async ({ page }) => {
      await loginAs(page, client, 'bg');
      await visit(page, '/', 'schedule client', LONG);
      await visit(page, '/my', 'my bookings', LONG);
      await visit(page, '/account', 'account', '');
    });

    test('client dialogs: late cancel warning and delete account (bg)', async ({ page }) => {
      await loginAs(page, client, 'bg');
      await page.goto('/my');
      await page.locator('section[aria-labelledby="h-up"] li', { hasText: `${LONG} късно` }).getByRole('button').first().click();
      await expect(page.getByTestId('late-warning')).toBeVisible();
      await expectNoHScroll(page, `late dialog @${width}`);
      const box = await page.getByRole('dialog').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      void late;
    });

    test('client pages (en)', async ({ page }) => {
      await loginAs(page, client, 'en');
      await visit(page, '/', 'schedule client en', LONG);
      await visit(page, '/my', 'my bookings en', LONG);
    });

    test('instructor today page', async ({ page }) => {
      await loginAs(page, instr, 'bg');
      await visit(page, '/today', 'today', LONG);
      await page.getByRole('button', { name: /клиент/i }).first().click().catch(() => {});
      await expectNoHScroll(page, `today dialog @${width}`);
    });

    test('admin pages', async ({ page }) => {
      await loginAs(page, adm, 'bg');
      await visit(page, '/admin/schedule', 'admin schedule', LONG);
      await visit(page, '/admin/clients', 'admin clients', '');
      await visit(page, `/admin/clients/${client.id}`, 'client history', 'Клиент');
      await visit(page, '/admin/report', 'report', '');
      await visit(page, '/today', 'admin today', '');
    });

    test('admin dialogs: template form, cancel class, add card', async ({ page }) => {
      await loginAs(page, adm, 'bg');
      await page.goto('/admin/schedule');
      await page.getByRole('button', { name: /^\+/ }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoHScroll(page, `template dialog @${width}`);
      await page.keyboard.press('Escape');
      await page.locator('li', { hasText: `${LONG} пълно` }).getByRole('button', { name: /Отмени/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoHScroll(page, `cancel class dialog @${width}`);
    });
  });
}
