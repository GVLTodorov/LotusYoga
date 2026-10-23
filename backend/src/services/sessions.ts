import type { Db, Tx, Ctx } from '../context.js';
import { ACTIVE_STATUSES, sessionDto, sessionInclude } from '../dto.js';
import { badRequest, conflictCode, notFound } from '../errors.js';
import { queueEmail } from '../email/outbox.js';
import { addDays, isoWeekday, sofiaDate, sofiaToUtc } from '../time.js';
import { activeCount, lockSession, promoteWaitlist } from './booking.js';
import { returnClass } from './cards.js';

export const GENERATE_AHEAD_DAYS = 15;

/** Create missing sessions for active templates up to 15 days ahead. Idempotent (unique templateId+occurrenceDate). */
export async function generateSessions(db: Db, now: Date, templateId?: string): Promise<number> {
  const templates = await db.template.findMany({ where: { active: true, ...(templateId ? { id: templateId } : {}) } });
  const today = sofiaDate(now);
  const horizon = addDays(today, GENERATE_AHEAD_DAYS);
  let created = 0;
  for (const t of templates) {
    const data = [];
    for (let d = t.validFrom > today ? t.validFrom : today; d <= horizon; d = addDays(d, 1)) {
      if (isoWeekday(d) !== t.weekday) continue;
      const startsAt = sofiaToUtc(d, t.startTime);
      if (startsAt <= now) continue;
      data.push({
        templateId: t.id,
        occurrenceDate: d,
        name: t.name,
        startsAt,
        durationMin: t.durationMin,
        capacity: t.capacity,
        instructorId: t.instructorId,
      });
    }
    if (data.length) created += (await db.classSession.createMany({ data, skipDuplicates: true })).count;
  }
  return created;
}

export async function assertInstructor(db: Db, id: string) {
  const u = await db.user.findFirst({ where: { id, deletedAt: null, role: { in: ['INSTRUCTOR', 'ADMIN'] } } });
  if (!u) throw badRequest('Instructor not found', [{ path: 'instructorId', message: 'must be an existing instructor or admin' }]);
}

export function templateDto(t: {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  durationMin: number;
  capacity: number;
  validFrom: string;
  active: boolean;
  instructor: { id: string; name: string };
}) {
  return {
    id: t.id,
    name: t.name,
    instructor: t.instructor,
    weekday: t.weekday,
    startTime: t.startTime,
    durationMin: t.durationMin,
    capacity: t.capacity,
    validFrom: t.validFrom,
    active: t.active,
  };
}

const instructorRef = { select: { id: true, name: true } };

export interface TemplateInput {
  name: string;
  instructorId: string;
  weekday: number;
  startTime: string;
  durationMin: number;
  capacity: number;
  validFrom: string;
}

export async function createTemplate(ctx: Ctx, input: TemplateInput) {
  const now = ctx.now();
  return ctx.prisma.$transaction(async (tx) => {
    await assertInstructor(tx, input.instructorId);
    const t = await tx.template.create({ data: input, include: { instructor: instructorRef } });
    await generateSessions(tx, now, t.id);
    return templateDto(t);
  });
}

const BOOKED_HISTORY = [...ACTIVE_STATUSES, 'LATE_CANCELLED'] as const;

