import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n, type Key } from '../i18n';
import { Button } from './ui';

interface Item { to: string; label: Key }

function itemsFor(role: string | undefined): Item[] {
  const sched: Item = { to: '/', label: 'nav.schedule' };
  if (role === 'ADMIN') {
    return [
      { to: '/admin/schedule', label: 'nav.adminSchedule' },
      { to: '/today', label: 'nav.today' },
      { to: '/admin/clients', label: 'nav.clients' },
      { to: '/admin/report', label: 'nav.report' },
      sched,
      { to: '/account', label: 'nav.account' },
    ];
  }
  if (role === 'INSTRUCTOR') return [{ to: '/today', label: 'nav.today' }, sched, { to: '/account', label: 'nav.account' }];
  if (role === 'CLIENT') return [sched, { to: '/my', label: 'nav.myBookings' }, { to: '/account', label: 'nav.account' }];
  return [sched, { to: '/login', label: 'nav.login' }, { to: '/register', label: 'nav.register' }];
}

export default function Layout() {
  const { t, lang } = useI18n();
  const { user, logout, changeLang } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const [lastPath, setLastPath] = useState(loc.pathname);
  if (lastPath !== loc.pathname) {
    setLastPath(loc.pathname);
    setOpen(false);
  }
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-12 items-center rounded-xl px-4 py-2 font-semibold lg:min-h-11 ${
      isActive ? 'bg-brand-100 text-brand-800' : 'text-slate-800 hover:bg-slate-100'
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2">
          <NavLink to="/" className="min-h-12 content-center text-xl font-extrabold text-brand-800">
            🪷 {t('app.name')}
          </NavLink>
          <nav aria-label={t('nav.menu')} className="hidden items-center gap-1 lg:flex">
            {itemsFor(user?.role).map((i) => (
              <NavLink key={i.to} to={i.to} end className={link}>{t(i.label)}</NavLink>
            ))}
            {user && <Button variant="ghost" onClick={logout}>{t('nav.logout')}</Button>}
            <Button variant="secondary" onClick={() => changeLang(lang === 'bg' ? 'en' : 'bg')} aria-label={t('lang.label')}>
              {t('lang.switch')}
            </Button>
          </nav>
          <Button
            variant="secondary"
            className="lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('nav.close') : `☰ ${t('nav.menu')}`}
          </Button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label={t('nav.menu')} className="flex flex-col gap-1 border-t border-slate-200 p-3 lg:hidden">
            {itemsFor(user?.role).map((i) => (
              <NavLink key={i.to} to={i.to} end className={link}>{t(i.label)}</NavLink>
            ))}
            {user && <Button variant="ghost" className="justify-start" onClick={logout}>{t('nav.logout')}</Button>}
            <Button variant="secondary" onClick={() => changeLang(lang === 'bg' ? 'en' : 'bg')} aria-label={t('lang.label')}>
              {t('lang.switch')}
            </Button>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
