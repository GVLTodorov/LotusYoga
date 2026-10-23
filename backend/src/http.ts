import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser, Ctx } from './context.js';
import { badRequest, forbidden, unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    me: AuthUser | null;
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  throw badRequest(
    'Invalid input',
    r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

type Level = 'any' | 'client' | 'instructor' | 'admin';
const allowed: Record<Level, string[]> = {
  any: ['CLIENT', 'INSTRUCTOR', 'ADMIN'],
  client: ['CLIENT'],
  instructor: ['INSTRUCTOR', 'ADMIN'],
  admin: ['ADMIN'],
};

async function resolveUser(app: FastifyInstance, ctx: Ctx, req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  let sub: string;
  try {
    sub = (app.jwt.verify(header.slice(7)) as { sub?: string }).sub ?? '';
  } catch {
    return null;
  }
  if (!sub) return null;
  // role is always read from the database, so demotions / deletions apply immediately
  const u = await ctx.prisma.user.findFirst({ where: { id: sub, deletedAt: null }, select: { id: true, role: true, name: true, blocked: true } });
  return u;
}

export function guards(app: FastifyInstance, ctx: Ctx) {
  if (!app.hasRequestDecorator('me')) app.decorateRequest('me', null);
  const guard = (level: Level) => async (req: FastifyRequest, _reply: FastifyReply) => {
    const me = await resolveUser(app, ctx, req);
    if (!me) throw unauthorized();
    if (!allowed[level].includes(me.role)) throw forbidden();
    req.me = me;
  };
  const optional = async (req: FastifyRequest) => {
    req.me = await resolveUser(app, ctx, req);
  };
  return { guard, optional };
}

export const requireMe = (req: FastifyRequest): AuthUser => {
  if (!req.me) throw unauthorized();
  return req.me;
};
