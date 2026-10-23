import { expect, type Locator, type Page } from '@playwright/test';
import type { Person } from './api';

/** Logs the browser in by seeding localStorage (token minted by helpers/api). UI language defaults to English. */
export async function loginAs(page: Page, p: Person, lang: 'en' | 'bg' = 'en') {
  await page.addInitScript(
    ([token, l]) => {
      // only seed once per tab so that logout / language switches survive reloads
      if (!sessionStorage.getItem('e2e_seeded')) {
        localStorage.setItem('sb_token', token);
        localStorage.setItem('sb_lang', l);
        sessionStorage.setItem('e2e_seeded', '1');
      }
    },
    [p.token, lang],
  );
}

export async function setLangOnly(page: Page, lang: 'en' | 'bg') {
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem('e2e_seeded')) {
      localStorage.setItem('sb_lang', l);
      sessionStorage.setItem('e2e_seeded', '1');
    }
  }, lang);
}

/** AC-42: no horizontal page scroll. */
export async function expectNoHScroll(page: Page, label = '') {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(m.doc, `${label} documentElement horizontal overflow`).toBeLessThanOrEqual(0);
  expect(m.body, `${label} body horizontal overflow`).toBeLessThanOrEqual(0);
}

/** The schedule card (li) of a session found by its unique name. */
export const sessionCard = (page: Page, name: string): Locator => page.locator('li', { hasText: name }).first();

/** Waits for a page to finish its initial load (no spinner / loading text). */
export async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
}
