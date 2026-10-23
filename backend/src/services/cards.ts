import type { CardType } from '@prisma/client';
import type { Tx } from '../context.js';
import { conflictCode } from '../errors.js';
import { ACTIVE_STATUSES } from '../dto.js';
import { addDays, addMonths, endExclusiveOfDay, endOfDay, sofiaDate, startOfDay } from '../time.js';

export const CARD_SPEC: Record<CardType, { classes: number | null; months: number }> = {
  SINGLE: { classes: 1, months: 1 },
  PACK_8: { classes: 8, months: 2 },
  PACK_12: { classes: 12, months: 3 },
  UNLIMITED_MONTH: { classes: null, months: 1 },
};

/** validFrom + period - 1 day, end of that day in Sofia. */
export function cardExpiry(validFrom: string, type: CardType): Date {
  return endOfDay(addDays(addMonths(validFrom, CARD_SPEC[type].months), -1));
}

interface SessionLike {
  id: string;
  startsAt: Date;
}

export type PickResult = { cardId: string; unlimited: boolean } | { error: 'NO_VALID_CARD' | 'DAILY_LIMIT' };

/**
 * Pick (and, when `consume`, spend) the card for a session: valid on the session's Sofia date, classes left,
 * earliest expiry first. Unlimited cards allow one active booking per Sofia day.
 */
export async function pickCard(tx: Tx, userId: string, session: SessionLike, consume: boolean): Promise<PickResult> {
  const date = sofiaDate(session.startsAt);
  const cards = await tx.card.findMany({
    where: { userId, validFrom: { lte: date }, expiresAt: { gte: session.startsAt } },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
  });
  let dailyLimitHit = false;
  let busyDay: boolean | null = null;
  for (const c of cards) {
    if (c.totalClasses === null) {
      if (busyDay === null) {
        busyDay =
          (await tx.booking.count({
            where: {
              userId,
              status: { in: [...ACTIVE_STATUSES] },
              session: { startsAt: { gte: startOfDay(date), lt: endExclusiveOfDay(date) }, id: { not: session.id } },
            },
          })) > 0;
      }
      if (busyDay) {
        dailyLimitHit = true;
        continue;
      }
      return { cardId: c.id, unlimited: true };
    }
    if (c.usedClasses >= c.totalClasses) continue;
    if (!consume) return { cardId: c.id, unlimited: false };
    // atomic: never spend beyond total, even under concurrent bookings by the same client
    const r = await tx.card.updateMany({
      where: { id: c.id, usedClasses: { lt: c.totalClasses } },
      data: { usedClasses: { increment: 1 } },
    });
    if (r.count === 1) return { cardId: c.id, unlimited: false };
  }
  return { error: dailyLimitHit ? 'DAILY_LIMIT' : 'NO_VALID_CARD' };
}

export async function pickCardOrThrow(tx: Tx, userId: string, session: SessionLike, consume = true) {
  const r = await pickCard(tx, userId, session, consume);
  if ('error' in r) throw conflictCode(r.error);
  return r;
}

/** Give a class back to the card (no-op for unlimited / unknown cards). */
export async function returnClass(tx: Tx, cardId: string | null) {
  if (!cardId) return;
  await tx.card.updateMany({ where: { id: cardId, totalClasses: { not: null }, usedClasses: { gt: 0 } }, data: { usedClasses: { decrement: 1 } } });
}
