import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import { setToken } from '../api/client';
import { clientUser, jsonResponse, makeSession, renderApp } from '../test/utils';
import type { Card } from '../api/types';

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
});

const card: Card = {
  id: 'c1', userId: 'u1', type: 'PACK_8', totalClasses: 8, usedClasses: 3, remainingClasses: 5,
  validFrom: '2026-10-01', expiresAt: '2099-12-01T21:59:59.999Z', paymentMethod: 'CASH', priceBgn: 120,
  createdAt: '2026-10-01T10:00:00.000Z', isActive: true,
};
const expired: Card = { ...card, id: 'c2', isActive: false, expiresAt: '2020-01-01T21:59:59.999Z', remainingClasses: 0, usedClasses: 8 };

function mock(role: 'CLIENT' | 'INSTRUCTOR' | 'ADMIN', routes: Record<string, unknown>, onCall?: (u: string, m: string, b?: string) => void) {
  setToken('t');
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    onCall?.(u, init?.method ?? 'GET', init?.body as string | undefined);
    if (u === '/api/me' && (init?.method ?? 'GET') === 'GET') return jsonResponse({ ...clientUser, role });
    for (const [k, v] of Object.entries(routes)) if (u.startsWith(k)) return jsonResponse(v, init?.method === 'POST' ? 201 : 200);
    return jsonResponse([]);
  });
}

