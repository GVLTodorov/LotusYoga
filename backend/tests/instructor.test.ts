import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inDays, inHours, inMinutes, makeEnv, mkCard, mkSession, mkUser, prisma, resetDb, T0, type TestEnv } from './helpers.js';

let env: TestEnv;
let elena: Awaited<ReturnType<typeof mkUser>>;
let boris: Awaited<ReturnType<typeof mkUser>>;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb();
  env.setNow(T0);
  elena = await mkUser(env, 'INSTRUCTOR', { name: 'Elena' });
  boris = await mkUser(env, 'INSTRUCTOR', { name: 'Boris' });
});

const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;

describe('GET /api/instructor/sessions (AC-25)', () => {
  it('shows own sessions of today (Sofia) with attendee names and phones, sorted by name', async () => {
    // T0 = 2026-10-23 12:00 Sofia. 00:30 and 23:30 Sofia today are both "today"
    const early = await mkSession(elena.user.id, new Date('2026-10-22T21:30:00Z'), { name: 'Early' });
    const late = await mkSession(elena.user.id, new Date('2026-10-23T20:30:00Z'), { name: 'Late' });
    await mkSession(elena.user.id, new Date('2026-10-23T21:30:00Z')); // 00:30 tomorrow
    await mkSession(elena.user.id, new Date('2026-10-22T20:30:00Z')); // 23:30 yesterday
    await mkSession(boris.user.id, inHours(2)); // someone else's
    await mkSession(elena.user.id, inHours(3), { status: 'CANCELLED' });
    const [zed, amy, gone] = [await mkUser(env, 'CLIENT', { name: 'Zed', phone: '111 111' }), await mkUser(env, 'CLIENT', { name: 'Amy', phone: '222 222' }), await mkUser(env)];
    await prisma.booking.create({ data: { userId: zed.user.id, sessionId: late.id } });
    await prisma.booking.create({ data: { userId: amy.user.id, sessionId: late.id, status: 'NO_SHOW' } });
    await prisma.booking.create({ data: { userId: gone.user.id, sessionId: late.id, status: 'CANCELLED' } });
    const res = await env.api().get('/api/instructor/sessions').set(elena.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((x: { session: { id: string } }) => x.session.id)).toEqual([early.id, late.id]);
    expect(res.body[1].attendees).toEqual([
      expect.objectContaining({ name: 'Amy', phone: '222 222', status: 'NO_SHOW', walkIn: false, userId: amy.user.id }),
      expect.objectContaining({ name: 'Zed', phone: '111 111', status: 'BOOKED' }),
    ]);
    expect(res.body[1].session.bookedCount).toBe(2);
    expect(res.body[1].session.myState).toBeUndefined();
  });

  it('admins see all instructors; a date can be picked; bad date is 400', async () => {
    const admin = await mkUser(env, 'ADMIN');
    const a = await mkSession(elena.user.id, inDays(1));
    const b = await mkSession(boris.user.id, inDays(1));
    const res = await env.api().get('/api/instructor/sessions?date=2026-10-24').set(admin.auth);
    expect(res.body.map((x: { session: { id: string } }) => x.session.id).sort()).toEqual([a.id, b.id].sort());
    const own = await env.api().get('/api/instructor/sessions?date=2026-10-24').set(boris.auth);
    expect(own.body).toHaveLength(1);
    expect((await env.api().get('/api/instructor/sessions?date=24-10-2026').set(boris.auth)).status).toBe(400);
  });
});

describe('PATCH /api/bookings/:id/attendance (AC-26)', () => {
  async function setup(startsInMinutes: number) {
    const client = await mkUser(env);
    const s = await mkSession(elena.user.id, inMinutes(startsInMinutes));
    const b = await prisma.booking.create({ data: { userId: client.user.id, sessionId: s.id } });
    return { client, s, b };
  }
  const mark = (id: string, auth: Record<string, string>, status = 'ATTENDED') => env.api().patch(`/api/bookings/${id}/attendance`).set(auth).send({ status });

  it('marks and re-marks inside the window', async () => {
    const { b, client } = await setup(20);
    const res = await mark(b.id, elena.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingId: b.id, userId: client.user.id, name: client.user.name, status: 'ATTENDED' });
    expect((await mark(b.id, elena.auth, 'NO_SHOW')).body.status).toBe('NO_SHOW');
  });

  it('window: from 30 min before start until 24 h after start', async () => {
    const { b, s } = await setup(31);
    expect(code(await mark(b.id, elena.auth))).toBe('ATTENDANCE_WINDOW');
    env.setNow(new Date(s.startsAt.getTime() - 30 * 60e3));
    expect((await mark(b.id, elena.auth)).status).toBe(200);
    env.setNow(new Date(s.startsAt.getTime() + 24 * 3600e3));
    expect((await mark(b.id, elena.auth)).status).toBe(200);
    env.setNow(new Date(s.startsAt.getTime() + 24 * 3600e3 + 1000));
    const res = await mark(b.id, elena.auth);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('ATTENDANCE_WINDOW');
  });

  it('only the teaching instructor or an admin; clients are rejected', async () => {
    const { b, client } = await setup(10);
    expect((await mark(b.id, boris.auth)).status).toBe(403);
    expect((await mark(b.id, client.auth)).status).toBe(403);
    expect((await mark(b.id, (await mkUser(env, 'ADMIN')).auth)).status).toBe(200);
  });

  it('only active bookings; validates status; 404', async () => {
    const { b } = await setup(10);
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    expect(code(await mark(b.id, elena.auth))).toBe('INVALID_STATE');
    expect((await mark(b.id, elena.auth, 'BOOKED')).status).toBe(400);
    expect((await mark('missing', elena.auth)).status).toBe(404);
  });
});

