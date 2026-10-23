import { createHmac, randomBytes } from 'node:crypto';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5080';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@lotusyoga.local';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin-dev-password-1';
// Committed dev value from .env.compose.dev. Used to mint tokens so that data setup does not
// burn the login/register rate limit (10 per 15 min per IP).
export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-only-jwt-secret-not-for-production-0123456789';

export const PASSWORD = 'Secret-pass-123';

export interface Res<T = any> { status: number; body: T }

export async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res<T>> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function mintToken(userId: string, role: string): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({ sub: userId, role, iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

export const uid = () => randomBytes(4).toString('hex');

/** Admin identity comes from global-setup (a single login of the 10/15min budget). */
export async function admin(): Promise<{ token: string; id: string }> {
  const id = process.env.E2E_ADMIN_ID;
  if (!id) throw new Error('E2E_ADMIN_ID missing: global-setup did not run');
  return { token: mintToken(id, 'ADMIN'), id };
}

export interface Person { id: string; email: string; name: string; phone: string; token: string; role: string }

export async function createUser(role: 'CLIENT' | 'INSTRUCTOR' | 'ADMIN' = 'CLIENT', over: Record<string, unknown> = {}): Promise<Person> {
  const a = await admin();
  const s = uid();
  const body = { email: `${role.toLowerCase()}-${s}@e2e.test`, password: PASSWORD, name: `E2E ${role} ${s}`, phone: `+359 888 ${String(Math.floor(100000 + Math.random() * 899999))}`, role, lang: 'en', ...over };
  const r = await call('POST', '/api/admin/users', { token: a.token, body });
  if (r.status !== 201) throw new Error(`createUser failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.id, email: r.body.email, name: r.body.name, phone: r.body.phone, role, token: mintToken(r.body.id, role) };
}

export async function giveCard(userId: string, type: 'SINGLE' | 'PACK_8' | 'PACK_12' | 'UNLIMITED_MONTH' = 'PACK_8', extra: Record<string, unknown> = {}) {
  const a = await admin();
  const r = await call('POST', `/api/admin/users/${userId}/cards`, { token: a.token, body: { type, paymentMethod: 'CASH', ...extra } });
  if (r.status !== 201) throw new Error(`giveCard failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Client that already owns a valid card. */
export async function clientWithCard(type: 'SINGLE' | 'PACK_8' | 'PACK_12' | 'UNLIMITED_MONTH' = 'PACK_8', over: Record<string, unknown> = {}) {
  const c = await createUser('CLIENT', over);
  const card = await giveCard(c.id, type);
  return { ...c, card };
}

export async function createSession(opts: { name?: string; instructorId: string; startsAt: Date | string; capacity?: number; durationMin?: number }) {
  const a = await admin();
  const startsAt = typeof opts.startsAt === 'string' ? opts.startsAt : opts.startsAt.toISOString();
  const r = await call('POST', '/api/admin/sessions', {
    token: a.token,
    body: { name: opts.name ?? `E2E Hatha ${uid()}`, instructorId: opts.instructorId, startsAt, durationMin: opts.durationMin ?? 60, capacity: opts.capacity ?? 14 },
  });
  if (r.status !== 201) throw new Error(`createSession failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
export const inHours = (h: number) => inMinutes(h * 60);
export const inDays = (d: number) => inHours(d * 24);

export const book = (p: Person, sessionId: string) => call('POST', `/api/sessions/${sessionId}/bookings`, { token: p.token });
export const joinWaitlist = (p: Person, sessionId: string) => call('POST', `/api/sessions/${sessionId}/waitlist`, { token: p.token });
export const cancelBooking = (p: Person, bookingId: string) => call('POST', `/api/bookings/${bookingId}/cancel`, { token: p.token });
export const myCards = async (p: Person) => (await call('GET', '/api/me/cards', { token: p.token })).body as any[];
export const getSession = async (id: string) => (await call('GET', `/api/sessions/${id}`)).body;
export const moveSession = async (id: string, startsAt: Date) =>
  call('PATCH', `/api/admin/sessions/${id}`, { token: (await admin()).token, body: { startsAt: startsAt.toISOString() } });

// ---- Europe/Sofia helpers ------------------------------------------------------------------
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function sofiaParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** Sofia-local date + HH:mm -> UTC Date (DST aware). */
export function sofiaToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  for (const off of [3, 2]) {
    const c = new Date(guess - off * 3600_000);
    const s = sofiaParts(c);
    if (s.date === date && s.time === time) return c;
  }
  throw new Error(`non-existent Sofia time ${date} ${time}`);
}
export function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const sofiaToday = () => sofiaParts(new Date()).date;
