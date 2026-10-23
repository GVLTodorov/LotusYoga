import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { ACTIVE_STATUSES, isCardActive, sessionDtos, sessionInclude } from '../dto.js';
import { guards, parse, requireMe } from '../http.js';
import * as s from '../schemas.js';
import { addWalkIn, attendeeDto, attendeeSelect, setAttendance } from '../services/booking.js';
import { endExclusiveOfDay, sofiaDate, startOfDay } from '../time.js';

const phoneHint = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d ? `•••${d.slice(-3)}` : '';
};

export function instructorRoutes(app: FastifyInstance, ctx: Ctx) {
  const { guard } = guards(app, ctx);
  const instructor = guard('instructor');
  const idParam = (req: { params: unknown }) => parse(s.id, (req.params as { id: string }).id);

  app.get('/instructor/sessions', { preHandler: instructor }, async (req) => {
    const me = requireMe(req);
    const q = parse(s.instructorSessionsQuery, req.query);
    const now = ctx.now();
    const date = q.date ?? sofiaDate(now);
    const rows = await ctx.prisma.classSession.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { gte: startOfDay(date), lt: endExclusiveOfDay(date) },
        ...(me.role === 'ADMIN' ? {} : { instructorId: me.id }),
      },
      include: sessionInclude,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    const dtos = await sessionDtos(ctx.prisma, rows, now);
    const bookings = await ctx.prisma.booking.findMany({
      where: { sessionId: { in: rows.map((r) => r.id) }, status: { in: [...ACTIVE_STATUSES] } },
      include: attendeeSelect,
    });
    return dtos.map((session) => ({
      session,
      attendees: bookings
        .filter((b) => b.sessionId === session.id)
        .map(attendeeDto)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });

  app.patch('/bookings/:id/attendance', { preHandler: instructor }, async (req) => {
    const body = parse(s.attendanceBody, req.body);
    return setAttendance(ctx, requireMe(req), idParam(req), body.status);
  });

  app.get('/instructor/clients', { preHandler: instructor }, async (req) => {
    const { q } = parse(s.clientSearchQuery, req.query);
    const contains = { contains: q, mode: 'insensitive' as const };
    const users = await ctx.prisma.user.findMany({
      where: { role: 'CLIENT', deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] },
      orderBy: { name: 'asc' },
      take: 20,
      include: { cards: true },
    });
    const now = ctx.now();
    return users.map((u) => ({ id: u.id, name: u.name, phoneHint: phoneHint(u.phone), hasValidCard: u.cards.some((c) => isCardActive(c, now)) }));
  });

  app.post('/sessions/:id/walk-ins', { preHandler: instructor }, async (req, reply) => {
    const body = parse(s.walkInBody, req.body);
    const a = await addWalkIn(ctx, requireMe(req), idParam(req), body.userId);
    return reply.status(201).send(a);
  });
}

