import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { Ctx } from '../context.js';
import {
  ACTIVE_STATUSES,
  bookingDtos,
  cardDto,
  isCardActive,
  loadSessionDto,
  sessionInclude,
  userDto,
} from '../dto.js';
import { conflictCode, notFound } from '../errors.js';
import { guards, parse, requireMe } from '../http.js';
import * as s from '../schemas.js';
import { createUser, hashPassword } from '../services/accounts.js';
import { attendeeDto, attendeeSelect } from '../services/booking.js';
import { CARD_SPEC, cardExpiry } from '../services/cards.js';
import { cancelSession, createSession, createTemplate, templateDto, updateSession, updateTemplate } from '../services/sessions.js';
import { endOfDay, monthRange, sofiaDate } from '../time.js';

const cardWithEvents = { events: { include: { byUser: { select: { id: true, name: true } } } } } satisfies Prisma.CardInclude;

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { guard } = guards(app, ctx);
  const admin = guard('admin');
  const idParam = (req: { params: unknown }) => parse(s.id, (req.params as { id: string }).id);

  // ------------------------------------------------------------ schedule
  const tplInclude = { instructor: { select: { id: true, name: true } } };

  app.get('/admin/templates', { preHandler: admin }, async () => {
    const rows = await ctx.prisma.template.findMany({ include: tplInclude, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }] });
    return rows.map(templateDto);
  });

  app.post('/admin/templates', { preHandler: admin }, async (req, reply) => {
    const body = parse(s.createTemplateBody, req.body);
    return reply.status(201).send(await createTemplate(ctx, body));
  });

  app.patch('/admin/templates/:id', { preHandler: admin }, async (req) => {
    const body = parse(s.patchTemplateBody, req.body);
    return updateTemplate(ctx, idParam(req), body);
  });

  app.post('/admin/sessions', { preHandler: admin }, async (req, reply) => {
    const body = parse(s.createSessionBody, req.body);
    return reply.status(201).send(await createSession(ctx, body));
  });

  app.patch('/admin/sessions/:id', { preHandler: admin }, async (req) => {
    const body = parse(s.patchSessionBody, req.body);
    return updateSession(ctx, idParam(req), body);
  });

  app.post('/admin/sessions/:id/cancel', { preHandler: admin }, async (req) => {
    const body = parse(s.cancelSessionBody, req.body);
    return cancelSession(ctx, idParam(req), body.reason);
  });

  app.get('/admin/sessions/:id/attendees', { preHandler: admin }, async (req) => {
    const id = idParam(req);
    const session = await loadSessionDto(ctx.prisma, id, ctx.now());
    if (!session) throw notFound('Session not found');
    const bookings = await ctx.prisma.booking.findMany({ where: { sessionId: id, status: { in: [...ACTIVE_STATUSES] } }, include: attendeeSelect });
    const waiting = await ctx.prisma.waitlistEntry.findMany({
      where: { sessionId: id, status: 'WAITING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: { select: { id: true, name: true } } },
    });
    return {
      session,
      attendees: bookings.map(attendeeDto).sort((a, b) => a.name.localeCompare(b.name)),
      waitlist: waiting.map((w, i) => ({ id: w.id, userId: w.user.id, name: w.user.name, position: i + 1 })),
    };
  });

  // ------------------------------------------------------------ users & cards
  app.get('/admin/users', { preHandler: admin }, async (req) => {
    const q = parse(s.adminUsersQuery, req.query);
    const now = ctx.now();
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (q.role) where.role = q.role;
    if (q.q) {
      const c = { contains: q.q, mode: 'insensitive' as const };
      where.OR = [{ name: c }, { email: c }, { phone: c }];
    }
    const [total, rows] = await Promise.all([
      ctx.prisma.user.count({ where }),
      ctx.prisma.user.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { cards: { orderBy: { expiresAt: 'asc' } } },
      }),
    ]);
    return {
      total,
      items: rows.map((u) => {
        const card = u.cards.find((c) => isCardActive(c, now));
        return { ...userDto(u), activeCard: card ? cardDto(card, now) : null };
      }),
    };
  });

  app.post('/admin/users', { preHandler: admin }, async (req, reply) => {
    const body = parse(s.adminCreateUserBody, req.body);
    return reply.status(201).send(userDto(await createUser(ctx, body)));
  });

  app.patch('/admin/users/:id', { preHandler: admin }, async (req) => {
    const me = requireMe(req);
    const id = idParam(req);
    const { password, ...body } = parse(s.adminPatchUserBody, req.body);
    const target = await ctx.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw notFound('User not found');
    if (id === me.id && body.role && body.role !== 'ADMIN') throw conflictCode('INVALID_STATE');
    const u = await ctx.prisma.user.update({
      where: { id },
      data: { ...body, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    });
    return userDto(u);
  });

  app.get('/admin/users/:id/history', { preHandler: admin }, async (req) => {
    const id = idParam(req);
    const now = ctx.now();
    const user = await ctx.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound('User not found');
    const [cards, bookings] = await Promise.all([
      ctx.prisma.card.findMany({ where: { userId: id }, include: cardWithEvents, orderBy: { createdAt: 'desc' } }),
      ctx.prisma.booking.findMany({ where: { userId: id }, include: { session: { include: sessionInclude } }, orderBy: [{ session: { startsAt: 'desc' } }, { id: 'asc' }] }),
    ]);
    return {
      user: userDto(user),
      cards: cards.map((c) => cardDto(c, now, true)),
      bookings: await bookingDtos(ctx.prisma, bookings, now),
      stats: {
        attended: bookings.filter((b) => b.status === 'ATTENDED').length,
        noShows: bookings.filter((b) => b.status === 'NO_SHOW').length,
        lateCancels: bookings.filter((b) => b.status === 'LATE_CANCELLED').length,
      },
    };
  });

  app.post('/admin/users/:id/cards', { preHandler: admin }, async (req, reply) => {
    const me = requireMe(req);
    const id = idParam(req);
    const body = parse(s.createCardBody, req.body);
    const now = ctx.now();
    const user = await ctx.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound('User not found');
    const validFrom = body.validFrom ?? sofiaDate(now);
    const expiresAt = cardExpiry(validFrom, body.type);
    const card = await ctx.prisma.$transaction(async (tx) => {
      const c = await tx.card.create({
        data: {
          userId: id,
          type: body.type,
          totalClasses: CARD_SPEC[body.type].classes,
          validFrom,
          expiresAt,
          paymentMethod: body.paymentMethod,
          priceBgn: body.priceBgn ?? null,
        },
      });
      await tx.cardEvent.create({ data: { cardId: c.id, type: 'CREATED', newExpiresAt: expiresAt, byUserId: me.id } });
      return c;
    });
    return reply.status(201).send(cardDto(card, now));
  });

  app.patch('/admin/cards/:id', { preHandler: admin }, async (req) => {
    const me = requireMe(req);
    const id = idParam(req);
    const body = parse(s.patchCardBody, req.body);
    const now = ctx.now();
    const card = await ctx.prisma.card.findUnique({ where: { id } });
    if (!card) throw notFound('Card not found');
    const newExpiresAt = endOfDay(body.expiresAt);
    const updated = await ctx.prisma.$transaction(async (tx) => {
      await tx.card.update({ where: { id }, data: { expiresAt: newExpiresAt } });
      await tx.cardEvent.create({
        data: { cardId: id, type: 'EXPIRY_CHANGED', oldExpiresAt: card.expiresAt, newExpiresAt, note: body.note ?? null, byUserId: me.id },
      });
      return tx.card.findUniqueOrThrow({ where: { id }, include: cardWithEvents });
    });
    return cardDto(updated, now, true);
  });

  // ------------------------------------------------------------ reports
  app.get('/admin/reports/monthly', { preHandler: admin }, async (req) => {
    const { month } = parse(s.monthlyQuery, req.query);
    const { start, end } = monthRange(month);
    const now = ctx.now();
    const held = { status: 'SCHEDULED' as const, startsAt: { gte: start, lt: end, lte: now } };
    const [classesHeld, attended, noShowCount, sold] = await Promise.all([
      ctx.prisma.classSession.count({ where: held }),
      ctx.prisma.booking.count({ where: { status: 'ATTENDED', session: held } }),
      ctx.prisma.booking.count({ where: { status: 'NO_SHOW', session: held } }),
      ctx.prisma.card.groupBy({
        by: ['type'],
        where: { createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
    ]);
    const cardsSold = { SINGLE: 0, PACK_8: 0, PACK_12: 0, UNLIMITED_MONTH: 0, total: 0 };
    for (const g of sold) {
      cardsSold[g.type] = g._count._all;
      cardsSold.total += g._count._all;
    }
    const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
    return {
      month,
      classesHeld,
      avgAttendance: classesHeld ? round(attended / classesHeld, 2) : 0,
      noShowCount,
      noShowRate: attended + noShowCount ? round(noShowCount / (attended + noShowCount), 3) : 0,
      cardsSold,
    };
  });
}
