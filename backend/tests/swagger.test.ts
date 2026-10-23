import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractPaths } from '../src/openapi.js';
import { makeEnv, prisma, type TestEnv } from './helpers.js';

const CONTRACT_PATHS = [
  '/api/auth/register', '/api/auth/login', '/api/me', '/api/sessions', '/api/sessions/{id}', '/api/sessions/{id}/bookings',
  '/api/me/bookings', '/api/bookings/{id}/cancel-preview', '/api/bookings/{id}/cancel', '/api/sessions/{id}/waitlist',
  '/api/waitlist/{id}', '/api/me/waitlist', '/api/me/cards', '/api/instructor/sessions', '/api/bookings/{id}/attendance',
  '/api/instructor/clients', '/api/sessions/{id}/walk-ins', '/api/admin/templates', '/api/admin/templates/{id}',
  '/api/admin/sessions', '/api/admin/sessions/{id}', '/api/admin/sessions/{id}/cancel', '/api/admin/sessions/{id}/attendees',
  '/api/admin/users', '/api/admin/users/{id}', '/api/admin/users/{id}/history', '/api/admin/users/{id}/cards',
  '/api/admin/cards/{id}', '/api/admin/reports/monthly',
];

let env: TestEnv;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.close();
  await prisma.$disconnect();
});

describe('swagger', () => {
  it('GET /swagger.json lists every contract path and the bearer scheme', async () => {
    const res = await env.api().get('/swagger.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    for (const p of CONTRACT_PATHS) expect(Object.keys(res.body.paths), p).toContain(p);
    expect(contractPaths).toEqual(expect.arrayContaining(CONTRACT_PATHS));
    expect(res.body.components.securitySchemes.bearer.scheme).toBe('bearer');
  });

  it('/swagger HTML carries the top-bar link buttons (app-links)', async () => {
    let res = await env.api().get('/swagger');
    if (res.status >= 300 && res.status < 400) res = await env.api().get(res.headers.location);
    if (res.status >= 300 && res.status < 400) res = await env.api().get(res.headers.location);
    expect(res.status).toBe(200);
    expect(res.text).toContain('.app-links');
    expect(res.text).toContain('http://localhost:5173');
  });

  it('sends a strict CSP for the app and a relaxed one for /swagger', async () => {
    const app = await env.api().get('/health');
    expect(app.headers['content-security-policy']).toContain("script-src 'self'");
    expect(app.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(app.headers['x-content-type-options']).toBe('nosniff');
    const sw = await env.api().get('/swagger');
    expect(sw.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('GET /health', async () => {
    const res = await env.api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown API routes return the JSON error shape', async () => {
    const res = await env.api().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('static UI', () => {
  let staticEnv: TestEnv;
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>SPA</body></html>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    staticEnv = await makeEnv({ staticDir: dir });
  });
  afterAll(async () => {
    await staticEnv.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html at / and for client-side routes', async () => {
    for (const p of ['/', '/schedule/2026-11-03']) {
      const res = await staticEnv.api().get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('SPA');
    }
  });
  it('serves static assets', async () => {
    const res = await staticEnv.api().get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
  });
  it('keeps /api and /health out of the SPA fallback', async () => {
    expect((await staticEnv.api().get('/api/nope')).body.error.code).toBe('NOT_FOUND');
    expect((await staticEnv.api().get('/health')).body.status).toBe('ok');
  });
});
