import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSessions } from '../src/services/sessions.js';
import { inDays, inHours, makeEnv, mkCard, mkSession, mkUser, prisma, resetDb, T0, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Awaited<ReturnType<typeof mkUser>>;
let elena: Awaited<ReturnType<typeof mkUser>>;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb();
  env.setNow(T0);
  admin = await mkUser(env, 'ADMIN', { name: 'Boss' });
  elena = await mkUser(env, 'INSTRUCTOR', { name: 'Elena' });
});

const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;
const tplBody = (over: object = {}) => ({ name: 'Hatha', instructorId: elena.user.id, weekday: 2, startTime: '18:30', durationMin: 75, validFrom: '2026-10-20', ...over });
const createTpl = (over: object = {}) => env.api().post('/api/admin/templates').set(admin.auth).send(tplBody(over));

describe('templates (AC-28, AC-29)', () => {
  it('creates a template with default capacity 14 and generates sessions up to 15 days ahead, DST-safe', async () => {
    env.setNow('2026-10-20T08:00:00Z'); // Tuesday 11:00 Sofia
    const res = await createTpl();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Hatha', weekday: 2, startTime: '18:30', durationMin: 75, capacity: 14, active: true, instructor: { id: elena.user.id, name: 'Elena' } });
    const sessions = await prisma.classSession.findMany({ where: { templateId: res.body.id }, orderBy: { startsAt: 'asc' } });
    // Tuesdays: 10-20 (EEST), 10-27, 11-03 (EET); 11-10 is beyond 2026-10-20 + 15 days = 11-04
    expect(sessions.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-20T15:30:00.000Z', '2026-10-27T16:30:00.000Z', '2026-11-03T16:30:00.000Z']);
    expect(sessions[0]).toMatchObject({ capacity: 14, durationMin: 75, name: 'Hatha', instructorId: elena.user.id });
  });

  it('generation is idempotent and continues as time passes', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    await createTpl();
    expect(await generateSessions(prisma, env.ctx.now())).toBe(0);
    env.setNow('2026-10-27T01:00:00Z');
    expect(await generateSessions(prisma, env.ctx.now())).toBe(1); // 11-10
    expect(await generateSessions(prisma, env.ctx.now())).toBe(0);
    expect(await prisma.classSession.count()).toBe(4);
  });

  it('skips today’s occurrence if it already started and respects validFrom', async () => {
    env.setNow('2026-10-20T16:00:00Z'); // 19:00 Sofia, class was 18:30
    const res = await createTpl({ validFrom: '2026-10-27' });
    const dates = (await prisma.classSession.findMany({ where: { templateId: res.body.id } })).map((s) => s.occurrenceDate).sort();
    expect(dates).toEqual(['2026-10-27', '2026-11-03']);
    env.setNow('2026-10-20T16:00:00Z');
    const res2 = await createTpl({ name: 'Other', validFrom: '2026-10-20' });
    const d2 = (await prisma.classSession.findMany({ where: { templateId: res2.body.id } })).map((s) => s.occurrenceDate).sort();
    expect(d2[0]).toBe('2026-10-27');
  });

  it('validates input and instructor; admin only', async () => {
    expect((await createTpl({ weekday: 8 })).status).toBe(400);
    expect((await createTpl({ startTime: '25:00' })).status).toBe(400);
    expect((await createTpl({ durationMin: 10 })).status).toBe(400);
    expect((await createTpl({ capacity: 51 })).status).toBe(400);
    expect((await createTpl({ validFrom: '2026-13-01' })).status).toBe(400);
    const client = await mkUser(env);
    const bad = await createTpl({ instructorId: client.user.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('instructorId');
    expect((await env.api().post('/api/admin/templates').set(elena.auth).send(tplBody())).status).toBe(403);
    expect((await env.api().get('/api/admin/templates').set(client.auth)).status).toBe(403);
  });

  it('lists templates', async () => {
    await createTpl();
    await createTpl({ name: 'Flow', weekday: 4 });
    const res = await env.api().get('/api/admin/templates').set(admin.auth);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual(['Hatha', 'Flow']);
  });

  it('edit applies to future sessions without bookings; sessions with bookings keep their time but get the rest', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl()).body;
    const [s1, s2, s3] = await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } });
    const client = await mkUser(env);
    await mkCard(client.user.id);
    await prisma.booking.create({ data: { userId: client.user.id, sessionId: s2.id } });
    const boris = await mkUser(env, 'INSTRUCTOR', { name: 'Boris' });

    const res = await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ name: 'Yin', instructorId: boris.user.id, startTime: '19:00', durationMin: 60, capacity: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Yin', startTime: '19:00', capacity: 10, instructor: { name: 'Boris' } });

    const all = await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } });
    const kept = all.find((s) => s.id === s2.id)!;
    expect(kept.startsAt.toISOString()).toBe('2026-10-27T16:30:00.000Z'); // time unchanged
    expect(kept).toMatchObject({ name: 'Yin', instructorId: boris.user.id, durationMin: 60, capacity: 10 });
    expect(all.find((s) => s.id === s1.id)).toBeUndefined(); // replaced by a 19:00 session
    expect(all.map((x) => x.startsAt.toISOString())).toContain('2026-10-20T16:00:00.000Z'); // 19:00 EEST
    const times = all.map((s) => s.startsAt.toISOString());
    expect(times).toContain('2026-11-03T17:00:00.000Z'); // 19:00 EET
    expect(times).not.toContain('2026-11-03T16:30:00.000Z');
    expect(all.filter((s) => s.id === s3.id)).toHaveLength(0); // unbooked session was replaced
  });

  it('weekday change moves unbooked sessions', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl()).body;
    await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ weekday: 4 });
    const days = (await prisma.classSession.findMany({ where: { templateId: tpl.id } })).map((s) => s.occurrenceDate).sort();
    expect(days).toEqual(['2026-10-22', '2026-10-29']);
  });

  it('capacity cannot go below the booked count (CAPACITY_BELOW_BOOKED), and nothing changes', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl()).body;
    const s = (await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } }))[1];
    const users = await Promise.all([mkUser(env), mkUser(env), mkUser(env)]);
    for (const u of users) await prisma.booking.create({ data: { userId: u.user.id, sessionId: s.id } });
    const res = await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ capacity: 2, name: 'Changed' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('CAPACITY_BELOW_BOOKED');
    expect((await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } })).name).toBe('Hatha');
    expect((await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ capacity: 3 })).status).toBe(200);
  });

  it('capacity increase promotes the waiting list', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl({ capacity: 1 })).body;
    const s = (await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } }))[1];
    const [a, b] = [await mkUser(env), await mkUser(env)];
    await mkCard(a.user.id);
    await mkCard(b.user.id);
    await prisma.booking.create({ data: { userId: a.user.id, sessionId: s.id } });
    await prisma.waitlistEntry.create({ data: { userId: b.user.id, sessionId: s.id } });
    await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ capacity: 2 });
    expect(await prisma.booking.count({ where: { userId: b.user.id, status: 'BOOKED' } })).toBe(1);
  });

  it('deactivating stops generation and removes future sessions without bookings', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl()).body;
    const s = (await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } }))[1];
    const client = await mkUser(env);
    await prisma.booking.create({ data: { userId: client.user.id, sessionId: s.id } });
    const res = await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ active: false });
    expect(res.body.active).toBe(false);
    expect((await prisma.classSession.findMany({ where: { templateId: tpl.id } })).map((x) => x.id)).toEqual([s.id]);
    env.setNow('2026-11-10T08:00:00Z');
    expect(await generateSessions(prisma, env.ctx.now())).toBe(0);
    // re-activating generates again
    await env.api().patch(`/api/admin/templates/${tpl.id}`).set(admin.auth).send({ active: true });
    expect(await prisma.classSession.count({ where: { templateId: tpl.id } })).toBeGreaterThan(1);
  });

  it('404 for unknown template', async () => {
    expect((await env.api().patch('/api/admin/templates/nope').set(admin.auth).send({ name: 'x' })).status).toBe(404);
  });
});

