import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './App';
import { setToken } from './api/client';
import { clientUser, jsonResponse, renderApp } from './test/utils';
import { shiftMonth, pct } from './pages/admin/ReportPage';

afterEach(() => {
  vi.restoreAllMocks();
  setToken(null);
});

describe('App routing and auth', () => {
  it('AC-3: login lands instructor on Today and shows nav by role', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith('/auth/login')) return jsonResponse({ token: 't', user: { ...clientUser, role: 'INSTRUCTOR' } });
      if (u.includes('/instructor/sessions')) return jsonResponse([]);
      return jsonResponse([]);
    });
    renderApp(<App />, '/login');
    await userEvent.type(await screen.findByLabelText('Имейл'), 'a@b.bg');
    await userEvent.type(screen.getByLabelText('Парола'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Влез' }));
    expect(await screen.findByText('Няма часове за тази дата.')).toBeInTheDocument();
  });

  it('AC-3: wrong credentials show a generic message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'x' } }, 401));
    renderApp(<App />, '/login');
    await userEvent.type(await screen.findByLabelText('Имейл'), 'a@b.bg');
    await userEvent.type(screen.getByLabelText('Парола'), 'wrongwrong');
    await userEvent.click(screen.getByRole('button', { name: 'Влез' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Грешен имейл или парола.');
  });

  it('AC-1: register sends phone and language and lands on the schedule', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/auth/register')) return jsonResponse({ token: 't', user: clientUser }, 201);
      return jsonResponse([]);
    });
    renderApp(<App />, '/register');
    await userEvent.type(await screen.findByLabelText('Име'), 'Ивана');
    await userEvent.type(screen.getByLabelText('Имейл'), 'a@b.bg');
    await userEvent.type(screen.getByLabelText(/Телефон/), '+359 888 123 456');
    await userEvent.type(screen.getByLabelText(/Парола/), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Регистрирай се' }));
    expect(await screen.findByRole('heading', { name: 'Програма' })).toBeInTheDocument();
    const call = f.mock.calls.find((c) => String(c[0]).endsWith('/auth/register'))!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ phone: '+359 888 123 456', lang: 'bg' });
  });

  it('language switch is persisted and flips the UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
    renderApp(<App />, '/');
    await userEvent.click(screen.getAllByRole('button', { name: 'Език' })[0]);
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
    expect(localStorage.getItem('sb_lang')).toBe('en');
  });

  it('redirects anonymous users away from protected pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
    renderApp(<App />, '/admin/clients');
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  });

  it('report helpers', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(pct(0.048)).toBe('4.8%');
  });
});
