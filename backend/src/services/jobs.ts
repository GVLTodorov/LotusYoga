import type { Ctx } from '../context.js';
import { queueEmail } from '../email/outbox.js';
import { processOutbox } from '../email/outbox.js';
import { expireWaitlists } from './booking.js';
import { generateSessions } from './sessions.js';
import { DAY, addDays, endExclusiveOfDay, sofiaDate, sofiaParts, startOfDay } from '../time.js';

/** Reminder for every BOOKED session starting tomorrow (Sofia day, DST-safe). Idempotent via Booking.reminderSentAt. */
export async function sendReminders(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const tomorrow = addDays(sofiaDate(now), 1);
  const bookings = await ctx.prisma.booking.findMany({
    where: {
      status: 'BOOKED',
      reminderSentAt: null,
      user: { deletedAt: null },
      session: { status: 'SCHEDULED', startsAt: { gte: startOfDay(tomorrow), lt: endExclusiveOfDay(tomorrow), gt: now } },
    },
    include: { user: true, session: { include: { instructor: { select: { name: true } } } } },
  });
  let sent = 0;
  for (const b of bookings) {
    await ctx.prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({ where: { id: b.id, reminderSentAt: null, status: 'BOOKED' }, data: { reminderSentAt: now } });
      if (claimed.count !== 1) return;
      await queueEmail(tx, ctx.config.appUrl, {
        to: b.user.email,
        lang: b.user.lang,
        template: 'REMINDER',
        payload: { name: b.user.name, sessionName: b.session.name, startsAt: b.session.startsAt.toISOString(), instructor: b.session.instructor.name },
      });
      sent++;
    });
  }
  return sent;
}

/** "1 class left" (once per card) and "expires in 3 days" (once per card, only if still usable). */
export async function sendCardAlerts(ctx: Ctx): Promise<{ low: number; expiring: number }> {
  const now = ctx.now();
  let low = 0;
  let expiring = 0;
  const cards = await ctx.prisma.card.findMany({
    where: {
      expiresAt: { gt: now },
      user: { deletedAt: null },
      OR: [{ lowAlertSentAt: null }, { expiryAlertSentAt: null }],
    },
    include: { user: true },
  });
  for (const c of cards) {
    const remaining = c.totalClasses === null ? null : c.totalClasses - c.usedClasses;
    if (remaining === 1 && !c.lowAlertSentAt) {
      const r = await ctx.prisma.card.updateMany({ where: { id: c.id, lowAlertSentAt: null }, data: { lowAlertSentAt: now } });
      if (r.count === 1) {
        await queueEmail(ctx.prisma, ctx.config.appUrl, { to: c.user.email, lang: c.user.lang, template: 'CARD_LOW', payload: { name: c.user.name, remaining } });
        low++;
      }
    }
    const usable = remaining === null || remaining > 0;
    if (usable && !c.expiryAlertSentAt && c.expiresAt.getTime() - now.getTime() <= 3 * DAY) {
      const r = await ctx.prisma.card.updateMany({ where: { id: c.id, expiryAlertSentAt: null }, data: { expiryAlertSentAt: now } });
      if (r.count === 1) {
        await queueEmail(ctx.prisma, ctx.config.appUrl, {
          to: c.user.email,
          lang: c.user.lang,
          template: 'CARD_EXPIRING',
          payload: { name: c.user.name, expiresAt: c.expiresAt.toISOString(), remaining },
        });
        expiring++;
      }
    }
  }
  return { low, expiring };
}

export interface SchedulerState {
  generated?: string;
  reminded?: string;
  carded?: string;
}

/** One scheduler pass: always the cheap jobs; daily jobs once per Sofia day after their hour (03:00, 18:00, 09:00). */
export async function tick(ctx: Ctx, state: SchedulerState) {
  const now = ctx.now();
  const today = sofiaDate(now);
  const hour = sofiaParts(now).hour;
  await expireWaitlists(ctx);
  if (hour >= 3 && state.generated !== today) {
    await generateSessions(ctx.prisma, now);
    state.generated = today;
  }
  if (hour >= 9 && state.carded !== today) {
    await sendCardAlerts(ctx);
    state.carded = today;
  }
  if (hour >= 18 && state.reminded !== today) {
    await sendReminders(ctx);
    state.reminded = today;
  }
  await processOutbox(ctx);
}

export function startJobs(ctx: Ctx): () => void {
  const state: SchedulerState = {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx, state);
    } catch (err) {
      ctx.log.error({ err: (err as Error).message }, 'job tick failed');
    } finally {
      running = false;
    }
  };
  generateSessions(ctx.prisma, ctx.now()).catch((err) => ctx.log.error({ err: err.message }, 'initial generation failed'));
  const timer = setInterval(run, 30_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