describe('single sessions (AC-30..32)', () => {
  it('creates a one-off session (AC-31) that shows in the schedule', async () => {
    const res = await env.api().post('/api/admin/sessions').set(admin.auth).send({ name: 'Workshop', instructorId: elena.user.id, startsAt: '2026-10-28T16:00:00.000Z', durationMin: 120, capacity: 20 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Workshop', templateId: null, capacity: 20, startsAt: '2026-10-28T16:00:00.000Z' });
    const list = await env.api().get('/api/sessions');
    expect(list.body.map((s: { id: string }) => s.id)).toContain(res.body.id);
    expect((await env.api().post('/api/admin/sessions').set(admin.auth).send({ name: 'x' })).status).toBe(400);
    expect((await env.api().post('/api/admin/sessions').set(admin.auth).send({ name: 'W', instructorId: elena.user.id, startsAt: 'tomorrow', durationMin: 60, capacity: 5 })).status).toBe(400);
  });

  it('moves one session, changes instructor/capacity; bookings stay (AC-30)', async () => {
    const s = await mkSession(elena.user.id, inDays(3));
    const other = await mkSession(elena.user.id, inDays(4));
    const client = await mkUser(env);
    await prisma.booking.create({ data: { userId: client.user.id, sessionId: s.id } });
    const boris = await mkUser(env, 'INSTRUCTOR', { name: 'Boris' });
    const res = await env.api().patch(`/api/admin/sessions/${s.id}`).set(admin.auth).send({ startsAt: '2026-11-02T10:00:00.000Z', instructorId: boris.user.id, capacity: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ startsAt: '2026-11-02T10:00:00.000Z', instructor: { name: 'Boris' }, capacity: 3, bookedCount: 1 });
    expect(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } })).toBe(1);
    expect((await prisma.classSession.findUniqueOrThrow({ where: { id: other.id } })).instructorId).toBe(elena.user.id);
  });

  it('CAPACITY_BELOW_BOOKED and SESSION_CANCELLED', async () => {
    const s = await mkSession(elena.user.id, inDays(3));
    for (const u of [await mkUser(env), await mkUser(env)]) await prisma.booking.create({ data: { userId: u.user.id, sessionId: s.id } });
    const res = await env.api().patch(`/api/admin/sessions/${s.id}`).set(admin.auth).send({ capacity: 1 });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('CAPACITY_BELOW_BOOKED');
    const c = await mkSession(elena.user.id, inDays(3), { status: 'CANCELLED' });
    expect(code(await env.api().patch(`/api/admin/sessions/${c.id}`).set(admin.auth).send({ name: 'x' }))).toBe('SESSION_CANCELLED');
    expect((await env.api().patch('/api/admin/sessions/nope').set(admin.auth).send({ name: 'x' })).status).toBe(404);
  });

  it('capacity increase promotes the waiting list', async () => {
    const s = await mkSession(elena.user.id, inDays(3), { capacity: 1 });
    const [a, b, c] = [await mkUser(env), await mkUser(env), await mkUser(env)];
    for (const u of [a, b, c]) await mkCard(u.user.id);
    await prisma.booking.create({ data: { userId: a.user.id, sessionId: s.id } });
    await prisma.waitlistEntry.create({ data: { userId: b.user.id, sessionId: s.id } });
    await prisma.waitlistEntry.create({ data: { userId: c.user.id, sessionId: s.id } });
    await env.api().patch(`/api/admin/sessions/${s.id}`).set(admin.auth).send({ capacity: 2 });
    expect(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } })).toBe(2);
    expect((await prisma.waitlistEntry.findFirstOrThrow({ where: { userId: c.user.id } })).status).toBe('WAITING');
    expect(await prisma.emailOutbox.count({ where: { template: 'WAITLIST_PROMOTED' } })).toBe(1);
  });

  it('cancelling returns classes, emails clients with the reason and clears the waiting list (AC-32)', async () => {
    const s = await mkSession(elena.user.id, inDays(3), { capacity: 1 });
    const [a, w] = [await mkUser(env, 'CLIENT', { lang: 'bg', email: 'a@x.bg' }), await mkUser(env)];
    const card = await mkCard(a.user.id);
    await mkCard(w.user.id);
    await prisma.card.update({ where: { id: card.id }, data: { usedClasses: 1 } });
    await prisma.booking.create({ data: { userId: a.user.id, sessionId: s.id, cardId: card.id } });
    await prisma.waitlistEntry.create({ data: { userId: w.user.id, sessionId: s.id } });
    const res = await env.api().post(`/api/admin/sessions/${s.id}/cancel`).set(admin.auth).send({ reason: 'Public holiday' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', bookedCount: 0 });
    expect((await prisma.booking.findFirstOrThrow({ where: { sessionId: s.id } })).status).toBe('CLASS_CANCELLED');
    expect((await prisma.waitlistEntry.findFirstOrThrow()).status).toBe('CLASS_CANCELLED');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).usedClasses).toBe(0);
    const mail = await prisma.emailOutbox.findFirstOrThrow();
    expect(mail).toMatchObject({ to: 'a@x.bg', lang: 'bg', template: 'SESSION_CANCELLED' });
    expect(JSON.stringify(mail.payload)).toContain('Public holiday');
    expect(code(await env.api().post(`/api/admin/sessions/${s.id}/cancel`).set(admin.auth).send({}))).toBe('SESSION_CANCELLED');
  });

  it('cannot cancel a started session', async () => {
    const s = await mkSession(elena.user.id, inHours(-1));
    expect(code(await env.api().post(`/api/admin/sessions/${s.id}/cancel`).set(admin.auth).send({}))).toBe('SESSION_STARTED');
  });

  it('a cancelled template session is not regenerated', async () => {
    env.setNow('2026-10-20T08:00:00Z');
    const tpl = (await createTpl()).body;
    const s = (await prisma.classSession.findMany({ where: { templateId: tpl.id }, orderBy: { startsAt: 'asc' } }))[1];
    await env.api().post(`/api/admin/sessions/${s.id}/cancel`).set(admin.auth).send({});
    await generateSessions(prisma, env.ctx.now());
    expect(await prisma.classSession.count({ where: { templateId: tpl.id } })).toBe(3);
  });

  it('attendees endpoint lists bookings and the waiting list in order', async () => {
    const s = await mkSession(elena.user.id, inDays(3), { capacity: 2 });
    const [a, b, w1, w2] = [await mkUser(env, 'CLIENT', { name: 'Bea' }), await mkUser(env, 'CLIENT', { name: 'Ann' }), await mkUser(env), await mkUser(env)];
    await prisma.booking.create({ data: { userId: a.user.id, sessionId: s.id } });
    await prisma.booking.create({ data: { userId: b.user.id, sessionId: s.id } });
    const e1 = await prisma.waitlistEntry.create({ data: { userId: w1.user.id, sessionId: s.id } });
    await prisma.waitlistEntry.create({ data: { userId: w2.user.id, sessionId: s.id } });
    const res = await env.api().get(`/api/admin/sessions/${s.id}/attendees`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.session.id).toBe(s.id);
    expect(res.body.attendees.map((x: { name: string }) => x.name)).toEqual(['Ann', 'Bea']);
    expect(res.body.waitlist).toHaveLength(2);
    expect(res.body.waitlist[0]).toEqual({ id: e1.id, userId: w1.user.id, name: w1.user.name, position: 1 });
    expect((await env.api().get('/api/admin/sessions/nope/attendees').set(admin.auth)).status).toBe(404);
  });
});

