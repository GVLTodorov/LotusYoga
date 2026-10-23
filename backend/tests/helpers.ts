import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import type { MailMessage, Mailer } from '../src/email/mailer.js';
import { cardExpiry } from '../src/services/cards.js';
import { HOUR, MIN, sofiaDate } from '../src/time.js';

export const prisma = new PrismaClient();

export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  fail = false;
  async send(msg: MailMessage) {
    if (this.fail) throw new Error('smtp down');
    this.sent.push(msg);
  }
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: Ctx;
  mailer: FakeMailer;
  setNow(d: Date | string): void;
  api: () => ReturnType<typeof request>;
}

/** Friday 2026-10-23 12:00 Sofia (EEST). DST ends two days later, on Sunday 2026-10-25. */
export const T0 = new Date('2026-10-23T09:00:00.000Z');

export async function makeEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  let current = T0;
  const mailer = new FakeMailer();
  const config = { ...loadConfig(), ...overrides };
  const ctx: Ctx = {
    prisma,
    config,
    now: () => current,
    mailer,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
  const app = await buildApp(ctx);
  await app.listen({ port: 0, host: '127.0.0.1' }); // one listener; supertest talks to its URL
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  return {
    app,
    ctx,
    mailer,
    setNow: (d) => {
      current = new Date(d);
    },
    api: () => request(url),
  };
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "EmailOutbox","CardEvent","Booking","WaitlistEntry","Card","ClassSession","Template","User" RESTART IDENTITY CASCADE',
  );
}

let seq = 0;
export async function mkUser(env: TestEnv, role: Role = 'CLIENT', extra: Partial<{ name: string; email: string; lang: 'bg' | 'en'; blocked: boolean; phone: string }> = {}) {
  seq++;
  const user = await prisma.user.create({
    data: {
      email: extra.email ?? `${role.toLowerCase()}${seq}@example.com`,
      passwordHash: await bcrypt.hash('secret123', 4),
      name: extra.name ?? `${role} ${seq}`,
      phone: extra.phone ?? `+359 888 000 ${String(seq).padStart(3, '0')}`,
      role,
      lang: extra.lang ?? 'en',
      blocked: extra.blocked ?? false,
    },
  });
  const token = env.app.jwt.sign({ sub: user.id, role: user.role });
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function mkSession(
  instructorId: string,
  startsAt: Date,
  extra: Partial<{ name: string; capacity: number; durationMin: number; status: 'SCHEDULED' | 'CANCELLED'; templateId: string }> = {},
) {
  return prisma.classSession.create({
    data: { name: extra.name ?? 'Hatha', startsAt, durationMin: extra.durationMin ?? 60, capacity: extra.capacity ?? 14, instructorId, status: extra.status ?? 'SCHEDULED', templateId: extra.templateId },
  });
}

export async function mkCard(
  userId: string,
  type: 'SINGLE' | 'PACK_8' | 'PACK_12' | 'UNLIMITED_MONTH' = 'PACK_8',
  extra: Partial<{ used: number; validFrom: string; expiresAt: Date; createdAt: Date }> = {},
) {
  const total = { SINGLE: 1, PACK_8: 8, PACK_12: 12, UNLIMITED_MONTH: null }[type];
  const validFrom = extra.validFrom ?? sofiaDate(T0);
  return prisma.card.create({
    data: {
      userId,
      type,
      totalClasses: total,
      usedClasses: extra.used ?? 0,
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      validFrom,
      expiresAt: extra.expiresAt ?? cardExpiry(validFrom, type),
      paymentMethod: 'CASH',
    },
  });
}

export const inHours = (h: number) => new Date(T0.getTime() + h * HOUR);
export const inMinutes = (m: number) => new Date(T0.getTime() + m * MIN);
export const inDays = (d: number) => new Date(T0.getTime() + d * 24 * HOUR);
