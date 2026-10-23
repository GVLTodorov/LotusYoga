import { expect, test } from '@playwright/test';
import {
  addDaysStr, admin, book, call, clientWithCard, createSession, createUser, inDays, sofiaParts, sofiaToUtc,
  sofiaToday, uid,
} from '../helpers/api';

let instr: Awaited<ReturnType<typeof createUser>>;
let instr2: Awaited<ReturnType<typeof createUser>>;
test.beforeAll(async () => {
  instr = await createUser('INSTRUCTOR');
  instr2 = await createUser('INSTRUCTOR');
});

const isoWeekday = (dateStr: string) => ((new Date(`${dateStr}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

async function templateSessions(templateId: string) {
  const today = sofiaToday();
  const r = await call('GET', `/api/sessions?from=${today}&to=${addDaysStr(today, 14)}`);
  const more = await call('GET', `/api/sessions?from=${addDaysStr(today, 15)}&to=${addDaysStr(today, 16)}`);
  return [...r.body, ...more.body].filter((s: any) => s.templateId === templateId);
}

async function newTemplate(over: Record<string, unknown> = {}) {
  const a = await admin();
  const weekday = isoWeekday(addDaysStr(sofiaToday(), 3)); // first occurrence is 3 days away (inside the booking window)
  const body = { name: `Tpl ${uid()}`, instructorId: instr.id, weekday, startTime: '18:30', durationMin: 75, capacity: 14, validFrom: sofiaToday(), ...over };
  const r = await call('POST', '/api/admin/templates', { token: a.token, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { tpl: r.body, body };
}

test.describe('AC-28 weekly templates', () => {
  test('AC-28 create generates sessions for every week up to 15 days ahead, at Sofia local start time', async () => {
    const { tpl, body } = await newTemplate();
    expect(tpl).toMatchObject({ name: body.name, weekday: body.weekday, startTime: '18:30', durationMin: 75, capacity: 14, active: true, instructor: { id: instr.id } });
    const list = await templateSessions(tpl.id);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(3);
    const limit = addDaysStr(sofiaToday(), 15);
    for (const s of list) {
      const p = sofiaParts(new Date(s.startsAt));
      expect(p.time).toBe('18:30');
      expect(isoWeekday(p.date)).toBe(body.weekday);
      expect(p.date <= limit).toBe(true);
      expect(p.date >= sofiaToday()).toBe(true);
      expect(s).toMatchObject({ capacity: 14, durationMin: 75, name: body.name });
    }
    const dates = list.map((s: any) => sofiaParts(new Date(s.startsAt)).date);
    expect(new Set(dates).size).toBe(dates.length); // no duplicates
    const listed = await call('GET', '/api/admin/templates', { token: (await admin()).token });
    expect(listed.body.map((t: any) => t.id)).toContain(tpl.id);
  });

  test('AC-28 default capacity is 14 and validation errors', async () => {
    const a = await admin();
    const base = { name: `T ${uid()}`, instructorId: instr.id, weekday: 2, startTime: '10:00', durationMin: 60, validFrom: sofiaToday() };
    const ok = await call('POST', '/api/admin/templates', { token: a.token, body: base });
    expect(ok.status).toBe(201);
    expect(ok.body.capacity).toBe(14);
    for (const bad of [{ weekday: 0 }, { weekday: 8 }, { startTime: '25:00' }, { startTime: '9am' }, { durationMin: 10 }, { durationMin: 241 }, { capacity: 0 }, { capacity: 51 }, { name: '' }, { instructorId: 'nope' }, { validFrom: 'tomorrow' }]) {
      const r = await call('POST', '/api/admin/templates', { token: a.token, body: { ...base, ...bad } });
      expect([400, 404], JSON.stringify(bad)).toContain(r.status);
    }
    const client = await createUser('CLIENT');
    const notInstructor = await call('POST', '/api/admin/templates', { token: a.token, body: { ...base, instructorId: client.id } });
    expect(notInstructor.status).toBeGreaterThanOrEqual(400);
  });

  test('AC-29 edit applies to future sessions without bookings; sessions with bookings keep their time', async () => {
    const { tpl } = await newTemplate();
    const a = await admin();
    const before = await templateSessions(tpl.id);
    const booked = before[0];
    const client = await clientWithCard();
    expect((await book(client, booked.id)).status).toBe(201);

    const r = await call('PATCH', `/api/admin/templates/${tpl.id}`, {
      token: a.token, body: { name: `${tpl.name} v2`, instructorId: instr2.id, durationMin: 90, capacity: 10, startTime: '19:15' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startTime: '19:15', capacity: 10, durationMin: 90, instructor: { id: instr2.id } });

    const after = await templateSessions(tpl.id);
    const b = after.find((s: any) => s.id === booked.id);
    expect(b, 'booked session still exists').toBeTruthy();
    expect(b.startsAt).toBe(booked.startsAt); // time kept
    expect(b).toMatchObject({ name: `${tpl.name} v2`, durationMin: 90, capacity: 10, instructor: { id: instr2.id }, bookedCount: 1 });
    const others = after.filter((s: any) => s.id !== booked.id);
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const s of others) {
      expect(sofiaParts(new Date(s.startsAt)).time).toBe('19:15');
      expect(s).toMatchObject({ name: `${tpl.name} v2`, durationMin: 90, capacity: 10, instructor: { id: instr2.id } });
    }
  });

  test('AC-29 weekday change moves unbooked sessions; CAPACITY_BELOW_BOOKED; deactivate removes unbooked future sessions only', async () => {
    const { tpl } = await newTemplate();
    const a = await admin();
    const sessions = await templateSessions(tpl.id);
    const target = sessions[0];
    const c1 = await clientWithCard();
    const c2 = await clientWithCard();
    await book(c1, target.id);
    await book(c2, target.id);

    const low = await call('PATCH', `/api/admin/templates/${tpl.id}`, { token: a.token, body: { capacity: 1 } });
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
    const ok = await call('PATCH', `/api/admin/templates/${tpl.id}`, { token: a.token, body: { capacity: 2 } });
    expect(ok.status).toBe(200);

    const newDay = (tpl.weekday % 7) + 1;
    const moved = await call('PATCH', `/api/admin/templates/${tpl.id}`, { token: a.token, body: { weekday: newDay } });
    expect(moved.status).toBe(200);
    const afterMove = await templateSessions(tpl.id);
    for (const s of afterMove.filter((x: any) => x.id !== target.id)) {
      expect(isoWeekday(sofiaParts(new Date(s.startsAt)).date)).toBe(newDay);
    }

    const off = await call('PATCH', `/api/admin/templates/${tpl.id}`, { token: a.token, body: { active: false } });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    const left = await templateSessions(tpl.id);
    expect(left.map((s: any) => s.id)).toEqual([target.id]); // only the one with bookings survives
    expect(left[0].bookedCount).toBe(2);
  });
});

test.describe('AC-30 / AC-31 single sessions', () => {
  test('AC-30 move/instructor/capacity change only that session; bookings stay; CAPACITY_BELOW_BOOKED', async () => {
    const { tpl } = await newTemplate();
    const a = await admin();
    const list = await templateSessions(tpl.id);
    const [s, sibling] = list;
    const c1 = await clientWithCard();
    const c2 = await clientWithCard();
    const b1 = await book(c1, s.id);
    await book(c2, s.id);
    const newStart = sofiaToUtc(addDaysStr(sofiaToday(), 5), '07:45');
    const r = await call('PATCH', `/api/admin/sessions/${s.id}`, { token: a.token, body: { startsAt: newStart.toISOString(), instructorId: instr2.id, capacity: 3 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startsAt: newStart.toISOString(), capacity: 3, bookedCount: 2, instructor: { id: instr2.id } });
    const sib = (await call('GET', `/api/sessions/${sibling.id}`)).body;
    expect(sib).toMatchObject({ startsAt: sibling.startsAt, capacity: 14, instructor: { id: instr.id } });
    const up = await call('GET', '/api/me/bookings?scope=upcoming', { token: c1.token });
    expect(up.body[0]).toMatchObject({ id: b1.body.id, status: 'BOOKED' });
    expect(up.body[0].session.startsAt).toBe(newStart.toISOString());
    const low = await call('PATCH', `/api/admin/sessions/${s.id}`, { token: a.token, body: { capacity: 1 } });
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
    await call('POST', `/api/admin/sessions/${s.id}/cancel`, { token: a.token, body: {} });
    const dead = await call('PATCH', `/api/admin/sessions/${s.id}`, { token: a.token, body: { capacity: 5 } });
    expect(dead.status).toBe(409);
    expect(dead.body.error.code).toBe('SESSION_CANCELLED');
  });

  test('AC-31 one-off session appears in the schedule like any other', async () => {
    const name = `One-off ${uid()}`;
    const start = inDays(4);
    const s = await createSession({ name, instructorId: instr.id, startsAt: start, capacity: 5, durationMin: 45 });
    expect(s).toMatchObject({ name, capacity: 5, durationMin: 45, templateId: null, status: 'SCHEDULED' });
    const today = sofiaToday();
    const list = await call('GET', `/api/sessions?from=${today}&to=${addDaysStr(today, 14)}`);
    expect(list.body.find((x: any) => x.id === s.id)).toMatchObject({ name, freeSpots: 5 });
    const a = await admin();
    const bad = await call('POST', '/api/admin/sessions', { token: a.token, body: { name, instructorId: instr.id, startsAt: 'soon', durationMin: 45, capacity: 5 } });
    expect(bad.status).toBe(400);
    const att = await call('GET', `/api/admin/sessions/${s.id}/attendees`, { token: a.token });
    expect(att.body).toMatchObject({ attendees: [], waitlist: [] });
    expect(att.body.session.id).toBe(s.id);
  });
});

test('AC-28 recurring sessions keep Sofia local time (DST-safe) for every generated week', async () => {
  // Generation is 15 days ahead, so the DST switch (last Sunday of Mar/Oct) is only inside the
  // window part of the year; the assertion (local time never shifts) holds either way.
  const { tpl } = await newTemplate({ startTime: '00:30', weekday: 1 });
  const list = await templateSessions(tpl.id);
  expect(list.length).toBeGreaterThanOrEqual(2);
  for (const s of list) {
    const p = sofiaParts(new Date(s.startsAt));
    expect(p.time).toBe('00:30');
    expect(isoWeekday(p.date)).toBe(1);
  }
});
