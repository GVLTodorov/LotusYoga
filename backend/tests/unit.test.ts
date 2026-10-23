import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { renderEmail } from '../src/email/templates.js';
import { backoffMs } from '../src/email/outbox.js';
import { cardExpiry } from '../src/services/cards.js';
import {
  addDays,
  addMonths,
  endExclusiveOfDay,
  endOfDay,
  HOUR,
  isoWeekday,
  isValidDate,
  mondayOf,
  monthRange,
  sofiaDate,
  sofiaTime,
  sofiaToUtc,
  startOfDay,
} from '../src/time.js';

describe('Europe/Sofia time logic (DST-safe)', () => {
  it('converts local times to UTC with the right offset in summer and winter', () => {
    expect(sofiaToUtc('2026-07-15', '18:30').toISOString()).toBe('2026-07-15T15:30:00.000Z'); // EEST +3
    expect(sofiaToUtc('2026-11-03', '18:30').toISOString()).toBe('2026-11-03T16:30:00.000Z'); // EET +2
  });

  it('keeps the same local start time across the autumn DST change (2026-10-25)', () => {
    expect(sofiaToUtc('2026-10-20', '18:30').toISOString()).toBe('2026-10-20T15:30:00.000Z');
    expect(sofiaToUtc('2026-10-27', '18:30').toISOString()).toBe('2026-10-27T16:30:00.000Z');
    expect(sofiaTime(sofiaToUtc('2026-10-27', '18:30'))).toBe('18:30');
  });

  it('keeps the same local start time across the spring DST change (2026-03-29)', () => {
    expect(sofiaToUtc('2026-03-24', '18:30').toISOString()).toBe('2026-03-24T16:30:00.000Z');
    expect(sofiaToUtc('2026-03-31', '18:30').toISOString()).toBe('2026-03-31T15:30:00.000Z');
  });

  it('days are 25 h on the autumn change and 23 h on the spring change', () => {
    expect((endExclusiveOfDay('2026-10-25').getTime() - startOfDay('2026-10-25').getTime()) / HOUR).toBe(25);
    expect((endExclusiveOfDay('2026-03-29').getTime() - startOfDay('2026-03-29').getTime()) / HOUR).toBe(23);
    expect((endExclusiveOfDay('2026-11-03').getTime() - startOfDay('2026-11-03').getTime()) / HOUR).toBe(24);
  });

  it('end of day is 23:59:59.999 Sofia', () => {
    expect(endOfDay('2026-12-02').toISOString()).toBe('2026-12-02T21:59:59.999Z');
    expect(endOfDay('2026-07-02').toISOString()).toBe('2026-07-02T20:59:59.999Z');
  });

  it('computes the Sofia date of an instant near midnight', () => {
    expect(sofiaDate(new Date('2026-11-03T21:59:59.999Z'))).toBe('2026-11-03');
    expect(sofiaDate(new Date('2026-11-03T22:00:00.000Z'))).toBe('2026-11-04');
    expect(sofiaDate(new Date('2026-07-03T21:00:00.000Z'))).toBe('2026-07-04');
  });

  it('date helpers', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-03', 3)).toBe('2027-02-03');
    expect(isoWeekday('2026-11-03')).toBe(2); // Tuesday
    expect(isoWeekday('2026-11-01')).toBe(7); // Sunday
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-02-28')).toBe(true);
    const r = monthRange('2026-10');
    expect(r.start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-31T22:00:00.000Z'); // October contains the 25 h day
  });

  it('card expiry follows the contract example and the periods per type', () => {
    expect(cardExpiry('2026-11-03', 'SINGLE').toISOString()).toBe('2026-12-02T21:59:59.999Z');
    expect(cardExpiry('2026-11-03', 'UNLIMITED_MONTH').toISOString()).toBe('2026-12-02T21:59:59.999Z');
    expect(cardExpiry('2026-11-03', 'PACK_8').toISOString()).toBe('2027-01-02T21:59:59.999Z');
    expect(cardExpiry('2026-11-03', 'PACK_12').toISOString()).toBe('2027-02-02T21:59:59.999Z');
    // period crossing a DST change keeps "end of day Sofia"
    expect(cardExpiry('2026-03-01', 'PACK_8').toISOString()).toBe('2026-04-30T20:59:59.999Z');
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a-long-enough-secret-value' };
  it('refuses to start without a JWT secret, in any environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SMTP_HOST: 'smtp' })).toThrow(/JWT_SECRET/);
  });
  it('production requires SMTP_HOST', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_HOST/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', SMTP_HOST: 'smtp' }).smtp.host).toBe('smtp');
  });
  it('rejects a short secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/at least/);
  });
  it('jobs default to off in test, on elsewhere', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).jobsEnabled).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).jobsEnabled).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development', JOBS_ENABLED: 'false' }).jobsEnabled).toBe(false);
  });
});

describe('email templates', () => {
  const payload = { name: 'Ivana', sessionName: 'Hatha', startsAt: '2026-11-03T16:30:00.000Z', instructor: 'Elena', reason: 'Holiday', expiresAt: '2026-12-02T21:59:59.999Z' };
  it('renders every template in both languages', () => {
    for (const t of ['BOOKING_CONFIRMED', 'WAITLIST_PROMOTED', 'SESSION_CANCELLED', 'REMINDER', 'CARD_LOW', 'CARD_EXPIRING']) {
      for (const lang of ['bg', 'en'] as const) {
        const r = renderEmail(t, lang, payload);
        expect(r.subject.length).toBeGreaterThan(3);
        expect(r.text).toContain('Ivana');
        expect(r.html).toContain('<p>');
      }
    }
  });
  it('uses Sofia time and the recipient language', () => {
    expect(renderEmail('BOOKING_CONFIRMED', 'en', payload).text).toContain('18:30');
    expect(renderEmail('BOOKING_CONFIRMED', 'bg', payload).subject).toContain('Потвърдена');
    expect(renderEmail('SESSION_CANCELLED', 'en', payload).text).toContain('Holiday');
  });
  it('escapes html in user supplied text', () => {
    expect(renderEmail('REMINDER', 'en', { ...payload, sessionName: '<script>x</script>' }).html).not.toContain('<script>');
  });
  it('throws for unknown templates', () => {
    expect(() => renderEmail('NOPE', 'en', {})).toThrow();
  });
  it('retry backoff grows', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(4)).toBeGreaterThan(backoffMs(3));
  });
});