describe('users (AC-33, AC-34, AC-38)', () => {
  it('lists, searches, filters and paginates; deleted users excluded; includes the active card', async () => {
    const c1 = await mkUser(env, 'CLIENT', { name: 'Maria Petrova', email: 'maria@x.bg', phone: '0888 111 111' });
    await mkUser(env, 'CLIENT', { name: 'Ivan Ivanov', email: 'ivan@x.bg' });
    const gone = await mkUser(env, 'CLIENT', { name: 'Maria Gone' });
    await prisma.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });
    const soon = await mkCard(c1.user.id, 'PACK_8');
    await mkCard(c1.user.id, 'PACK_12');
    const all = await env.api().get('/api/admin/users').set(admin.auth);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(4); // admin, elena, maria, ivan
    const maria = all.body.items.find((u: { id: string }) => u.id === c1.user.id);
    expect(maria.activeCard.id).toBe(soon.id); // earliest expiry first
    expect(maria.passwordHash).toBeUndefined();
    expect(all.body.items.find((u: { name: string }) => u.name === 'Ivan Ivanov').activeCard).toBeNull();
    expect((await env.api().get('/api/admin/users?q=maria').set(admin.auth)).body.total).toBe(1);
    expect((await env.api().get('/api/admin/users?q=0888%20111').set(admin.auth)).body.total).toBe(1);
    expect((await env.api().get('/api/admin/users?role=INSTRUCTOR').set(admin.auth)).body.items[0].name).toBe('Elena');
    const page = await env.api().get('/api/admin/users?page=2&pageSize=3').set(admin.auth);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(4);
    expect((await env.api().get('/api/admin/users?pageSize=0').set(admin.auth)).status).toBe(400);
  });

  it('creates users of any role; EMAIL_TAKEN; validation', async () => {
    const body = { email: 'New@X.bg', password: 'password1', name: 'Nina', phone: '+359 888 000 111', role: 'INSTRUCTOR', lang: 'en' };
    const res = await env.api().post('/api/admin/users').set(admin.auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'new@x.bg', role: 'INSTRUCTOR', lang: 'en' });
    const login = await env.api().post('/api/auth/login').send({ email: 'new@x.bg', password: 'password1' });
    expect(login.status).toBe(200);
    expect(code(await env.api().post('/api/admin/users').set(admin.auth).send(body))).toBe('EMAIL_TAKEN');
    expect((await env.api().post('/api/admin/users').set(admin.auth).send({ ...body, email: 'z@x.bg', role: 'BOSS' })).status).toBe(400);
  });

  it('edits name, phone, role, language, block and password (AC-38)', async () => {
    const c = await mkUser(env);
    const res = await env.api().patch(`/api/admin/users/${c.user.id}`).set(admin.auth).send({ name: 'Renamed', phone: '0888 999 999', role: 'INSTRUCTOR', lang: 'bg', blocked: true, password: 'brandnew123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed', role: 'INSTRUCTOR', lang: 'bg', blocked: true });
    expect((await env.api().post('/api/auth/login').send({ email: c.user.email, password: 'brandnew123' })).status).toBe(200);
    expect((await env.api().post('/api/auth/login').send({ email: c.user.email, password: 'secret123' })).status).toBe(401);
    await env.api().patch(`/api/admin/users/${c.user.id}`).set(admin.auth).send({ blocked: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).blocked).toBe(false);
    expect((await env.api().patch('/api/admin/users/nope').set(admin.auth).send({ name: 'x' })).status).toBe(404);
  });

  it('an admin cannot remove their own ADMIN role', async () => {
    const res = await env.api().patch(`/api/admin/users/${admin.user.id}`).set(admin.auth).send({ role: 'CLIENT' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('INVALID_STATE');
    expect((await env.api().patch(`/api/admin/users/${admin.user.id}`).set(admin.auth).send({ role: 'ADMIN', name: 'Boss 2' })).status).toBe(200);
  });

  it('blocking stops booking but keeps existing bookings', async () => {
    const c = await mkUser(env);
    await mkCard(c.user.id);
    const s = await mkSession(elena.user.id, inHours(30));
    const s2 = await mkSession(elena.user.id, inHours(31));
    await env.api().post(`/api/sessions/${s.id}/bookings`).set(c.auth);
    await env.api().patch(`/api/admin/users/${c.user.id}`).set(admin.auth).send({ blocked: true });
    expect(code(await env.api().post(`/api/sessions/${s2.id}/bookings`).set(c.auth))).toBe('USER_BLOCKED');
    expect(await prisma.booking.count({ where: { userId: c.user.id, status: 'BOOKED' } })).toBe(1);
  });
});

