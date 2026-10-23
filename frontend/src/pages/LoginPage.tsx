import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { homePath, useAuth } from '../auth/AuthContext';
import { Button, ErrorBox, Field, Notice, PageTitle } from '../components/ui';
import { useI18n } from '../i18n';

export default function LoginPage() {
  const { t, err } = useI18n();
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      nav(homePath(u.role), { replace: true });
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle>{t('auth.loginTitle')}</PageTitle>
      {(loc.state as { deleted?: boolean } | null)?.deleted && <div className="mb-4"><Notice>{t('account.deleted')}</Notice></div>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('common.email')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label={t('common.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy}>{t('auth.loginBtn')}</Button>
      </form>
      <p className="mt-6">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="inline-block min-h-12 font-semibold text-brand-700 underline">{t('auth.registerTitle')}</Link>
      </p>
    </div>
  );
}
