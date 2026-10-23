import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { homePath, useAuth } from './auth/AuthContext';
import { useI18n } from './i18n';
import type { Role } from './api/types';
import SchedulePage from './pages/SchedulePage';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const MyBookingsPage = lazy(() => import('./pages/MyBookingsPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const TodayPage = lazy(() => import('./pages/TodayPage'));
const AdminSchedulePage = lazy(() => import('./pages/admin/AdminSchedulePage'));
const AdminClientsPage = lazy(() => import('./pages/admin/AdminClientsPage'));
const ClientHistoryPage = lazy(() => import('./pages/admin/ClientHistoryPage'));
const ReportPage = lazy(() => import('./pages/admin/ReportPage'));

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePath(user.role)} replace />;
  return <>{children}</>;
}

function Guest({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to={homePath(user.role)} replace />;
  return <>{children}</>;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-bold">{t('common.notFound')}</h1>
      <Link className="font-semibold text-brand-700 underline" to="/">{t('common.toSchedule')}</Link>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SchedulePage />} />
          <Route path="login" element={<Guest><LoginPage /></Guest>} />
          <Route path="register" element={<Guest><RegisterPage /></Guest>} />
          <Route path="my" element={<Guard roles={['CLIENT']}><MyBookingsPage /></Guard>} />
          <Route path="account" element={<Guard><AccountPage /></Guard>} />
          <Route path="today" element={<Guard roles={['INSTRUCTOR', 'ADMIN']}><TodayPage /></Guard>} />
          <Route path="admin/schedule" element={<Guard roles={['ADMIN']}><AdminSchedulePage /></Guard>} />
          <Route path="admin/clients" element={<Guard roles={['ADMIN']}><AdminClientsPage /></Guard>} />
          <Route path="admin/clients/:id" element={<Guard roles={['ADMIN']}><ClientHistoryPage /></Guard>} />
          <Route path="admin/report" element={<Guard roles={['ADMIN']}><ReportPage /></Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
