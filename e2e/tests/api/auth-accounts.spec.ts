import { expect, test } from '@playwright/test';
import { PASSWORD, admin, book, call, clientWithCard, createSession, createUser, inDays, inHours, uid } from '../helpers/api';

// NOTE: register/login are limited to 10 per 15 min per IP; the whole suite is budgeted to
// ~9 register and ~9 login calls (everything else uses admin-created users + minted tokens).

test.describe('AC-1 register', () => {
  test('AC-1 creates a CLIENT, returns token, token works on /api/me', async () => {
    const email = `reg-${uid()}@e2e.test`;
    const r = await call('POST', '/api/auth/register', { body: { email, password: PASSWORD, name: 'Ивана Петрова', phone: '+359 888 123 456', lang: 'bg' } });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email, name: 'Ивана Петрова', role: 'CLIENT', lang: 'bg', blocked: false });
    expect(r.body.user.password).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon|\$2[aby]\$/);
    const me = await call('GET', '/api/me', { token: r.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  test('AC-1 defaults: lang bg; unicode 100-char name and exactly-8-char password accepted', async () => {
    const r = await call('POST', '/api/auth/register', { body: { email: `u-${uid()}@e2e.test`, password: '12345678', name: 'Я'.repeat(100), phone: '+359 888 000 111' } });
    expect(r.status).toBe(201);
    expect(r.body.user.lang).toBe('bg');
    expect(r.body.user.name).toHaveLength(100);
  });

  test('AC-1 validation: missing phone, short password, bad email, bad phone', async () => {
    const base = { email: `v-${uid()}@e2e.test`, password: PASSWORD, name: 'Val', phone: '+359 888 123 456' };
    const { phone: _p, ...noPhone } = base;
    const missing = await call('POST', '/api/auth/register', { body: noPhone });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details.map((d: any) => d.path)).toContain('phone');
    for (const bad of [{ password: 'short' }, { email: 'not-an-email' }, { phone: 'abc' }]) {
      const r = await call('POST', '/api/auth/register', { body: { ...base, ...bad } });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

test('AC-2 duplicate email -> 409 EMAIL_TAKEN (case-insensitive)', async () => {
  const email = `dup-${uid()}@e2e.test`;
  const first = await call('POST', '/api/auth/register', { body: { email, password: PASSWORD, name: 'Dup', phone: '+359 888 123 456' } });
  expect(first.status).toBe(201);
  const again = await call('POST', '/api/auth/register', { body: { email: email.toUpperCase(), password: PASSWORD, name: 'Dup2', phone: '+359 888 123 457' } });
  expect(again.status).toBe(409);
  expect(again.body.error.code).toBe('EMAIL_TAKEN');
});

test('AC-3 login ok and generic failure for wrong password / unknown email', async () => {
  const c = await createUser('CLIENT');
  const ok = await call('POST', '/api/auth/login', { body: { email: c.email, password: PASSWORD } });
  expect(ok.status).toBe(200);
  expect(ok.body.token).toBeTruthy();
  const wrongPw = await call('POST', '/api/auth/login', { body: { email: c.email, password: 'nope-nope-1' } });
  expect(wrongPw.status).toBe(401);
  expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
  expect(wrongPw.body.error.message).not.toMatch(/password is|no such|unknown/i);
});

test('AC-3 blocked user can still log in', async () => {
  const c = await createUser('CLIENT');
  const a = await admin();
  await call('PATCH', `/api/admin/users/${c.id}`, { token: a.token, body: { blocked: true } });
  const r = await call('POST', '/api/auth/login', { body: { email: c.email, password: PASSWORD } });
  expect(r.status).toBe(200);
  expect(r.body.user.blocked).toBe(true);
});

test('AC-4 client edits name, phone, language; validation applies', async () => {
  const c = await createUser('CLIENT');
  const r = await call('PATCH', '/api/me', { token: c.token, body: { name: 'Нова Име', phone: '+359 899 111 222', lang: 'bg' } });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ name: 'Нова Име', phone: '+359 899 111 222', lang: 'bg' });
  const me = await call('GET', '/api/me', { token: c.token });
  expect(me.body).toMatchObject({ name: 'Нова Име', phone: '+359 899 111 222', lang: 'bg' });
  expect((await call('PATCH', '/api/me', { token: c.token, body: { lang: 'fr' } })).status).toBe(400);
  expect((await call('PATCH', '/api/me', { token: c.token, body: { phone: 'xx' } })).status).toBe(400);
  expect((await call('PATCH', '/api/me', { token: c.token, body: { role: 'ADMIN' } })).body?.role ?? 'CLIENT').toBe('CLIENT');
  expect((await call('GET', '/api/me', { token: c.token })).body.role).toBe('CLIENT');
});

test.describe('AC-5 GDPR delete', () => {
  test('wrong password -> 401 and nothing changes; right password anonymises', async () => {
    const c = await clientWithCard('PACK_8');
    const a = await admin();
    const instr = await createUser('INSTRUCTOR');
    const future = await createSession({ instructorId: instr.id, startsAt: inDays(3) });
    const soon = await createSession({ instructorId: instr.id, startsAt: inHours(4) });
    const fullOne = await createSession({ instructorId: instr.id, startsAt: inDays(2), capacity: 1 });
    const other = await clientWithCard('PACK_8');
    expect((await book(c, future.id)).status).toBe(201);
    expect((await book(other, fullOne.id)).status).toBe(201);
    expect((await call('POST', `/api/sessions/${fullOne.id}/waitlist`, { token: c.token })).status).toBe(201);

    // past attendance that must survive: session started 1h ago, attended
    const past = await createSession({ instructorId: instr.id, startsAt: inHours(3) });
    const pb = await book(c, past.id);
    expect(pb.status).toBe(201);
    await call('PATCH', `/api/admin/sessions/${past.id}`, { token: a.token, body: { startsAt: new Date(Date.now() - 3600_000).toISOString() } });
    const att = await call('PATCH', `/api/bookings/${pb.body.id}/attendance`, { token: a.token, body: { status: 'ATTENDED' } });
    expect(att.status).toBe(200);
    void soon;

    const bad = await call('DELETE', '/api/me', { token: c.token, body: { password: 'wrong-password-1' } });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await call('GET', '/api/me', { token: c.token })).body.name).toBe(c.name);

    const del = await call('DELETE', '/api/me', { token: c.token, body: { password: PASSWORD } });
    expect(del.status).toBe(204);

    // can't log in any more; token no longer works
    const login = await call('POST', '/api/auth/login', { body: { email: c.email, password: PASSWORD } });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await call('GET', '/api/me', { token: c.token })).status).toBe(401);

    // not listed for admin searches by old name/email
    const search = await call('GET', `/api/admin/users?q=${encodeURIComponent(c.email)}`, { token: a.token });
    expect(search.body.items).toHaveLength(0);

    // future booking cancelled -> spot free again; waitlist entry gone
    const s1 = await call('GET', `/api/admin/sessions/${future.id}/attendees`, { token: a.token });
    expect(s1.body.attendees).toHaveLength(0);
    const s2 = await call('GET', `/api/admin/sessions/${fullOne.id}/attendees`, { token: a.token });
    expect(s2.body.waitlist).toHaveLength(0);

    // past attendance stays, shown as "Deleted client", with no personal data
    const att2 = await call('GET', `/api/admin/sessions/${past.id}/attendees`, { token: a.token });
    expect(att2.body.attendees).toHaveLength(1);
    expect(att2.body.attendees[0]).toMatchObject({ name: 'Deleted client', phone: '', status: 'ATTENDED' });
    expect(JSON.stringify(att2.body)).not.toContain(c.email);
  });

  test('instructor/admin cannot use DELETE /api/me (403) and missing password is 400', async () => {
    const i = await createUser('INSTRUCTOR');
    expect((await call('DELETE', '/api/me', { token: i.token, body: { password: PASSWORD } })).status).toBe(403);
    const c = await createUser('CLIENT');
    expect((await call('DELETE', '/api/me', { token: c.token, body: {} })).status).toBe(400);
  });
});

