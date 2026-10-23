import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, processOutbox, queueEmail } from '../src/email/outbox.js';
import { sendCardAlerts, sendReminders, tick, type SchedulerState } from '../src/services/jobs.js';
import { HOUR, MIN } from '../src/time.js';
import { inHours, makeEnv, mkCard, mkSession, mkUser, prisma, resetDb, T0, type TestEnv } from './helpers.js';

let env: TestEnv;
let teacher: Awaited<ReturnType<typeof mkUser>>;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env.app.close();
});
beforeEach(async () => {
  await resetDb();
  env.setNow(T0);
  env.mailer.sent = [];
  env.mailer.fail = false;
  teacher = await mkUser(env, 'INSTRUCTOR');
});

async function bookFor(userId: string, startsAt: Date, status: 'BOOKED' | 'CANCELLED' = 'BOOKED', sessionStatus: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') {
  const s = await mkSession(teacher.user.id, startsAt, { status: sessionStatus });
  return prisma.booking.create({ data: { userId, sessionId: s.id, status } });
}

describe('reminders (AC-40)', () => {
  it('reminds every booked session of tomorrow (Sofia day), across the autumn DST change', async () => {
    const u = await mkUser(env, 'CLIENT', { lang: 'bg' });
    // now = Sat 2026-10-24 18:00 Sofia (EEST). Tomorrow 2026-10-25 is a 25 h day.
    env.setNow('2026-10-24T15:00:00Z');
    const first = await bookFor(u.user.id, new Date('2026-10-24T21:30:00Z')); // 10-25 00:30 EEST
    const last = await bookFor(u.user.id, new Date('2026-10-25T21:30:00Z')); // 10-25 23:30 EET
    const today = await bookFor(u.user.id, new Date('2026-10-24T20:30:00Z')); // 10-24 23:30 EEST
    const dayAfter = await bookFor(u.user.id, new Date('2026-10-25T22:30:00Z')); // 10-26 00:30 EET
    const cancelled = await bookFor(u.user.id, new Date('2026-10-25T10:00:00Z'), 'CANCELLED');
    const sessionCancelled = await bookFor(u.user.id, new Date('2026-10-25T11:00:00Z'), 'BOOKED', 'CANCELLED');
    expect(await sendReminders(env.ctx)).toBe(2);
    const reminded = await prisma.booking.findMany({ where: { reminderSentAt: { not: null } } });
    expect(reminded.map((b) => b.id).sort()).toEqual([first.id, last.id].sort());
    expect([today.id, dayAfter.id, cancelled.id, sessionCancelled.id].some((id) => reminded.some((b) => b.id === id))).toBe(false);
    const mails = await prisma.emailOutbox.findMany();
    expect(mails.every((m) => m.template === 'REMINDER' && m.lang === 'bg')).toBe(true);
  });

  it('works across the spring DST change (23 h day)', async () => {
    const u = await mkUser(env);
    env.setNow('2026-03-28T16:00:00Z'); // Sat 18:00 EET
    await bookFor(u.user.id, new Date('2026-03-29T20:30:00Z')); // 03-29 23:30 EEST: tomorrow
    await bookFor(u.user.id, new Date('2026-03-29T21:30:00Z')); // 03-30 00:30 EEST: day after
    await bookFor(u.user.id, new Date('2026-03-28T20:00:00Z')); // today 22:00 EET
    expect(await sendReminders(env.ctx)).toBe(1);
  });

  it('is idempotent', async () => {
    const u = await mkUser(env);
    await bookFor(u.user.id, new Date('2026-10-24T10:00:00Z'));
    env.setNow('2026-10-23T15:00:00Z'); // 18:00 EEST
    const runs = await Promise.all([sendReminders(env.ctx), sendReminders(env.ctx)]);
    expect(runs[0] + runs[1]).toBe(1);
    expect(await sendReminders(env.ctx)).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(1);
  });

  it('does not remind deleted accounts', async () => {
    const u = await mkUser(env);
    await bookFor(u.user.id, new Date('2026-10-24T10:00:00Z'));
    await prisma.user.update({ where: { id: u.user.id }, data: { deletedAt: new Date() } });
    expect(await sendReminders(env.ctx)).toBe(0);
  });
});

describe('card alerts (AC-40)', () => {
  it('sends "1 class left" once per card', async () => {
    const u = await mkUser(env);
    await mkCard(u.user.id, 'PACK_8', { used: 7 });
    await mkCard(u.user.id, 'PACK_8', { used: 5 });
    expect(await sendCardAlerts(env.ctx)).toEqual({ low: 1, expiring: 0 });
    expect(await sendCardAlerts(env.ctx)).toEqual({ low: 0, expiring: 0 });
    expect((await prisma.emailOutbox.findFirstOrThrow()).template).toBe('CARD_LOW');
  });

  it('sends "expires in 3 days" once, only when the card is still usable', async () => {
    const u = await mkUser(env);
    const soon = new Date(T0.getTime() + 2.5 * 24 * HOUR);
    await mkCard(u.user.id, 'PACK_8', { expiresAt: soon, used: 2 });
    await mkCard(u.user.id, 'UNLIMITED_MONTH', { expiresAt: soon });
    await mkCard(u.user.id, 'PACK_8', { expiresAt: soon, used: 8 }); // nothing left
    await mkCard(u.user.id, 'PACK_8', { expiresAt: new Date(T0.getTime() + 5 * 24 * HOUR) }); // too far
    await mkCard(u.user.id, 'PACK_8', { expiresAt: new Date(T0.getTime() - HOUR) }); // already expired
    expect(await sendCardAlerts(env.ctx)).toEqual({ low: 0, expiring: 2 });
    expect(await sendCardAlerts(env.ctx)).toEqual({ low: 0, expiring: 0 });
    expect((await prisma.emailOutbox.findMany()).every((m) => m.template === 'CARD_EXPIRING')).toBe(true);
    env.setNow(new Date(T0.getTime() + 2 * 24 * HOUR)); // later: only the card that was too far away is due now
    expect((await sendCardAlerts(env.ctx)).expiring).toBe(1);
  });
});

