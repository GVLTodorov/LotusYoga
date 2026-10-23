import { useState, type FormEvent } from 'react';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Modal, Notice, PageTitle, Select } from '../components/ui';
import { useI18n } from '../i18n';
import type { Lang } from '../api/types';

export default function AccountPage() {
  const { t, lang, err } = useI18n();
  const { user, updateProfile, changeLang, logout } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pw, setPw] = useState('');
  const [delError, setDelError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() });
      setSaved(true);
    } catch (x) {
      setError(x);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDelError(null);
    try {
      await api.deleteMe(pw);
      try { sessionStorage.setItem('sb_deleted', '1'); } catch { /* ignore */ }
      logout();
    } catch (x) {
      setDelError(x);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8">
      <section>
        <PageTitle>{t('account.title')}</PageTitle>
        <p className="mb-4 text-slate-600">{user.email} · {t(`role.${user.role}`)}</p>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label={t('common.name')} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Field label={t('common.phone')} type="tel" inputMode="tel" required minLength={6} maxLength={20} pattern="[0-9+ ]{6,20}" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select label={t('account.language')} value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            <option value="bg">Български</option>
            <option value="en">English</option>
          </Select>
          {error != null && <ErrorBox message={err(error)} />}
          {saved && <Notice>{t('common.saved')}</Notice>}
          <Button type="submit">{t('common.save')}</Button>
        </form>
      </section>

      {user.role === 'CLIENT' && (
        <Card className="border-red-300">
          <h2 className="text-xl font-bold text-red-800">{t('account.deleteTitle')}</h2>
          <p className="my-3">{t('account.deleteWarn')}</p>
          <Button variant="danger" onClick={() => setDeleting(true)}>{t('account.deleteBtn')}</Button>
        </Card>
      )}

      {deleting && (
        <Modal title={t('account.deleteTitle')} onClose={() => setDeleting(false)}>
          <form onSubmit={remove} className="flex flex-col gap-4">
            <p role="alert" className="rounded-xl border-4 border-red-700 bg-red-50 p-3 text-red-900">{t('account.deleteWarn')}</p>
            <Field label={t('account.deletePassword')} type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
            {delError != null && <ErrorBox message={err(delError)} />}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button variant="secondary" className="flex-1" onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
              <Button type="submit" variant="danger" className="flex-1" disabled={busy || !pw}>{t('account.deleteConfirm')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
