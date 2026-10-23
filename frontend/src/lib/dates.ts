// All dates are shown in Europe/Sofia, independent of the device time zone.
export const TZ = 'Europe/Sofia';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  second: '2-digit', hourCycle: 'h23',
});

export interface SofiaParts { y: number; m: number; d: number; hh: number; mm: number; ss: number }

export function sofiaParts(input: string | Date | number): SofiaParts {
  const date = input instanceof Date ? input : new Date(input);
  const o: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute, ss: o.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD of the Sofia-local day */
export function dateKey(input: string | Date | number): string {
  const p = sofiaParts(input);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
export const todayKey = () => dateKey(new Date());

export function timeOf(input: string | Date): string {
  const p = sofiaParts(input);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO weekday 1=Mon..7=Sun of a YYYY-MM-DD key */
export function isoWeekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
export const mondayOf = (key: string) => addDays(key, -(isoWeekday(key) - 1));

const locale = (lang: string) => (lang === 'bg' ? 'bg-BG' : 'en-GB');

/** "вторник, 3 ноември" for a YYYY-MM-DD key */
export function formatDayHeading(key: string, lang: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
export function formatDate(input: string | Date, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(input),
  );
}
export function formatDateTime(input: string | Date, lang: string): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(input));
}
export function formatMonth(key: string, lang: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function offsetMs(utcMs: number): number {
  const p = sofiaParts(utcMs);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(utcMs / 1000) * 1000;
}

/** Sofia-local date + HH:mm -> ISO UTC string (DST safe) */
export function sofiaToIso(key: string, time: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return new Date(t).toISOString();
}

export function endTime(startsAt: string, durationMin: number): string {
  return timeOf(new Date(new Date(startsAt).getTime() + durationMin * 60000));
}

export const currentMonthKey = () => todayKey().slice(0, 7);
