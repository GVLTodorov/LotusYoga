import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureInitialAdmin } from '../src/services/accounts.js';
import { inHours, makeEnv, mkCard, mkSession, mkUser, prisma, resetDb, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await makeEnv({ rateLimitMax: 1000 });
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(resetDb);

const valid = { email: 'Ivana@Example.com', password: 'secret123', name: 'Ивана Петрова', phone: '+359 888 123 456', lang: 'bg' };

describe('POST /api/auth/register', () => {
  it('creates a CLIENT and returns a token (AC-1)', async () => {
    const res = await env.api().post('/api/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ivana@example.com', role: 'CLIENT', lang: 'bg', blocked: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    const me = await env.api().get('/api/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it('stores a hash, never the password', async () => {
    await env.api().post('/api/auth/register').send(valid);
    const u = await prisma.user.findFirstOrThrow();
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('defaults language to bg', async () => {
    const { lang: _l, ...noLang } = valid;
    const res = await env.api().post('/api/auth/register').send(noLang);
    expect(res.body.user.lang).toBe('bg');
  });

  it.each([
    ['missing phone', { phone: undefined }, 'phone'],
    ['bad phone', { phone: 'abc' }, 'phone'],
    ['short password', { password: 'short' }, 'password'],
    ['bad email', { email: 'nope' }, 'email'],
    ['empty name', { name: ' ' }, 'name'],
  ])('rejects %s with VALIDATION_ERROR details (AC-1)', async (_n, patch, path) => {
    const res = await env.api().post('/api/auth/register').send({ ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await env.api().post('/api/auth/register').set('Content-Type', 'application/json').send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('EMAIL_TAKEN for an existing email, case-insensitive (AC-2)', async () => {
    await env.api().post('/api/auth/register').send(valid);
    const res = await env.api().post('/api/auth/register').send({ ...valid, email: 'IVANA@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/auth/login', () => {
  it('returns token and user (AC-3)', async () => {
    await env.api().post('/api/auth/register').send(valid);
    const res = await env.api().post('/api/auth/login').send({ email: 'ivana@example.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('ivana@example.com');
  });

  it('token carries sub and role and lasts 30 days', async () => {
    const { user, token } = await mkUser(env, 'INSTRUCTOR');
    const payload = env.app.jwt.decode<{ sub: string; role: string; iat: number; exp: number }>(token)!;
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe('INSTRUCTOR');
    const login = await env.api().post('/api/auth/login').send({ email: user.email, password: 'secret123' });
    const p2 = env.app.jwt.decode<{ iat: number; exp: number }>(login.body.token)!;
    expect(p2.exp - p2.iat).toBe(30 * 24 * 3600);
  });

  it('wrong password and unknown email give the same generic error', async () => {
    const { user } = await mkUser(env);
    const a = await env.api().post('/api/auth/login').send({ email: user.email, password: 'wrongwrong' });
    const b = await env.api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'wrongwrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('blocked users can still log in', async () => {
    const { user } = await mkUser(env, 'CLIENT', { blocked: true });
    const res = await env.api().post('/api/auth/login').send({ email: user.email, password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.user.blocked).toBe(true);
  });

  it('is rate limited per IP (429 RATE_LIMITED)', async () => {
    const limited = await makeEnv({ rateLimitMax: 3 });
    for (let i = 0; i < 3; i++) {
      const r = await limited.api().post('/api/auth/login').send({ email: 'a@b.co', password: 'xxxxxxxx' });
      expect(r.status).toBe(401);
    }
    const res = await limited.api().post('/api/auth/login').send({ email: 'a@b.co', password: 'xxxxxxxx' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const reg = await limited.api().post('/api/auth/register').send(valid);
    expect(reg.status).toBe(201); // separate bucket per route
    await limited.app.close();
  });
});

describe('/api/me', () => {
  it('requires a token', async () => {
    const res = await env.api().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect((await env.api().get('/api/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('PATCH saves name, phone and language (AC-4)', async () => {
    const { auth } = await mkUser(env);
    const res = await env.api().patch('/api/me').set(auth).send({ name: 'New Name', phone: '0888 111 222', lang: 'bg' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'New Name', phone: '0888 111 222', lang: 'bg' });
    const bad = await env.api().patch('/api/me').set(auth).send({ phone: 'x' });
    expect(bad.status).toBe(400);
  });

  it('PATCH cannot change role or blocked', async () => {
    const { auth, user } = await mkUser(env);
    await env.api().patch('/api/me').set(auth).send({ role: 'ADMIN', blocked: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('CLIENT');
  });

  it('a token of a deleted or unknown user is rejected', async () => {
    const { auth, user } = await mkUser(env);
    await prisma.user.delete({ where: { id: user.id } });
    expect((await env.api().get('/api/me').set(auth)).status).toBe(401);
  });

  it('the role is taken from the database, not the token', async () => {
    const { auth, user } = await mkUser(env, 'ADMIN');
    await prisma.user.update({ where: { id: user.id }, data: { role: 'CLIENT' } });
    expect((await env.api().get('/api/admin/templates').set(auth)).status).toBe(403);
  });
});

describe('DELETE /api/me (AC-5)', () => {
  it('anonymises the account, cancels future bookings, leaves waitlists, keeps history', async () => {
    const { user, auth } = await mkUser(env, 'CLIENT', { name: 'Real Name' });
    const other = await mkUser(env);
    const teacher = await mkUser(env, 'INSTRUCTOR');
    await mkCard(user.id, 'PACK_8');
    const future = await mkSession(teacher.user.id, inHours(48));
    const full = await mkSession(teacher.user.id, inHours(72), { capacity: 1 });
    const past = await mkSession(teacher.user.id, inHours(-48));
    await prisma.booking.create({ data: { userId: other.user.id, sessionId: full.id } });
    const card = await prisma.card.findFirstOrThrow({ where: { userId: user.id } });
    const b1 = await prisma.booking.create({ data: { userId: user.id, sessionId: future.id, cardId: card.id } });
    await prisma.card.update({ where: { id: card.id }, data: { usedClasses: 1 } });
    const bPast = await prisma.booking.create({ data: { userId: user.id, sessionId: past.id, status: 'ATTENDED' } });
    const w = await prisma.waitlistEntry.create({ data: { userId: user.id, sessionId: full.id } });

    const wrong = await env.api().delete('/api/me').set(auth).send({ password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const res = await env.api().delete('/api/me').set(auth).send({ password: 'secret123' });
    expect(res.status).toBe(204);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ name: 'Deleted client', email: `deleted-${user.id}@invalid`, phone: '', passwordHash: null });
    expect(u.deletedAt).not.toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b1.id } })).status).toBe('CANCELLED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bPast.id } })).status).toBe('ATTENDED');
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('LEFT');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(0);

    const login = await env.api().post('/api/auth/login').send({ email: user.email, password: 'secret123' });
    expect(login.status).toBe(401);
    expect((await env.api().get('/api/me').set(auth)).status).toBe(401);
  });

  it('frees the spot for the waiting list', async () => {
    const teacher = await mkUser(env, 'INSTRUCTOR');
    const leaver = await mkUser(env);
    const waiting = await mkUser(env);
    await mkCard(leaver.user.id);
    await mkCard(waiting.user.id);
    const s = await mkSession(teacher.user.id, inHours(48), { capacity: 1 });
    await prisma.booking.create({ data: { userId: leaver.user.id, sessionId: s.id } });
    await prisma.waitlistEntry.create({ data: { userId: waiting.user.id, sessionId: s.id } });
    expect((await env.api().delete('/api/me').set(leaver.auth).send({ password: 'secret123' })).status).toBe(204);
    expect(await prisma.booking.count({ where: { userId: waiting.user.id, status: 'BOOKED' } })).toBe(1);
  });

  it('is client-only', async () => {
    const { auth } = await mkUser(env, 'INSTRUCTOR');
    expect((await env.api().delete('/api/me').set(auth).send({ password: 'secret123' })).status).toBe(403);
  });
});

describe('role checks on protected routes', () => {
  it.each([
    ['get', '/api/admin/templates'],
    ['get', '/api/admin/users'],
    ['get', '/api/instructor/sessions'],
    ['get', '/api/me/cards'],
    ['post', '/api/sessions/x/bookings'],
  ] as const)('%s %s needs a token', async (m, url) => {
    expect((await env.api()[m](url)).status).toBe(401);
  });

  it('clients cannot use instructor/admin routes, admins cannot book', async () => {
    const client = await mkUser(env);
    const admin = await mkUser(env, 'ADMIN');
    expect((await env.api().get('/api/admin/users').set(client.auth)).status).toBe(403);
    expect((await env.api().get('/api/instructor/sessions').set(client.auth)).status).toBe(403);
    expect((await env.api().post('/api/sessions/x/bookings').set(admin.auth)).status).toBe(403);
    expect((await env.api().get('/api/me/cards').set(admin.auth)).body.error.code).toBe('FORBIDDEN');
  });
});

describe('initial admin', () => {
  it('is created from env once when no admin exists', async () => {
    const e = await makeEnv({ adminEmail: 'boss@studio.bg', adminPassword: 'Str0ngPass!' });
    expect(await ensureInitialAdmin(e.ctx)).toBe(true);
    expect(await ensureInitialAdmin(e.ctx)).toBe(false);
    const login = await e.api().post('/api/auth/login').send({ email: 'boss@studio.bg', password: 'Str0ngPass!' });
    expect(login.body.user.role).toBe('ADMIN');
    await e.app.close();
  });
  it('does nothing without env values', async () => {
    expect(await ensureInitialAdmin((await makeEnv({ adminEmail: null, adminPassword: null })).ctx)).toBe(false);
  });
});