export async function updateTemplate(ctx: Ctx, id: string, patch: Partial<TemplateInput> & { active?: boolean }) {
  const now = ctx.now();
  return ctx.prisma.$transaction(async (tx) => {
    const before = await tx.template.findUnique({ where: { id } });
    if (!before) throw notFound('Template not found');
    if (patch.instructorId) await assertInstructor(tx, patch.instructorId);

    // lock future sessions of this template so bookings cannot sneak in while we reshape them
    await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE "templateId" = ${id} AND "startsAt" > ${now} FOR UPDATE`;
    const future = await tx.classSession.findMany({ where: { templateId: id, startsAt: { gt: now }, status: 'SCHEDULED' } });
    const ids = future.map((s) => s.id);
    const counts = await tx.booking.groupBy({ by: ['sessionId'], where: { sessionId: { in: ids }, status: { in: [...ACTIVE_STATUSES] } }, _count: { _all: true } });
    if (patch.capacity !== undefined && counts.some((c) => c._count._all > patch.capacity!)) throw conflictCode('CAPACITY_BELOW_BOOKED');
    const withBookings = new Set(
      (await tx.booking.findMany({ where: { sessionId: { in: ids }, status: { in: [...BOOKED_HISTORY] } }, select: { sessionId: true }, distinct: ['sessionId'] })).map((b) => b.sessionId),
    );

    const { active, ...fields } = patch;
    const after = await tx.template.update({ where: { id }, data: { ...fields, ...(active === undefined ? {} : { active }) }, include: { instructor: instructorRef } });
    const removable = ids.filter((s) => !withBookings.has(s));

    if (!after.active) {
      if (removable.length) await tx.classSession.deleteMany({ where: { id: { in: removable } } });
      return templateDto(after);
    }

    const scheduleChanged = after.weekday !== before.weekday || after.startTime !== before.startTime || after.validFrom !== before.validFrom || !before.active;
    // sessions with bookings keep their time but follow name / instructor / duration / capacity
    const keepIds = scheduleChanged ? ids.filter((s) => withBookings.has(s)) : ids;
    if (scheduleChanged && removable.length) await tx.classSession.deleteMany({ where: { id: { in: removable } } });
    if (keepIds.length) {
      await tx.classSession.updateMany({
        where: { id: { in: keepIds } },
        data: { name: after.name, instructorId: after.instructorId, durationMin: after.durationMin, capacity: after.capacity },
      });
    }
    if (scheduleChanged) await generateSessions(tx, now, id);
    if (after.capacity > before.capacity) for (const sid of keepIds) await promoteWaitlist(tx, ctx, now, sid);
    return templateDto(after);
  });
}

// ---------------------------------------------------------------- single sessions

export async function createSession(ctx: Ctx, input: { name: string; instructorId: string; startsAt: Date; durationMin: number; capacity: number }) {
  await assertInstructor(ctx.prisma, input.instructorId);
  const s = await ctx.prisma.classSession.create({ data: input, include: sessionInclude });
  return sessionDto(ctx.prisma, s, ctx.now());
}

export async function updateSession(
  ctx: Ctx,
  id: string,
  patch: { name?: string; instructorId?: string; startsAt?: Date; durationMin?: number; capacity?: number },
) {
  const now = ctx.now();
  if (patch.instructorId) await assertInstructor(ctx.prisma, patch.instructorId);
  await ctx.prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'CANCELLED') throw conflictCode('SESSION_CANCELLED');
    if (patch.capacity !== undefined && (await activeCount(tx, id)) > patch.capacity) throw conflictCode('CAPACITY_BELOW_BOOKED');
    await tx.classSession.update({ where: { id }, data: patch });
    if (patch.capacity !== undefined && patch.capacity > s.capacity) await promoteWaitlist(tx, ctx, now, id);
  });
  return sessionDto(ctx.prisma, await ctx.prisma.classSession.findUniqueOrThrow({ where: { id }, include: sessionInclude }), now);
}

export async function cancelSession(ctx: Ctx, id: string, reason?: string) {
  const now = ctx.now();
  await ctx.prisma.$transaction(async (tx: Tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'CANCELLED') throw conflictCode('SESSION_CANCELLED');
    if (now >= s.startsAt) throw conflictCode('SESSION_STARTED');
    await tx.classSession.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason ?? null } });
    const bookings = await tx.booking.findMany({ where: { sessionId: id, status: 'BOOKED' }, include: { user: true } });
    for (const b of bookings) {
      await tx.booking.update({ where: { id: b.id }, data: { status: 'CLASS_CANCELLED', cancelledAt: now } });
      await returnClass(tx, b.cardId);
      await queueEmail(tx, ctx.config.appUrl, {
        to: b.user.email,
        lang: b.user.lang,
        template: 'SESSION_CANCELLED',
        payload: { name: b.user.name, sessionName: s.name, startsAt: s.startsAt.toISOString(), instructor: s.instructor.name, reason: reason ?? null },
      });
    }
    await tx.waitlistEntry.updateMany({ where: { sessionId: id, status: 'WAITING' }, data: { status: 'CLASS_CANCELLED' } });
  });
  return sessionDto(ctx.prisma, await ctx.prisma.classSession.findUniqueOrThrow({ where: { id }, include: sessionInclude }), now);
}
