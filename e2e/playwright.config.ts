import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:5080';

// The email worker runs every 30 s, so mail assertions poll for up to ~70 s.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: { baseURL, trace: 'retain-on-failure', locale: 'en-GB', timezoneId: 'Europe/Sofia' },
  projects: [
    // API-level integration tests (no browser).
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    {
      name: 'desktop',
      testMatch: /ui\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: /ui\/.*\.spec\.ts/,
      testIgnore: /desktop-only/,
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    // Exhausts the login rate limit, so it must run after everything else.
    { name: 'ratelimit', testMatch: /ratelimit\/.*\.spec\.ts/, dependencies: ['api', 'desktop', 'mobile'] },
  ],
});
