import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { cardDto, isCardActive, sessionDto, sessionDtos, sessionInclude } from '../dto.js';
import { badRequest, notFound } from '../errors.js';
import { guards, parse, requireMe } from '../http.js';
import * as s from '../schemas.js';
import {
  bookSession,
  cancelBooking,
  cancelPreview,
  joinWaitlist,
  leaveWaitlist,
  listMyBookings,
  listMyWaitlist,
} from '../services/booking.js';
import { addDays, diffDays, endExclusiveOfDay, mondayOf, sofiaDate, startOfDay } from '../time.js';

export function clientRoutes(app: FastifyInstance, ctx: Ctx) {
  const { guard, optional } = guards(app, ctx);
  const client = guard('client');
  const idParam = (req: { params: unknown }) => parse(s.id, (req.params as { id: string }).id);

  app.get('/sessions', { preHandler: optional }, async (req) => {
    const q = parse(s.sessionsQuery, req.query);
    const now = ctx.now();
    const from = q.from ?? mondayOf(sofiaDate(now));
    const to = q.to ?? addDays(from, 13);
    if (diffDays(from, to) < 0) throw badRequest('"to" must not be before "from"', [{ path: 'to', message: 'must not be before from' }]);
    if (diffDays(from, to) + 1 > 15) throw badRequest('Range is limited to 15 days', [{ path: 'to', message: 'range is limited to 15 days' }]);
    const rows = await ctx.prisma.classSession.findMany({
      where: { startsAt: { gte: startOfDay(from), lt: endExclusiveOfDay(to) } },
      include: sessionInclude,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return sessionDtos(ctx.prisma, rows, now, req.me);
  });

  app.get('/sessions/:id', { preHandler: optional }, async (req) => {
    const row = await ctx.prisma.classSession.findUnique({ where: { id: idParam(req) }, include: sessionInclude });
    if (!row) throw notFound('Session not found');
    return sessionDto(ctx.prisma, row, ctx.now(), req.me);
  });

  app.post('/sessions/:id/bookings', { preHandler: client }, async (req, reply) => {
    const b = await bookSession(ctx, requireMe(req).id, idParam(req));
    return reply.status(201).send(b);
  });

  app.get('/me/bookings', { preHandler: client }, async (req) => {
    const q = parse(s.bookingsQuery, req.query);
    return listMyBookings(ctx, requireMe(req).id, q.scope);
  });

  app.get('/bookings/:id/cancel-preview', { preHandler: client }, async (req) => cancelPreview(ctx, requireMe(req).id, idParam(req)));
  app.post('/bookings/:id/cancel', { preHandler: client }, async (req) => cancelBooking(ctx, requireMe(req).id, idParam(req)));

  app.post('/sessions/:id/waitlist', { preHandler: client }, async (req, reply) => {
    const w = await joinWaitlist(ctx, requireMe(req).id, idParam(req));
    return reply.status(201).send(w);
  });
  app.delete('/waitlist/:id', { preHandler: client }, async (req, reply) => {
    await leaveWaitlist(ctx, requireMe(req).id, idParam(req));
    return reply.status(204).send();
  });
  app.get('/me/waitlist', { preHandler: client }, async (req) => listMyWaitlist(ctx, requireMe(req).id));

  app.get('/me/cards', { preHandler: client }, async (req) => {
    const now = ctx.now();
    const cards = await ctx.prisma.card.findMany({ where: { userId: requireMe(req).id } });
    return cards
      .map((c) => ({ c, active: isCardActive(c, now) }))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.c.expiresAt.getTime() - a.c.expiresAt.getTime())
      .map(({ c }) => cardDto(c, now));
  });
}