describe('client pages', () => {
  it('AC-23/24: my bookings, waitlist, active and expired cards', async () => {
    mock('CLIENT', {
      '/api/me/bookings?scope=upcoming': [{ id: 'b1', status: 'BOOKED', walkIn: false, promotedLate: false, cardId: 'c1', createdAt: '', cancelledAt: null, session: makeSession() }],
      '/api/me/bookings?scope=past': [{ id: 'b0', status: 'NO_SHOW', walkIn: false, promotedLate: false, cardId: 'c1', createdAt: '', cancelledAt: null, session: makeSession({ id: 'old' }) }],
      '/api/me/waitlist': [{ id: 'w1', status: 'WAITING', position: 2, createdAt: '', session: makeSession({ id: 'w' }) }],
      '/api/me/cards': [card, expired],
    });
    renderApp(<App />, '/my');
    expect(await screen.findByText('Оставащи часове: 5')).toBeInTheDocument();
    expect(screen.getByText('Неявяване')).toBeInTheDocument();
    expect(screen.getByText('В списъка на чакащите (място 2)')).toBeInTheDocument();
    expect(screen.getByText('Изтекли карти')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Откажи записването' })).toBeInTheDocument();
  });

  it('AC-5: delete account requires password and logs out', async () => {
    const calls: string[] = [];
    mock('CLIENT', {}, (u, m) => calls.push(`${m} ${u}`));
    renderApp(<App />, '/account');
    await userEvent.click(await screen.findByRole('button', { name: 'Изтрий профила ми' }));
    const confirm = screen.getByRole('button', { name: 'Да, изтрий завинаги' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Въведете паролата си, за да потвърдите'), 'secret123');
    await userEvent.click(confirm);
    await waitFor(() => expect(calls).toContain('DELETE /api/me'));
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(localStorage.getItem('sb_token')).toBeNull();
  });

  it('AC-4: profile edit is saved', async () => {
    const calls: string[] = [];
    mock('CLIENT', {}, (u, m, b) => calls.push(`${m} ${u} ${b ?? ''}`));
    renderApp(<App />, '/account');
    const name = await screen.findByLabelText('Име');
    await userEvent.clear(name);
    await userEvent.type(name, 'Мария');
    await userEvent.click(screen.getByRole('button', { name: 'Запази' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('PATCH /api/me') && c.includes('Мария'))).toBe(true));
  });
});

describe('instructor page', () => {
  it('AC-25/26/27: shows attendees with phone, marks attendance, searches walk-ins', async () => {
    const calls: string[] = [];
    mock('INSTRUCTOR', {
      '/api/instructor/sessions': [{ session: makeSession(), attendees: [{ bookingId: 'b1', userId: 'u9', name: 'Петя', phone: '0888 111 222', status: 'BOOKED', walkIn: false }] }],
      '/api/bookings/b1/attendance': { bookingId: 'b1', userId: 'u9', name: 'Петя', phone: '0888 111 222', status: 'ATTENDED', walkIn: false },
      '/api/instructor/clients': [{ id: 'u5', name: 'Гошо', phone: '0899', hasValidCard: false }],
    }, (u, m) => calls.push(`${m} ${u}`));
    renderApp(<App />, '/today');
    expect(await screen.findByText('Петя')).toBeInTheDocument();
    expect(screen.getByText('0888 111 222')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Присъства/ }));
    expect(await screen.findByText('Отбелязано.')).toBeInTheDocument();
    expect(calls).toContain('PATCH /api/bookings/b1/attendance');
    await userEvent.click(screen.getByRole('button', { name: /Добави клиент на място/ }));
    await userEvent.type(screen.getByLabelText(/Търсене по име/), 'Го');
    expect(await screen.findByText('Гошо')).toBeInTheDocument();
    expect(screen.getByText('няма валидна карта')).toBeInTheDocument();
  });

  it('shows attendance window error', async () => {
    setToken('t');
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith('/api/me')) return jsonResponse({ ...clientUser, role: 'INSTRUCTOR' });
      if (init?.method === 'PATCH') return jsonResponse({ error: { code: 'ATTENDANCE_WINDOW', message: 'x' } }, 409);
      return jsonResponse([{ session: makeSession(), attendees: [{ bookingId: 'b1', userId: 'u9', name: 'Петя', phone: '1', status: 'BOOKED', walkIn: false }] }]);
    });
    renderApp(<App />, '/today');
    await userEvent.click(await screen.findByRole('button', { name: /Не дойде/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Присъствието може да се отбелязва');
  });
});

describe('admin pages', () => {
  it('AC-33/38: clients list with card summary and blocked flag', async () => {
    mock('ADMIN', {
      '/api/admin/users': { total: 1, items: [{ ...clientUser, id: 'u2', name: 'Клиентка', blocked: true, activeCard: card }] },
    });
    renderApp(<App />, '/admin/clients');
    expect(await screen.findByText('Клиентка')).toBeInTheDocument();
    expect(screen.getByText('Блокиран')).toBeInTheDocument();
    expect(screen.getByText(/Карта 8 часа · Оставащи часове: 5/)).toBeInTheDocument();
  });

  it('AC-37/36: client history shows stats, card events and expiry change', async () => {
    const calls: string[] = [];
    mock('ADMIN', {
      '/api/admin/users/u2/history': {
        user: { ...clientUser, id: 'u2', name: 'Клиентка' },
        cards: [{ ...card, events: [{ id: 'e1', type: 'EXPIRY_CHANGED', oldExpiresAt: '2099-12-01T00:00:00Z', newExpiresAt: '2099-12-15T00:00:00Z', note: 'болест', byUser: { id: 'a', name: 'Админ' }, createdAt: '2026-10-05T10:00:00Z' }] }],
        bookings: [], stats: { attended: 7, noShows: 2, lateCancels: 1 },
      },
      '/api/admin/cards/c1': card,
    }, (u, m) => calls.push(`${m} ${u}`));
    renderApp(<App />, '/admin/clients/u2');
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText(/болест/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Промени валидността' }));
    await userEvent.click(screen.getByRole('button', { name: 'Запази' }));
    await waitFor(() => expect(calls).toContain('PATCH /api/admin/cards/c1'));
  });

  it('AC-35: add card posts type, payment and date', async () => {
    const bodies: string[] = [];
    mock('ADMIN', {
      '/api/admin/users/u2/history': { user: { ...clientUser, id: 'u2' }, cards: [], bookings: [], stats: { attended: 0, noShows: 0, lateCancels: 0 } },
    }, (u, m, b) => { if (m === 'POST' && u.endsWith('/cards')) bodies.push(b ?? ''); });
    renderApp(<App />, '/admin/clients/u2');
    await userEvent.click(await screen.findByRole('button', { name: /Добави карта/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Запази' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0])).toMatchObject({ type: 'PACK_8', paymentMethod: 'CASH' });
  });

  it('AC-39: monthly report numbers', async () => {
    mock('ADMIN', {
      '/api/admin/reports/monthly': { month: '2026-11', classesHeld: 78, avgAttendance: 10.4, noShowCount: 41, noShowRate: 0.048, cardsSold: { SINGLE: 12, PACK_8: 20, PACK_12: 9, UNLIMITED_MONTH: 5, total: 46 } },
    });
    renderApp(<App />, '/admin/report');
    expect(await screen.findByText('78')).toBeInTheDocument();
    expect(screen.getByText('4.8%')).toBeInTheDocument();
    expect(screen.getByText('46')).toBeInTheDocument();
  });

  it('AC-28/32: templates list and session cancel dialog', async () => {
    const calls: string[] = [];
    mock('ADMIN', {
      '/api/admin/templates': [{ id: 't1', name: 'Хатха', instructor: { id: 'i1', name: 'Елена' }, weekday: 2, startTime: '18:30', durationMin: 75, capacity: 14, validFrom: '2026-10-01', active: true }],
      '/api/admin/users': { total: 1, items: [{ ...clientUser, id: 'i1', name: 'Елена', role: 'INSTRUCTOR', activeCard: null }] },
      '/api/sessions': [makeSession({ id: 's9', name: 'Сесия' })],
      '/api/admin/sessions/s9/cancel': makeSession({ status: 'CANCELLED' }),
    }, (u, m) => calls.push(`${m} ${u}`));
    renderApp(<App />, '/admin/schedule');
    expect(await screen.findByText(/Вторник, 18:30/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Отмени часа' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Отмени часа' }).at(-1)!);
    await waitFor(() => expect(calls).toContain('POST /api/admin/sessions/s9/cancel'));
  });
});
