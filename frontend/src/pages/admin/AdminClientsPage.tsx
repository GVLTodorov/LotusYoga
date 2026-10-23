import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { AdminUser, Role } from '../../api/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Modal, Notice, PageTitle, Select, useLoad } from '../../components/ui';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/dates';

const PAGE = 50;

export default function AdminClientsPage() {
  const { t, lang } = useI18n();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const state = useLoad(() => api.users(q || undefined, role || undefined, page, PAGE), [q, role, page]);

  useEffect(() => {
    const h = setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [input]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('clients.title')}</PageTitle>
        <Button onClick={() => setEdit('new')}>+ {t('clients.new')}</Button>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label={t('common.search')} type="search" placeholder={t('clients.search')} value={input} onChange={(e) => setInput(e.target.value)} />
        <Select label={t('clients.role')} value={role} onChange={(e) => { setRole(e.target.value as '' | Role); setPage(1); }}>
          <option value="">{t('clients.allRoles')}</option>
          {(['CLIENT', 'INSTRUCTOR', 'ADMIN'] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </Select>
      </div>
      {msg && <div className="mb-4"><Notice>{msg}</Notice></div>}
      <Async state={state}>
        {({ items, total }) => (
          <>
            {items.length === 0 ? (
              <Empty>{t('clients.empty')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((u) => (
                  <li key={u.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-lg font-bold break-words">{u.name}</p>
                        <div className="flex flex-wrap gap-1">
                          <Badge>{t(`role.${u.role}`)}</Badge>
                          {u.blocked && <Badge tone="red">{t('clients.blocked')}</Badge>}
                        </div>
                      </div>
                      <p className="break-all text-slate-600">{u.email}</p>
                      <p>{u.phone}</p>
                      {u.role === 'CLIENT' && (
                        <p className="mt-1 text-sm">
                          {u.activeCard
                            ? `${t(`card.${u.activeCard.type}`)} · ${u.activeCard.remainingClasses === null ? t('card.unlimited') : t('card.left', { n: u.activeCard.remainingClasses })} · ${formatDate(u.activeCard.expiresAt, lang)}`
                            : t('clients.noCard')}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/admin/clients/${u.id}`} className="inline-flex min-h-12 items-center rounded-xl border-2 border-brand-700 px-4 font-semibold text-brand-800">{t('clients.open')}</Link>
                        <Button variant="ghost" onClick={() => setEdit(u)}>{t('common.edit')}</Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {total > PAGE && (
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.prev')}</Button>
                <span>{page} / {Math.ceil(total / PAGE)}</span>
                <Button variant="secondary" disabled={page * PAGE >= total} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
              </div>
            )}
          </>
        )}
      </Async>
      {edit && (
        <UserForm
          initial={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            setMsg(t('common.saved'));
            state.reload();
          }}
        />
      )}
    </>
  );
}

function UserForm({ initial, onClose, onSaved }: { initial: AdminUser | null; onClose: () => void; onSaved: () => void }) {
  const { t, err, lang } = useI18n();
  const [f, setF] = useState({
    name: initial?.name ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '',
    role: (initial?.role ?? 'CLIENT') as Role, password: '', blocked: initial?.blocked ?? false,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'name' | 'email' | 'phone' | 'password') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await api.updateUser(initial.id, {
          name: f.name.trim(), phone: f.phone.trim(), role: f.role, blocked: f.blocked,
          ...(f.password ? { password: f.password } : {}),
        });
      } else {
        await api.createUser({ email: f.email.trim(), password: f.password, name: f.name.trim(), phone: f.phone.trim(), role: f.role, lang });
      }
      onSaved();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? t('common.edit') : t('clients.new')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('common.name')} required maxLength={100} value={f.name} onChange={set('name')} />
        {!initial && <Field label={t('common.email')} type="email" required value={f.email} onChange={set('email')} />}
        <Field label={t('common.phone')} type="tel" inputMode="tel" required minLength={6} maxLength={20} pattern="[0-9+ ]{6,20}" value={f.phone} onChange={set('phone')} />
        <Select label={t('clients.role')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
          {(['CLIENT', 'INSTRUCTOR', 'ADMIN'] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </Select>
        <Field
          label={initial ? t('clients.newPassword') : t('common.password')}
          type="password" autoComplete="new-password" minLength={8} required={!initial}
          hint={t('auth.passwordHint')} value={f.password} onChange={set('password')}
        />
        {initial && (
          <label className="flex min-h-12 items-center gap-3 font-semibold">
            <input type="checkbox" className="h-6 w-6" checked={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked })} />
            {t('clients.blocked')}
          </label>
        )}
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy}>{t('common.save')}</Button>
      </form>
    </Modal>
  );
}
