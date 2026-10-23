import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { userDto } from '../dto.js';
import { forbidden, notFound } from '../errors.js';
import { guards, parse, requireMe } from '../http.js';
import * as s from '../schemas.js';
import { authenticate, createUser, deleteAccount } from '../services/accounts.js';

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { guard } = guards(app, ctx);
  const limit = { config: { rateLimit: { max: ctx.config.rateLimitMax, timeWindow: '15 minutes' } } };
  const token = (user: { id: string; role: string }) => app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '30d' });

  app.post('/auth/register', limit, async (req, reply) => {
    const body = parse(s.registerBody, req.body);
    const user = await createUser(ctx, { ...body, role: 'CLIENT' });
    return reply.status(201).send({ token: token(user), user: userDto(user) });
  });

  app.post('/auth/login', limit, async (req) => {
    const body = parse(s.loginBody, req.body);
    const user = await authenticate(ctx, body.email, body.password);
    return { token: token(user), user: userDto(user) };
  });

  app.get('/me', { preHandler: guard('any') }, async (req) => {
    const u = await ctx.prisma.user.findUnique({ where: { id: requireMe(req).id } });
    if (!u) throw notFound();
    return userDto(u);
  });

  app.patch('/me', { preHandler: guard('any') }, async (req) => {
    const body = parse(s.patchMeBody, req.body);
    const u = await ctx.prisma.user.update({ where: { id: requireMe(req).id }, data: body });
    return userDto(u);
  });

  app.delete('/me', { preHandler: guard('any') }, async (req, reply) => {
    const me = requireMe(req);
    if (me.role !== 'CLIENT') throw forbidden('Only client accounts can be deleted here');
    const body = parse(s.deleteMeBody, req.body);
    const full = await ctx.prisma.user.findUnique({ where: { id: me.id }, select: { email: true } });
    await authenticate(ctx, full!.email, body.password); // 401 INVALID_CREDENTIALS on wrong password
    await deleteAccount(ctx, me.id);
    return reply.status(204).send();
  });
}
