import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card as CardT, CardType, PaymentMethod } from '../../api/types';
import BookingRow from '../../components/BookingRow';
import CardView from '../../components/CardView';
import { Async, Button, Card, Empty, ErrorBox, Field, Modal, Notice, PageTitle, Select, useLoad } from '../../components/ui';
import { useI18n } from '../../i18n';
import { dateKey, formatDate, todayKey } from '../../lib/dates';

const TYPES: CardType[] = ['SINGLE', 'PACK_8', 'PACK_12', 'UNLIMITED_MONTH'];

export default function ClientHistoryPage() {
  const { id = '' } = useParams();
  const { t, lang } = useI18n();
  const state = useLoad(() => api.userHistory(id), [id]);
  const [addOpen, setAddOpen] = useState(false);
  const [expiry, setExpiry] = useState<CardT | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <Link to="/admin/clients" className="inline-flex min-h-12 items-center font-semibold text-brand-700 underline">‹ {t('nav.clients')}</Link>
      <Async state={state}>
        {(h) => (
          <>
            <PageTitle>{h.user.name}</PageTitle>
            <p className="mb-4 break-words text-slate-600">{h.user.email} · {h.user.phone}</p>
            {msg && <div className="mb-4"><Notice>{msg}</Notice></div>}

            <section className="mb-8" aria-labelledby="h-stats">
              <h2 id="h-stats" className="sr-only">{t('history.stats')}</h2>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {([['history.attended', h.stats.attended], ['history.noShows', h.stats.noShows], ['history.lateCancels', h.stats.lateCancels]] as const).map(([k, v]) => (
                  <Card key={k}>
                    <dd className="text-3xl font-extrabold">{v}</dd>
                    <dt className="text-sm text-slate-600">{t(k)}</dt>
                  </Card>
                ))}
              </dl>
            </section>

            <section className="mb-8" aria-labelledby="h-cards">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="h-cards" className="text-xl font-bold">{t('history.cards')}</h2>
                <Button onClick={() => setAddOpen(true)}>+ {t('history.addCard')}</Button>
              </div>
              {h.cards.length === 0 ? <Empty>{t('history.empty')}</Empty> : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {h.cards.map((c) => (
                    <li key={c.id}>
                      <CardView card={c}>
                        <p className="text-sm text-slate-600">
                          {t(`pay.${c.paymentMethod}`)}{c.priceBgn != null ? ` · ${c.priceBgn} лв.` : ''} · {t('card.validFrom')} {formatDate(c.validFrom, lang)}
                        </p>
                        {c.events && c.events.length > 0 && (
                          <ul className="mt-2 border-t border-slate-200 pt-2 text-sm">
                            {c.events.map((ev) => (
                              <li key={ev.id}>
                                {formatDate(ev.createdAt, lang)}:{' '}
                                {ev.type === 'CREATED'
                                  ? t('history.event.CREATED')
                                  : t('history.event.EXPIRY_CHANGED', {
                                      old: ev.oldExpiresAt ? formatDate(ev.oldExpiresAt, lang) : '–',
                                      new: ev.newExpiresAt ? formatDate(ev.newExpiresAt, lang) : '–',
                                    })}{' '}
                                ({t('history.by', { name: ev.byUser.name })}){ev.note ? ` – ${ev.note}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        <Button variant="secondary" className="mt-3" onClick={() => setExpiry(c)}>{t('history.changeExpiry')}</Button>
                      </CardView>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="h-bk">
              <h2 id="h-bk" className="mb-3 text-xl font-bold">{t('history.bookings')}</h2>
              {h.bookings.length === 0 ? <Empty>{t('history.empty')}</Empty> : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {h.bookings.map((b) => <li key={b.id}><BookingRow booking={b} /></li>)}
                </ul>
              )}
            </section>

            {addOpen && (
              <AddCardDialog
                userId={id}
                onClose={() => setAddOpen(false)}
                onSaved={() => { setAddOpen(false); setMsg(t('history.cardAdded')); state.reload(); }}
              />
            )}
            {expiry && (
              <ExpiryDialog
                card={expiry}
                onClose={() => setExpiry(null)}
                onSaved={() => { setExpiry(null); setMsg(t('common.saved')); state.reload(); }}
              />
            )}
          </>
        )}
      </Async>
    </>
  );
}

function AddCardDialog({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const [type, setType] = useState<CardType>('PACK_8');
  const [pay, setPay] = useState<PaymentMethod>('CASH');
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(todayKey());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addCard(userId, { type, paymentMethod: pay, validFrom: from, ...(price ? { priceBgn: Number(price) } : {}) });
      onSaved();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('history.addCard')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Select label={t('history.cardType')} value={type} onChange={(e) => setType(e.target.value as CardType)}>
          {TYPES.map((c) => <option key={c} value={c}>{t(`card.${c}`)}</option>)}
        </Select>
        <Select label={t('history.payment')} value={pay} onChange={(e) => setPay(e.target.value as PaymentMethod)}>
          <option value="CASH">{t('pay.CASH')}</option>
          <option value="BANK_TRANSFER">{t('pay.BANK_TRANSFER')}</option>
        </Select>
        <Field label={t('history.price')} type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Field label={t('admin.validFrom')} type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy}>{t('common.save')}</Button>
      </form>
    </Modal>
  );
}

function ExpiryDialog({ card, onClose, onSaved }: { card: CardT; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const [date, setDate] = useState(dateKey(card.expiresAt));
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateCardExpiry(card.id, { expiresAt: date, ...(note.trim() ? { note: note.trim() } : {}) });
      onSaved();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('history.changeExpiry')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('history.newExpiry')} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label={t('history.note')} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy}>{t('common.save')}</Button>
      </form>
    </Modal>
  );
}
