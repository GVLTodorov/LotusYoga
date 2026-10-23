import { expect, test } from '@playwright/test';
import { PASSWORD, call, uid } from '../helpers/api';

// Runs last (project dependency) because it exhausts the login budget (10 per 15 min per IP).
test('AC-44 login is rate limited (429 RATE_LIMITED)', async () => {
  test.skip(!process.env.CI && !process.env.RUN_RATE_LIMIT_TEST, 'set RUN_RATE_LIMIT_TEST=1 (burns the 10/15min login budget)');
  let limited: any = null;
  for (let i = 0; i < 15 && !limited; i++) {
    const r = await call('POST', '/api/auth/login', { body: { email: `rl-${uid()}@e2e.test`, password: PASSWORD } });
    if (r.status === 429) limited = r;
    else expect(r.status).toBe(401);
  }
  expect(limited, 'no 429 within 15 attempts').toBeTruthy();
  expect(limited.body.error.code).toBe('RATE_LIMITED');
});