describe('cards (AC-35, AC-36) and history (AC-37)', () => {
  it('records a card with the contract expiry example and logs CREATED', async () => {
    const c = await mkUser(env);
    const res = await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type: 'UNLIMITED_MONTH', paymentMethod: 'BANK_TRANSFER', priceBgn: 99.5, validFrom: '2026-11-03' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'UNLIMITED_MONTH', totalClasses: null, remainingClasses: null, validFrom: '2026-11-03', paymentMethod: 'BANK_TRANSFER', priceBgn: 99.5, isActive: true });
    expect(res.body.expiresAt).toBe('2026-12-02T21:59:59.999Z'); // 2026-12-02 23:59:59.999 Sofia
    const ev = await prisma.cardEvent.findFirstOrThrow();
    expect(ev).toMatchObject({ type: 'CREATED', byUserId: admin.user.id });
  });

  it.each([
    ['SINGLE', 1, '2026-12-02T21:59:59.999Z'],
    ['PACK_8', 8, '2027-01-02T21:59:59.999Z'],
    ['PACK_12', 12, '2027-02-02T21:59:59.999Z'],
  ])('%s has %i classes and expires %s', async (type, total, exp) => {
    const c = await mkUser(env);
    const res = await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type, paymentMethod: 'CASH', validFrom: '2026-11-03' });
    expect(res.body).toMatchObject({ totalClasses: total, remainingClasses: total, priceBgn: null, expiresAt: exp });
  });

  it('validFrom defaults to today (Sofia); validation and 404', async () => {
    const c = await mkUser(env);
    const res = await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type: 'SINGLE', paymentMethod: 'CASH' });
    expect(res.body.validFrom).toBe('2026-10-23');
    expect((await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type: 'GOLD', paymentMethod: 'CASH' })).status).toBe(400);
    expect((await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type: 'SINGLE', paymentMethod: 'CARD' })).status).toBe(400);
    expect((await env.api().post('/api/admin/users/nope/cards').set(admin.auth).send({ type: 'SINGLE', paymentMethod: 'CASH' })).status).toBe(404);
  });

  it('a recorded card is immediately usable to book', async () => {
    const c = await mkUser(env);
    await env.api().post(`/api/admin/users/${c.user.id}/cards`).set(admin.auth).send({ type: 'SINGLE', paymentMethod: 'CASH' });
    const s = await mkSession(elena.user.id, inHours(30));
    expect((await env.api().post(`/api/sessions/${s.id}/bookings`).set(c.auth)).status).toBe(201);
  });

  it('changing the expiry is saved and logged with old/new date, admin and note', async () => {
    const c = await mkUser(env);
    const card = await mkCard(c.user.id, 'PACK_8');
    const res = await env.api().patch(`/api/admin/cards/${card.id}`).set(admin.auth).send({ expiresAt: '2026-12-20', note: 'Was ill' });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBe('2026-12-20T21:59:59.999Z');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      type: 'EXPIRY_CHANGED',
      oldExpiresAt: card.expiresAt.toISOString(),
      newExpiresAt: '2026-12-20T21:59:59.999Z',
      note: 'Was ill',
      byUser: { id: admin.user.id, name: 'Boss' },
    });
    expect((await env.api().patch(`/api/admin/cards/${card.id}`).set(admin.auth).send({ expiresAt: 'soon' })).status).toBe(400);
    expect((await env.api().patch('/api/admin/cards/nope').set(admin.auth).send({ expiresAt: '2026-12-20' })).status).toBe(404);
  });

  it('extending an expired card makes it usable again', async () => {
    const c = await mkUser(env);
    const card = await mkCard(c.user.id, 'PACK_8', { validFrom: '2026-08-01', expiresAt: new Date('2026-10-01T20:59:59.999Z') });
    const s = await mkSession(elena.user.id, inHours(30));
    expect(code(await env.api().post(`/api/sessions/${s.id}/bookings`).set(c.auth))).toBe('NO_VALID_CARD');
    await env.api().patch(`/api/admin/cards/${card.id}`).set(admin.auth).send({ expiresAt: '2026-11-30' });
    expect((await env.api().post(`/api/sessions/${s.id}/bookings`).set(c.auth)).status).toBe(201);
  });

  it('history shows cards with events, all bookings newest first, and totals', async () => {
    const c = await mkUser(env);
    const card = await mkCard(c.user.id);
    await env.api().patch(`/api/admin/cards/${card.id}`).set(admin.auth).send({ expiresAt: '2027-01-31' });
    const mk = async (h: number, status: 'ATTENDED' | 'NO_SHOW' | 'LATE_CANCELLED' | 'CANCELLED' | 'BOOKED') => {
      const s = await mkSession(elena.user.id, inHours(h));
      return prisma.booking.create({ data: { userId: c.user.id, sessionId: s.id, status } });
    };
    const b1 = await mk(-72, 'ATTENDED');
    await mk(-48, 'ATTENDED');
    const b3 = await mk(-24, 'NO_SHOW');
    await mk(-10, 'LATE_CANCELLED');
    const b5 = await mk(24, 'BOOKED');
    await mk(30, 'CANCELLED');
    const res = await env.api().get(`/api/admin/users/${c.user.id}/history`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(c.user.id);
    expect(res.body.stats).toEqual({ attended: 2, noShows: 1, lateCancels: 1 });
    expect(res.body.bookings).toHaveLength(6);
    expect(res.body.bookings[1].id).toBe(b5.id);
    expect(res.body.bookings[res.body.bookings.length - 1].id).toBe(b1.id);
    expect(res.body.bookings.map((b: { id: string }) => b.id)).toContain(b3.id);
    expect(res.body.cards[0].events.map((e: { type: string }) => e.type)).toEqual(['EXPIRY_CHANGED']);
    expect((await env.api().get('/api/admin/users/nope/history').set(admin.auth)).status).toBe(404);
  });
});