describe('scheduler tick', () => {
  it('runs daily jobs once per Sofia day after their hour', async () => {
    const u = await mkUser(env);
    await mkCard(u.user.id, 'PACK_8', { used: 7 });
    await bookFor(u.user.id, new Date('2026-10-24T10:00:00Z'));
    const state: SchedulerState = {};
    env.setNow('2026-10-23T05:00:00Z'); // 08:00 Sofia: generation only
    await tick(env.ctx, state);
    expect(state).toEqual({ generated: '2026-10-23' });
    expect(await prisma.emailOutbox.count()).toBe(0);
    env.setNow('2026-10-23T06:00:00Z'); // 09:00: card alerts
    await tick(env.ctx, state);
    expect(state.carded).toBe('2026-10-23');
    env.setNow('2026-10-23T15:00:00Z'); // 18:00: reminders
    await tick(env.ctx, state);
    expect(state.reminded).toBe('2026-10-23');
    const templates = (await prisma.emailOutbox.findMany()).map((m) => m.template).sort();
    expect(templates).toEqual(['CARD_LOW', 'REMINDER']);
    expect(env.mailer.sent).toHaveLength(2); // the worker part of the tick delivered them
    await tick(env.ctx, state);
    expect(await prisma.emailOutbox.count()).toBe(2);
  });

  it('expires waiting entries when booking closes', async () => {
    const u = await mkUser(env);
    const s = await mkSession(teacher.user.id, inHours(1), { capacity: 1 });
    const w = await prisma.waitlistEntry.create({ data: { userId: u.user.id, sessionId: s.id } });
    await tick(env.ctx, {});
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('WAITING');
    env.setNow(new Date(s.startsAt.getTime() - 30 * MIN));
    await tick(env.ctx, {});
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('EXPIRED');
  });
});

describe('email outbox worker (AC-41)', () => {
  const queue = (to = 'a@x.bg') => queueEmail(prisma, 'http://app', { to, lang: 'en', template: 'REMINDER', payload: { name: 'A', sessionName: 'Hatha', startsAt: '2026-11-03T16:30:00.000Z' } });

  it('sends pending mail and marks it SENT', async () => {
    await queue();
    expect(await processOutbox(env.ctx)).toEqual({ sent: 1, failed: 0 });
    expect(env.mailer.sent[0]).toMatchObject({ to: 'a@x.bg' });
    expect(env.mailer.sent[0].subject).toContain('Hatha');
    expect(env.mailer.sent[0].text).toContain('http://app');
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(row.sentAt).not.toBeNull();
    expect(await processOutbox(env.ctx)).toEqual({ sent: 0, failed: 0 });
  });

  it('retries with backoff and gives up as FAILED after max attempts', async () => {
    env.mailer.fail = true;
    await queue();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await processOutbox(env.ctx)).toEqual({ sent: 0, failed: 1 });
      const row = await prisma.emailOutbox.findFirstOrThrow();
      expect(row.attempts).toBe(attempt);
      expect(row.status).toBe(attempt === MAX_ATTEMPTS ? 'FAILED' : 'PENDING');
      expect(row.lastError).toContain('smtp down');
      if (attempt < MAX_ATTEMPTS) {
        expect(await processOutbox(env.ctx)).toEqual({ sent: 0, failed: 0 }); // backoff: not due yet
        env.setNow(new Date(env.ctx.now().getTime() + 20 * MIN));
      }
    }
    env.mailer.fail = false;
    env.setNow(new Date(env.ctx.now().getTime() + 24 * HOUR));
    expect(await processOutbox(env.ctx)).toEqual({ sent: 0, failed: 0 });
  });

  it('recovers when the mail server comes back', async () => {
    env.mailer.fail = true;
    await queue();
    await processOutbox(env.ctx);
    env.mailer.fail = false;
    env.setNow(new Date(T0.getTime() + 5 * MIN));
    expect(await processOutbox(env.ctx)).toEqual({ sent: 1, failed: 0 });
  });

  it('two workers never send the same mail twice', async () => {
    for (let i = 0; i < 6; i++) await queue(`u${i}@x.bg`);
    await Promise.all([processOutbox(env.ctx, 3), processOutbox(env.ctx, 3), processOutbox(env.ctx, 3)]);
    await processOutbox(env.ctx);
    expect(env.mailer.sent.map((m) => m.to).sort()).toEqual(['u0@x.bg', 'u1@x.bg', 'u2@x.bg', 'u3@x.bg', 'u4@x.bg', 'u5@x.bg']);
  });

  it('a booking succeeds while the mail server is down', async () => {
    env.mailer.fail = true;
    const u = await mkUser(env);
    await mkCard(u.user.id);
    const s = await mkSession(teacher.user.id, inHours(30));
    const res = await env.api().post(`/api/sessions/${s.id}/bookings`).set(u.auth);
    expect(res.status).toBe(201);
    await processOutbox(env.ctx);
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('PENDING');
  });
});