describe('GET /api/instructor/clients', () => {
  it('searches clients by name, email or phone (min 2 chars, clients only, no deleted)', async () => {
    const a = await mkUser(env, 'CLIENT', { name: 'Maria Ivanova', email: 'maria@x.bg', phone: '0888 555 111' });
    await mkUser(env, 'CLIENT', { name: 'Petar', email: 'petar@x.bg', phone: '0877 000 000' });
    await mkUser(env, 'INSTRUCTOR', { name: 'Maria Teacher' });
    const del = await mkUser(env, 'CLIENT', { name: 'Maria Deleted' });
    await prisma.user.update({ where: { id: del.user.id }, data: { deletedAt: new Date() } });
    await mkCard(a.user.id);
    const byName = await env.api().get('/api/instructor/clients?q=mari').set(elena.auth);
    expect(byName.body).toEqual([{ id: a.user.id, name: 'Maria Ivanova', phone: '0888 555 111', hasValidCard: true }]);
    expect((await env.api().get('/api/instructor/clients?q=0888%205').set(elena.auth)).body).toHaveLength(1);
    expect((await env.api().get('/api/instructor/clients?q=PETAR@X').set(elena.auth)).body[0]).toMatchObject({ name: 'Petar', hasValidCard: false });
    expect((await env.api().get('/api/instructor/clients?q=m').set(elena.auth)).status).toBe(400);
    expect((await env.api().get('/api/instructor/clients').set(elena.auth)).status).toBe(400);
  });

  it('returns at most 20 results', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => mkUser(env, 'CLIENT', { name: `Yoga Fan ${i}` })));
    expect((await env.api().get('/api/instructor/clients?q=yoga').set(elena.auth)).body).toHaveLength(20);
  });
});

describe('POST /api/sessions/:id/walk-ins (AC-27)', () => {
  const walk = (sid: string, userId: string, auth: Record<string, string>) => env.api().post(`/api/sessions/${sid}/walk-ins`).set(auth).send({ userId });

  it('adds an attended walk-in using the card, without email, ignoring the booking window', async () => {
    const client = await mkUser(env);
    const card = await mkCard(client.user.id);
    const s = await mkSession(elena.user.id, inMinutes(10)); // booking closed already
    const res = await walk(s.id, client.user.id, elena.auth);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: client.user.id, status: 'ATTENDED', walkIn: true });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(1);
    expect(await prisma.emailOutbox.count()).toBe(0);
    expect(code(await walk(s.id, client.user.id, elena.auth))).toBe('ALREADY_BOOKED');
  });

  it('allowed until the session ends, not before the 30 min window or after the end', async () => {
    const client = await mkUser(env);
    await mkCard(client.user.id, 'PACK_12');
    const s = await mkSession(elena.user.id, inMinutes(60), { durationMin: 60 });
    expect(code(await walk(s.id, client.user.id, elena.auth))).toBe('ATTENDANCE_WINDOW');
    env.setNow(new Date(s.startsAt.getTime() + 59 * 60e3));
    expect((await walk(s.id, client.user.id, elena.auth)).status).toBe(201);
    const other = await mkUser(env);
    await mkCard(other.user.id);
    env.setNow(new Date(s.startsAt.getTime() + 61 * 60e3));
    expect(code(await walk(s.id, other.user.id, elena.auth))).toBe('ATTENDANCE_WINDOW');
  });

  it('SESSION_FULL, NO_VALID_CARD, DAILY_LIMIT, SESSION_CANCELLED', async () => {
    const [a, b, c] = [await mkUser(env), await mkUser(env), await mkUser(env)];
    await mkCard(a.user.id);
    await mkCard(c.user.id, 'UNLIMITED_MONTH');
    const s = await mkSession(elena.user.id, inMinutes(5), { capacity: 1 });
    expect((await walk(s.id, a.user.id, elena.auth)).status).toBe(201);
    expect(code(await walk(s.id, b.user.id, elena.auth))).toBe('SESSION_FULL');
    const s2 = await mkSession(elena.user.id, inMinutes(6));
    expect(code(await walk(s2.id, b.user.id, elena.auth))).toBe('NO_VALID_CARD');
    expect((await walk(s2.id, c.user.id, elena.auth)).status).toBe(201);
    const s3 = await mkSession(elena.user.id, inMinutes(7));
    expect(code(await walk(s3.id, c.user.id, elena.auth))).toBe('DAILY_LIMIT');
    const cancelled = await mkSession(elena.user.id, inMinutes(5), { status: 'CANCELLED' });
    expect(code(await walk(cancelled.id, c.user.id, elena.auth))).toBe('SESSION_CANCELLED');
  });

  it('403 for foreign sessions, blocked clients and clients as callers; 404 unknown', async () => {
    const client = await mkUser(env);
    const blocked = await mkUser(env, 'CLIENT', { blocked: true });
    await mkCard(client.user.id);
    await mkCard(blocked.user.id);
    const s = await mkSession(elena.user.id, inMinutes(5));
    expect((await walk(s.id, client.user.id, boris.auth)).status).toBe(403);
    expect((await walk(s.id, client.user.id, client.auth)).status).toBe(403);
    const res = await walk(s.id, blocked.user.id, elena.auth);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('USER_BLOCKED');
    expect((await walk(s.id, 'ghost', elena.auth)).status).toBe(404);
    expect((await walk('ghost', client.user.id, elena.auth)).status).toBe(404);
    expect((await env.api().post(`/api/sessions/${s.id}/walk-ins`).set(elena.auth).send({})).status).toBe(400);
    expect((await walk(s.id, client.user.id, (await mkUser(env, 'ADMIN')).auth)).status).toBe(201);
  });
});