describe('GET /api/admin/reports/monthly (AC-39)', () => {
  it('counts held classes, attendance, no-shows and cards sold in the month', async () => {
    env.setNow('2026-12-01T12:00:00Z');
    const [a, b, c] = [await mkUser(env), await mkUser(env), await mkUser(env)];
    const mkHeld = async (iso: string, statuses: ('ATTENDED' | 'NO_SHOW' | 'CANCELLED' | 'BOOKED')[], status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') => {
      const s = await mkSession(elena.user.id, new Date(iso), { status });
      const users = [a, b, c];
      for (const [i, st] of statuses.entries()) await prisma.booking.create({ data: { userId: users[i].user.id, sessionId: s.id, status: st } });
      return s;
    };
    await mkHeld('2026-09-30T21:30:00Z', ['ATTENDED', 'ATTENDED', 'NO_SHOW']); // 2026-10-01 00:30 Sofia: October
    await mkHeld('2026-10-31T21:30:00Z', ['ATTENDED']); // 2026-10-31 23:30 Sofia: October
    await mkHeld('2026-10-31T22:30:00Z', ['ATTENDED', 'ATTENDED']); // 2026-11-01 00:30 Sofia: November
    await mkHeld('2026-10-15T15:00:00Z', ['ATTENDED'], 'CANCELLED'); // cancelled: not held
    await mkHeld('2026-10-16T15:00:00Z', ['CANCELLED']); // held, nobody attended
    await mkCard(a.user.id, 'SINGLE', { createdAt: new Date('2026-10-05T10:00:00Z') });
    await mkCard(a.user.id, 'PACK_8', { createdAt: new Date('2026-10-31T21:30:00Z') });
    await mkCard(b.user.id, 'PACK_8', { createdAt: new Date('2026-09-30T21:30:00Z') });
    await mkCard(b.user.id, 'PACK_8', { createdAt: new Date('2026-10-31T22:30:00Z') });
    const res = await env.api().get('/api/admin/reports/monthly?month=2026-10').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: '2026-10',
      classesHeld: 3,
      avgAttendance: 1, // 3 attended / 3 held
      noShowCount: 1,
      noShowRate: 0.25, // 1 / (3 + 1)
      cardsSold: { SINGLE: 1, PACK_8: 2, PACK_12: 0, UNLIMITED_MONTH: 0, total: 3 },
    });
    const nov = await env.api().get('/api/admin/reports/monthly?month=2026-11').set(admin.auth);
    expect(nov.body).toMatchObject({ classesHeld: 1, avgAttendance: 2, noShowCount: 0, noShowRate: 0, cardsSold: { PACK_8: 1, total: 1 } });
  });

  it('empty and future months are zeros; validates month', async () => {
    const res = await env.api().get('/api/admin/reports/monthly?month=2027-05').set(admin.auth);
    expect(res.body).toMatchObject({ classesHeld: 0, avgAttendance: 0, noShowRate: 0 });
    expect((await env.api().get('/api/admin/reports/monthly?month=2026-13').set(admin.auth)).status).toBe(400);
    expect((await env.api().get('/api/admin/reports/monthly').set(admin.auth)).status).toBe(400);
    expect((await env.api().get('/api/admin/reports/monthly?month=2026-10').set(elena.auth)).status).toBe(403);
  });
});
