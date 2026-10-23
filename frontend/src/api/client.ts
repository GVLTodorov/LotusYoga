import type {
  AdminSessionDetail, AdminUser, Attendee, AuthResult, Booking, Card, CancelPreview, CardType, ClientHit,
  ErrorCode, InstructorDay, Lang, MonthlyReport, PaymentMethod, Role, Session, Template, User, UserHistory,
  WaitlistEntry,
} from './types';

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') + '/api';
const TOKEN_KEY = 'sb_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type Query = Record<string, string | number | undefined>;

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: ErrorCode; message?: string; details?: { path: string; message: string }[] } } | null)?.error;
    if (res.status === 401 && e?.code === 'UNAUTHORIZED' && token) onUnauthorized?.();
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

const get = <T>(p: string, query?: Query) => request<T>('GET', p, { query });
const post = <T>(p: string, body?: unknown) => request<T>('POST', p, { body });
const patch = <T>(p: string, body: unknown) => request<T>('PATCH', p, { body });
const del = <T>(p: string, body?: unknown) => request<T>('DELETE', p, { body });

export interface TemplateInput {
  name: string; instructorId: string; weekday: number; startTime: string; durationMin: number; capacity: number;
  validFrom: string;
}
export interface SessionInput {
  name: string; instructorId: string; startsAt: string; durationMin: number; capacity: number;
}

export const api = {
  register: (b: { email: string; password: string; name: string; phone: string; lang?: Lang }) =>
    post<AuthResult>('/auth/register', b),
  login: (b: { email: string; password: string }) => post<AuthResult>('/auth/login', b),
  me: () => get<User>('/me'),
  updateMe: (b: { name?: string; phone?: string; lang?: Lang }) => patch<User>('/me', b),
  deleteMe: (password: string) => del<void>('/me', { password }),

  sessions: (from?: string, to?: string) => get<Session[]>('/sessions', { from, to }),
  book: (sessionId: string) => post<Booking>(`/sessions/${sessionId}/bookings`),
  myBookings: (scope: 'upcoming' | 'past') => get<Booking[]>('/me/bookings', { scope }),
  cancelPreview: (id: string) => get<CancelPreview>(`/bookings/${id}/cancel-preview`),
  cancelBooking: (id: string) => post<Booking>(`/bookings/${id}/cancel`),
  joinWaitlist: (sessionId: string) => post<WaitlistEntry>(`/sessions/${sessionId}/waitlist`),
  leaveWaitlist: (id: string) => del<void>(`/waitlist/${id}`),
  myWaitlist: () => get<WaitlistEntry[]>('/me/waitlist'),
  myCards: () => get<Card[]>('/me/cards'),

  instructorSessions: (date?: string) => get<InstructorDay[]>('/instructor/sessions', { date }),
  setAttendance: (bookingId: string, status: 'ATTENDED' | 'NO_SHOW') =>
    patch<Attendee>(`/bookings/${bookingId}/attendance`, { status }),
  searchClients: (q: string) => get<ClientHit[]>('/instructor/clients', { q }),
  walkIn: (sessionId: string, userId: string) => post<Attendee>(`/sessions/${sessionId}/walk-ins`, { userId }),

  templates: () => get<Template[]>('/admin/templates'),
  createTemplate: (b: TemplateInput) => post<Template>('/admin/templates', b),
  updateTemplate: (id: string, b: Partial<TemplateInput> & { active?: boolean }) =>
    patch<Template>(`/admin/templates/${id}`, b),
  createSession: (b: SessionInput) => post<Session>('/admin/sessions', b),
  updateSession: (id: string, b: Partial<SessionInput>) => patch<Session>(`/admin/sessions/${id}`, b),
  cancelSession: (id: string, reason?: string) => post<Session>(`/admin/sessions/${id}/cancel`, { reason }),
  sessionAttendees: (id: string) => get<AdminSessionDetail>(`/admin/sessions/${id}/attendees`),

  users: (q?: string, role?: Role, page = 1, pageSize = 50) =>
    get<{ items: AdminUser[]; total: number }>('/admin/users', { q, role, page, pageSize }),
  createUser: (b: { email: string; password: string; name: string; phone: string; role: Role; lang?: Lang }) =>
    post<User>('/admin/users', b),
  updateUser: (id: string, b: { name?: string; phone?: string; role?: Role; lang?: Lang; blocked?: boolean; password?: string }) =>
    patch<User>(`/admin/users/${id}`, b),
  userHistory: (id: string) => get<UserHistory>(`/admin/users/${id}/history`),
  addCard: (userId: string, b: { type: CardType; paymentMethod: PaymentMethod; priceBgn?: number; validFrom?: string }) =>
    post<Card>(`/admin/users/${userId}/cards`, b),
  updateCardExpiry: (id: string, b: { expiresAt: string; note?: string }) => patch<Card>(`/admin/cards/${id}`, b),
  monthlyReport: (month: string) => get<MonthlyReport>('/admin/reports/monthly', { month }),
};
