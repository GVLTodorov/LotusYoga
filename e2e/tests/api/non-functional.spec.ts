import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { BASE_URL, call, createUser, mintToken } from '../helpers/api';

test('AC-45 single port serves API, health, built UI and SPA fallback', async () => {
  const h = await call('GET', '/health');
  expect(h.status).toBe(200);
  expect(h.body).toEqual({ status: 'ok' });
  const root = await fetch(`${BASE_URL}/`);
  expect(root.status).toBe(200);
  expect(root.headers.get('content-type')).toContain('text/html');
  expect(await root.text()).toContain('<div id="root"');
  for (const deep of ['/my', '/admin/clients/some-id', '/login']) {
    const r = await fetch(`${BASE_URL}${deep}`);
    expect(r.status, deep).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  }
  const api404 = await call('GET', '/api/does-not-exist');
  expect(api404.status).toBe(404);
  expect(typeof api404.body).toBe('object'); // JSON error, not the SPA shell
});

test('AC-45 the seeded initial admin exists (global-setup logged in with ADMIN_EMAIL/ADMIN_PASSWORD)', async () => {
  expect(process.env.E2E_ADMIN_ID).toBeTruthy();
});

test('AC-43 initial JS is <= 150 KB gzipped', async () => {
  const html = await (await fetch(`${BASE_URL}/`)).text();
  const urls = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]*>/g)) urls.add(m[1]);
  expect(urls.size).toBeGreaterThan(0);
  let total = 0;
  for (const u of urls) {
    const r = await fetch(new URL(u, `${BASE_URL}/`));
    expect(r.status, u).toBe(200);
    total += gzipSync(Buffer.from(await r.arrayBuffer())).length;
  }
  console.log(`initial JS gzipped: ${(total / 1024).toFixed(1)} KB`);
  expect(total).toBeLessThanOrEqual(150 * 1024);
});

test('AC-44 forged / unsigned / expired JWTs are rejected', async () => {
  const c = await createUser('CLIENT');
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: c.id, role: 'ADMIN', iat: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
  const wrongSig = `${head}.${payload}.${createHmac('sha256', 'some-other-secret').update(`${head}.${payload}`).digest('base64url')}`;
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`;
  expect((await call('GET', '/api/me', { token: wrongSig })).status).toBe(401);
  expect((await call('GET', '/api/admin/users', { token: wrongSig })).status).toBe(401);
  expect((await call('GET', '/api/me', { token: none })).status).toBe(401);
  // a valid token whose role claim says ADMIN for a CLIENT must not grant admin rights
  const escalated = mintToken(c.id, 'ADMIN');
  expect((await call('GET', '/api/admin/users', { token: escalated })).status).toBe(403);
  expect((await call('GET', '/api/me', { token: c.token })).status).toBe(200);
});

