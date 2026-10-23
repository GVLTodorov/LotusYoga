import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, call } from './tests/helpers/api';

/** Waits for the app, logs in as the seeded admin once and shares the id with the workers. */
export default async function globalSetup() {
  let last = '';
  for (let i = 0; i < 60; i++) {
    try {
      const h = await fetch(`${BASE_URL}/health`);
      if (h.ok) break;
      last = `health ${h.status}`;
    } catch (e) {
      last = String(e);
    }
    if (i === 59) throw new Error(`app not reachable at ${BASE_URL}: ${last}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const r = await call('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
  process.env.E2E_ADMIN_ID = r.body.user.id;
}
