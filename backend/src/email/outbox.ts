import type { Prisma } from '@prisma/client';
import type { Ctx, Db } from '../context.js';
import { MIN } from '../time.js';
import { renderEmail, type EmailPayload, type EmailTemplate } from './templates.js';

export const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * MIN;

export interface QueueArgs {
  to: string;
  lang: 'bg' | 'en';
  template: EmailTemplate;
  payload: EmailPayload;
  sendAfter?: Date;
}

/** Queue an email inside the caller's transaction (so it is only sent if the change commits). */
export async function queueEmail(db: Db, appUrl: string, args: QueueArgs) {
  await db.emailOutbox.create({
    data: {
      to: args.to,
      lang: args.lang,
      template: args.template,
      payload: { ...args.payload, appUrl } as Prisma.InputJsonValue,
      sendAfter: args.sendAfter ?? new Date(0), // due immediately; independent of any clock
    },
  });
}

/** Retry backoff: 1, 2, 4, 8 ... minutes. */
export const backoffMs = (attempts: number) => 2 ** Math.max(0, attempts - 1) * MIN;

interface OutboxRow {
  id: string;
  to: string;
  lang: 'bg' | 'en';
  template: string;
  payload: EmailPayload;
  attempts: number;
}

/** Process due emails once. Safe to run from several instances (rows are leased with SKIP LOCKED). */
export async function processOutbox(ctx: Ctx, limit = 20): Promise<{ sent: number; failed: number }> {
  const now = ctx.now();
  const lease = new Date(now.getTime() + LEASE_MS);
  const rows = await ctx.prisma.$queryRaw<OutboxRow[]>`
    UPDATE "EmailOutbox" SET "sendAfter" = ${lease}
    WHERE id IN (
      SELECT id FROM "EmailOutbox"
      WHERE status = 'PENDING' AND "sendAfter" <= ${now} AND attempts < ${MAX_ATTEMPTS}
      ORDER BY "sendAfter" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, "to", lang, template, payload, attempts`;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const msg = renderEmail(row.template, row.lang, row.payload);
      await ctx.mailer.send({ to: row.to, ...msg });
      await ctx.prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: ctx.now(), attempts: row.attempts + 1, lastError: null } });
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      failed++;
      // no recipient address or message content in logs
      ctx.log.warn({ outboxId: row.id, template: row.template, attempts }, 'email send failed');
      await ctx.prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          sendAfter: new Date(ctx.now().getTime() + backoffMs(attempts)),
          lastError: String((err as Error).message ?? err).slice(0, 300),
        },
      });
    }
  }
  return { sent, failed };
}
