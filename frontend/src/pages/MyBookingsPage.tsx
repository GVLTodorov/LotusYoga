import { useState } from 'react';
import { api } from '../api/client';
import type { Booking } from '../api/types';
import BookingRow from '../components/BookingRow';
import CancelDialog from '../components/CancelDialog';
import CardView from '../components/CardView';
import { Async, Button, Card, Empty, ErrorBox, Notice, PageTitle, useLoad } from '../components/ui';
import { useI18n } from '../i18n';
import { formatDateTime } from '../lib/dates';

export default function MyBookingsPage() {
  const { t, lang, err } = useI18n();
  const upcoming = useLoad(() => api.myBookings('upcoming'), []);
  const waitlist = useLoad(() => api.myWaitlist(), []);
  const past = useLoad(() => api.myBookings('past'), []);
  const cards = useLoad(() => api.myCards(), []);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reloadAll = () => {
    upcoming.reload();
    waitlist.reload();
    past.reload();
    cards.reload();
  };

  return (
    <>
      <PageTitle>{t('my.title')}</PageTitle>
      {msg && <div className="mb-4"><Notice>{msg}</Notice></div>}
      {error != null && <div className="mb-4"><ErrorBox message={err(error)} /></div>}

      <section className="mb-8" aria-labelledby="h-up">
        <h2 id="h-up" className="mb-3 text-xl font-bold">{t('my.upcoming')}</h2>
        <Async state={upcoming}>
          {(list) =>
            list.length === 0 ? (
              <Empty>{t('my.noUpcoming')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((b) => (
                  <li key={b.id}>
                    <BookingRow booking={b}>
                      <Button variant="secondary" className="mt-3" onClick={() => setCancelling(b)}>{t('action.cancelBooking')}</Button>
                    </BookingRow>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      <section className="mb-8" aria-labelledby="h-wl">
        <h2 id="h-wl" className="mb-3 text-xl font-bold">{t('my.waitlist')}</h2>
        <Async state={waitlist}>
          {(list) =>
            list.length === 0 ? (
              <Empty>{t('common.none')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((w) => (
                  <li key={w.id}>
                    <Card>
                      <p className="text-lg font-bold">{w.session.name}</p>
                      <p>{formatDateTime(w.session.startsAt, lang)} · {w.session.instructor.name}</p>
                      {w.position != null && <p className="font-semibold text-amber-900">{t('state.WAITLISTED', { n: w.position })}</p>}
                      <Button
                        variant="secondary"
                        className="mt-3"
                        onClick={async () => {
                          setError(null);
                          try {
                            await api.leaveWaitlist(w.id);
                            setMsg(t('waitlist.left'));
                            waitlist.reload();
                          } catch (e) {
                            setError(e);
                          }
                        }}
                      >
                        {t('action.leaveWaitlist')}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      <section className="mb-8" aria-labelledby="h-cards">
        <h2 id="h-cards" className="mb-3 text-xl font-bold">{t('my.cards')}</h2>
        <Async state={cards}>
          {(list) => {
            const active = list.filter((c) => c.isActive);
            const old = list.filter((c) => !c.isActive);
            return (
              <div className="flex flex-col gap-4">
                {active.length === 0 && <Empty>{t('my.noCards')}</Empty>}
                <ul className="grid gap-3 md:grid-cols-2">
                  {active.map((c) => <li key={c.id}><CardView card={c} /></li>)}
                </ul>
                {old.length > 0 && (
                  <>
                    <h3 className="text-lg font-semibold">{t('my.expiredCards')}</h3>
                    <ul className="grid gap-3 md:grid-cols-2">
                      {old.map((c) => <li key={c.id}><CardView card={c} /></li>)}
                    </ul>
                  </>
                )}
              </div>
            );
          }}
        </Async>
      </section>

      <section aria-labelledby="h-past">
        <h2 id="h-past" className="mb-3 text-xl font-bold">{t('my.past')}</h2>
        <Async state={past}>
          {(list) =>
            list.length === 0 ? (
              <Empty>{t('my.noPast')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((b) => <li key={b.id}><BookingRow booking={b} /></li>)}
              </ul>
            )
          }
        </Async>
      </section>

      {cancelling && (
        <CancelDialog
          bookingId={cancelling.id}
          label={`${cancelling.session.name}, ${formatDateTime(cancelling.session.startsAt, lang)}`}
          onClose={() => setCancelling(null)}
          onDone={(b) => {
            setCancelling(null);
            setMsg(b.status === 'LATE_CANCELLED' ? t('cancel.doneLate') : t('cancel.done'));
            reloadAll();
          }}
        />
      )}
    </>
  );
}
