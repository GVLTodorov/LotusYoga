import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import SchedulePage, { groupByDay } from './SchedulePage';
import { clientUser, jsonResponse, makeSession, renderApp } from '../test/utils';
import { setToken } from '../api/client';

afterEach(() => vi.restoreAllMocks());

describe('SchedulePage', () => {
  it('AC-6: anonymous visitor sees sessions, free spots, full and cancelled badges', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      jsonResponse([
        makeSession({ id: 'a', name: 'Хатха' }),
        makeSession({ id: 'b', name: 'Виняса', freeSpots: 0, bookedCount: 14 }),
        makeSession({ id: 'c', name: 'Йин', status: 'CANCELLED' }),
      ]),
    );
    renderApp(<SchedulePage />);
    expect(await screen.findByText('Хатха')).toBeInTheDocument();
    expect(screen.getByText('свободни места: 11')).toBeInTheDocument();
    expect(screen.getByText('Пълен')).toBeInTheDocument();
    expect(screen.getByText('Отменен')).toBeInTheDocument();
    expect(screen.getAllByText('Влез, за да запишеш').length).toBeGreaterThan(0);
  });

  it('shows empty and error states', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
    const { unmount } = renderApp(<SchedulePage />);
    expect(await screen.findByText('Няма часове в тази седмица.')).toBeInTheDocument();
    unmount();
    f.mockRejectedValue(new TypeError('offline'));
    renderApp(<SchedulePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Няма връзка със сървъра');
    expect(screen.getByRole('button', { name: 'Опитай пак' })).toBeInTheDocument();
  });

  it('AC-7/8: logged-in client sees state and can book', async () => {
    setToken('t');
    let booked = false;
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith('/api/me')) return jsonResponse(clientUser);
      if (u.includes('/bookings') && init?.method === 'POST') {
        booked = true;
        return jsonResponse({ id: 'b1', status: 'BOOKED' }, 201);
      }
      return jsonResponse([
        makeSession({ id: 's1', myState: booked ? 'BOOKED' : 'CAN_BOOK', myBookingId: booked ? 'b1' : null }),
        makeSession({ id: 's2', name: 'Пълен час', freeSpots: 0, myState: 'CAN_JOIN_WAITLIST' }),
        makeSession({ id: 's3', name: 'Чакам', freeSpots: 0, myState: 'WAITLISTED', myWaitlistId: 'w', myWaitlistPosition: 2 }),
      ]);
    });
    renderApp(<SchedulePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Запиши ме' }));
    expect(await screen.findByText('Записахте се успешно. Изпратихме ви имейл.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Откажи записването' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Запиши ме в списъка на чакащите' })).toBeInTheDocument();
    expect(screen.getByText('В списъка на чакащите (място 2)')).toBeInTheDocument();
    expect(f).toHaveBeenCalled();
    setToken(null);
  });

  it('AC-9: SESSION_FULL on booking shows the translated message', async () => {
    setToken('t');
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith('/api/me')) return jsonResponse(clientUser);
      if (init?.method === 'POST') return jsonResponse({ error: { code: 'SESSION_FULL', message: 'x' } }, 409);
      return jsonResponse([makeSession({ myState: 'CAN_BOOK' })]);
    });
    renderApp(<SchedulePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Запиши ме' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Часът е пълен');
    setToken(null);
  });

  it('groups sessions by Sofia day, sorted', () => {
    const g = groupByDay([
      makeSession({ id: '2', startsAt: '2026-11-03T22:30:00.000Z' }),
      makeSession({ id: '1', startsAt: '2026-11-03T10:00:00.000Z' }),
    ]);
    expect([...g.keys()]).toEqual(['2026-11-03', '2026-11-04']);
  });
});
