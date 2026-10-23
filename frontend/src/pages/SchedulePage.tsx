import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Session } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import CancelDialog from '../components/CancelDialog';
import { Async, Badge, Button, Card, Empty, ErrorBox, Notice, PageTitle, useLoad } from '../components/ui';
import { useI18n } from '../i18n';
import { addDays, dateKey, endTime, formatDateTime, formatDayHeading, mondayOf, timeOf, todayKey } from '../lib/dates';

export function groupByDay(sessions: Session[]): Map<string, Session[]> {
  const m = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const k = dateKey(s.startsAt);
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return m;
}

export default function SchedulePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const state = useLoad(() => api.sessions(), [user?.id]);
  return (
    <>
      <PageTitle>{t('schedule.title')}</PageTitle>
      <Async state={state}>
        {(sessions) => <Weeks sessions={sessions} reload={state.reload} />}
      </Async>
    </>
  );
}

function Weeks({ sessions, reload }: { sessions: Session[]; reload: () => void }) {
  const { t, lang } = useI18n();
  const groups = useMemo(() => groupByDay(sessions), [sessions]);
  const monday = mondayOf(todayKey());
  const weeks = [
    { title: t('schedule.thisWeek'), start: monday },
    { title: t('schedule.nextWeek'), start: addDays(monday, 7) },
  ];
  if (sessions.length === 0) return <Empty>{t('schedule.empty')}</Empty>;
  return (
    <div className="flex flex-col gap-8">
      {weeks.map((w) => {
        const days = Array.from({ length: 7 }, (_, i) => addDays(w.start, i)).filter((d) => groups.has(d));
        return (
          <section key={w.start} aria-label={w.title}>
            <h2 className="mb-3 text-xl font-bold text-brand-800">{w.title}</h2>
            {days.length === 0 ? (
              <Empty>{t('schedule.empty')}</Empty>
            ) : (
              <div className="flex flex-col gap-5">
                {days.map((d) => (
                  <div key={d}>
                    <h3 className="mb-2 text-lg font-semibold capitalize">{formatDayHeading(d, lang)}</h3>
                    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {groups.get(d)!.map((s) => (
                        <li key={s.id}><SessionCard session={s} reload={reload} /></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SessionCard({ session: s, reload }: { session: Session; reload: () => void }) {
  const { t, lang, err } = useI18n();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const cancelled = s.status === 'CANCELLED';
  const full = s.freeSpots <= 0;
  const label = `${s.name}, ${formatDateTime(s.startsAt, lang)}`;

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await action();
      setMsg(ok);
      reload();
    } catch (e) {
      setError(e);
      reload();
    } finally {
      setBusy(false);
    }
  }

  let action: React.ReactNode = null;
  if (!cancelled) {
    if (!user) {
      if (new Date(s.bookingClosesAt) > new Date()) {
        action = <Link to="/login" className="inline-flex min-h-12 items-center font-semibold text-brand-700 underline">{t('action.loginToBook')}</Link>;
      }
    } else {
      switch (s.myState) {
        case 'CAN_BOOK':
          action = <Button disabled={busy} onClick={() => run(() => api.book(s.id), t('booking.done'))}>{t('action.book')}</Button>;
          break;
        case 'CAN_JOIN_WAITLIST':
          action = (
            <>
              <Button disabled={busy} onClick={() => run(() => api.joinWaitlist(s.id), t('waitlist.joined'))}>{t('action.joinWaitlist')}</Button>
              <p className="mt-1 text-sm text-slate-600">{t('waitlist.hint')}</p>
            </>
          );
          break;
        case 'BOOKED':
          action = (
            <>
              <Badge tone="green">✓ {t('state.BOOKED')}</Badge>
              {s.myBookingId && <Button variant="secondary" className="mt-2" onClick={() => setCancelling(true)}>{t('action.cancelBooking')}</Button>}
            </>
          );
          break;
        case 'WAITLISTED':
          action = (
            <>
              <Badge tone="amber">{t('state.WAITLISTED', { n: s.myWaitlistPosition ?? '?' })}</Badge>
              {s.myWaitlistId && (
                <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => run(() => api.leaveWaitlist(s.myWaitlistId!), t('waitlist.left'))}>
                  {t('action.leaveWaitlist')}
                </Button>
              )}
            </>
          );
          break;
        case 'NOT_OPEN':
          action = <Badge>{t('state.NOT_OPEN')}</Badge>;
          break;
        case 'CLOSED':
          action = <Badge>{t('state.CLOSED')}</Badge>;
          break;
      }
    }
  }

  return (
    <Card className={cancelled ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums">
          {timeOf(s.startsAt)}<span className="text-base font-normal text-slate-600"> – {endTime(s.startsAt, s.durationMin)}</span>
        </p>
        {cancelled ? <Badge tone="red">{t('schedule.cancelled')}</Badge> : full ? <Badge tone="red">{t('schedule.full')}</Badge> : <Badge tone="green">{t('schedule.free', { n: s.freeSpots })}</Badge>}
      </div>
      <p className="mt-1 text-lg font-semibold">{s.name}</p>
      <p className="text-slate-700">{t('schedule.instructor')}: {s.instructor.name}</p>
      {!cancelled && full && s.waitlistCount > 0 && <p className="text-sm text-slate-600">{t('schedule.waitlistCount', { n: s.waitlistCount })}</p>}
      {action && <div className="mt-3 flex flex-col items-start">{action}</div>}
      {msg && <div className="mt-3"><Notice>{msg}</Notice></div>}
      {error != null && <div className="mt-3"><ErrorBox message={err(error)} /></div>}
      {cancelling && s.myBookingId && (
        <CancelDialog
          bookingId={s.myBookingId}
          label={label}
          onClose={() => setCancelling(false)}
          onDone={(b) => {
            setCancelling(false);
            setMsg(b.status === 'LATE_CANCELLED' ? t('cancel.doneLate') : t('cancel.done'));
            reload();
          }}
        />
      )}
    </Card>
  );
}
