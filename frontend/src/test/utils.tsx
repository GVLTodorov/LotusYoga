import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { I18nProvider } from '../i18n';
import type { Session, User } from '../api/types';

export function renderApp(ui: ReactElement, route = '/') {
  return render(
    <I18nProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

export const clientUser: User = {
  id: 'u1', email: 'a@b.bg', name: 'Ивана', phone: '+359 888 123 456', role: 'CLIENT', lang: 'bg', blocked: false,
  createdAt: '2026-10-01T10:00:00.000Z',
};

export function makeSession(over: Partial<Session> = {}): Session {
  const start = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  return {
    id: 's1', templateId: 't1', name: 'Хатха йога', startsAt: start, durationMin: 75,
    instructor: { id: 'i1', name: 'Елена' }, capacity: 14, bookedCount: 3, freeSpots: 11, waitlistCount: 0,
    status: 'SCHEDULED', bookingOpensAt: '2026-01-01T00:00:00.000Z',
    bookingClosesAt: new Date(Date.now() + 2 * 24 * 3600 * 1000 - 1800000).toISOString(), ...over,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}
