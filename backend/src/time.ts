// All "day / month / evening" reasoning is Europe/Sofia-local and DST-safe (days may be 23 or 25 hours).
export const TZ = 'Europe/Sofia';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface SofiaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function sofiaParts(d: Date): SofiaParts {
  const o: Record<string, number> = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: o.minute, second: o.second };
}

/** Offset of Sofia from UTC (ms) at the given instant. */
function offsetMs(ms: number): number {
  const p = sofiaParts(new Date(ms));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC instant of a Sofia-local date (YYYY-MM-DD) and time (HH:mm). */
export function sofiaToUtc(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  const first = local - offsetMs(local);
  return new Date(local - offsetMs(first));
}

/** Sofia-local date (YYYY-MM-DD) of an instant. */
export function sofiaDate(d: Date): string {
  const p = sofiaParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Sofia-local time of day (HH:mm) of an instant. */
export function sofiaTime(d: Date): string {
  const p = sofiaParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Add calendar months, clamping the day to the target month's length (Jan 31 + 1 = Feb 28/29). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

/** ISO weekday of a date string: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function diffDays(a: string, b: string): number {
  const f = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((f(b) - f(a)) / DAY);
}

/** Start of the Sofia day. */
export const startOfDay = (date: string) => sofiaToUtc(date);
/** Exclusive end of the Sofia day = start of the next one. */
export const endExclusiveOfDay = (date: string) => sofiaToUtc(addDays(date, 1));
/** Last millisecond of the Sofia day. */
export const endOfDay = (date: string) => new Date(endExclusiveOfDay(date).getTime() - 1);

/** [start, end) of a Sofia month given as YYYY-MM. */
export function monthRange(month: string): { start: Date; end: Date } {
  const start = sofiaToUtc(`${month}-01`);
  const end = sofiaToUtc(addMonths(`${month}-01`, 1));
  return { start, end };
}

export const isValidDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;

const LOCALES = { bg: 'bg-BG', en: 'en-GB' } as const;

export function formatSofiaDateTime(d: Date, lang: 'bg' | 'en'): string {
  return new Intl.DateTimeFormat(LOCALES[lang], {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function formatSofiaDate(d: Date, lang: 'bg' | 'en'): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