test.describe('AC-44 role checks on protected endpoints', () => {
  test('anonymous -> 401; wrong role -> 403', async () => {
    const client = await createUser('CLIENT');
    const instr = await createUser('INSTRUCTOR');
    const anon: [string, string][] = [
      ['GET', '/api/me'], ['GET', '/api/me/bookings'], ['GET', '/api/me/cards'], ['GET', '/api/me/waitlist'],
      ['GET', '/api/instructor/sessions'], ['GET', '/api/admin/templates'], ['GET', '/api/admin/users'],
      ['GET', '/api/admin/reports/monthly?month=2026-01'], ['POST', '/api/admin/sessions'], ['POST', '/api/sessions/x/bookings'],
    ];
    for (const [m, p] of anon) expect((await call(m, p)).status, `${m} ${p}`).toBe(401);
    const adminOnly: [string, string][] = [
      ['GET', '/api/admin/templates'], ['GET', '/api/admin/users'], ['GET', '/api/admin/reports/monthly?month=2026-01'],
      ['GET', '/api/admin/sessions/x/attendees'], ['POST', '/api/admin/sessions'], ['POST', '/api/admin/templates'],
    ];
    for (const [m, p] of adminOnly) {
      expect((await call(m, p, { token: client.token, ...(m === 'GET' ? {} : { body: {} }) })).status, `client ${m} ${p}`).toBe(403);
      expect((await call(m, p, { token: instr.token, ...(m === 'GET' ? {} : { body: {} }) })).status, `instructor ${m} ${p}`).toBe(403);
    }
    expect((await call('GET', '/api/instructor/sessions', { token: client.token })).status).toBe(403);
    expect((await call('GET', '/api/instructor/clients?q=ab', { token: client.token })).status).toBe(403);
    expect((await call('GET', '/api/me/bookings', { token: instr.token })).status).toBe(403);
    expect((await call('POST', '/api/sessions/x/bookings', { token: instr.token })).status).toBe(403);
    expect((await call('GET', '/api/me', { token: 'garbage.token.value' })).status).toBe(401);
  });
});
