import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { homePath, useAuth } from '../auth/AuthContext';
import { Button, ErrorBox, Field, PageTitle } from '../components/ui';
import { useI18n } from '../i18n';

export default function RegisterPage() {
  const { t, err } = useI18n();
  const { register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const fieldErr = (path: string) =>
    error instanceof ApiError ? error.details?.find((d) => d.path === path)?.message : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await register({ ...f, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() });
      nav(homePath(u.role), { replace: true });
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle>{t('auth.registerTitle')}</PageTitle>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('common.name')} autoComplete="name" required maxLength={100} value={f.name} onChange={set('name')} error={fieldErr('name')} />
        <Field label={t('common.email')} type="email" autoComplete="email" required value={f.email} onChange={set('email')} error={fieldErr('email')} />
        <Field label={t('common.phone')} type="tel" autoComplete="tel" required minLength={6} maxLength={20} pattern="[0-9+ ]{6,20}" inputMode="tel" hint={t('auth.phoneHint')} value={f.phone} onChange={set('phone')} error={fieldErr('phone')} />
        <Field label={t('common.password')} type="password" autoComplete="new-password" required minLength={8} hint={t('auth.passwordHint')} value={f.password} onChange={set('password')} error={fieldErr('password')} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy}>{t('auth.registerBtn')}</Button>
      </form>
      <p className="mt-6">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="inline-block min-h-12 font-semibold text-brand-700 underline">{t('auth.loginTitle')}</Link>
      </p>
    </div>
  );
}
