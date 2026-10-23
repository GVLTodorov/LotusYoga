import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Attendee, ClientHit, InstructorDay } from '../api/types';
import { StatusBadge } from '../components/BookingRow';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Modal, Notice, PageTitle, useLoad } from '../components/ui';
import { useI18n } from '../i18n';
import { addDays, endTime, formatDayHeading, timeOf, todayKey } from '../lib/dates';

export default function TodayPage() {
  const { t, lang } = useI18n();
  const [date, setDate] = useState(todayKey());
  const state = useLoad(() => api.instructorSessions(date), [date]);
  return (
    <>
      <PageTitle>{t('nav.today')}</PageTitle>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Button variant="secondary" aria-label={t('common.prev')} onClick={() => setDate(addDays(date, -1))}>‹</Button>
        <div className="min-w-0 flex-1 sm:flex-none sm:w-56">
          <Field label={t('instr.date')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <Button variant="secondary" aria-label={t('common.next')} onClick={() => setDate(addDays(date, 1))}>›</Button>
        <Button variant="ghost" onClick={() => setDate(todayKey())}>{t('instr.today')}</Button>
      </div>
      <h2 className="mb-3 text-lg font-semibold capitalize">{formatDayHeading(date, lang)}</h2>
      <Async state={state}>
        {(days) =>
          days.length === 0 ? (
            <Empty>{t('instr.empty')}</Empty>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2">
              {days.map((d) => (
                <li key={d.session.id}><SessionBlock day={d} reload={state.reload} /></li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}

function SessionBlock({ day, reload }: { day: InstructorDay; reload: () => void }) {
  const { t, err } = useI18n();
  const { session: s } = day;
  const [attendees, setAttendees] = useState<Attendee[]>(day.attendees);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setAttendees(day.attendees), [day.attendees]);

  async function mark(a: Attendee, status: 'ATTENDED' | 'NO_SHOW') {
    setError(null);
    setMsg(null);
    try {
      const r = await api.setAttendance(a.bookingId, status);
      setAttendees((list) => list.map((x) => (x.bookingId === a.bookingId ? { ...x, status: r.status } : x)));
      setMsg(t('instr.attendanceSaved'));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums">{timeOf(s.startsAt)} – {endTime(s.startsAt, s.durationMin)}</p>
          <p className="text-lg font-semibold">{s.name}</p>
          <p className="text-slate-600">{s.instructor.name}</p>
        </div>
        <Badge tone="blue">{t('instr.booked', { n: attendees.length, cap: s.capacity })}</Badge>
      </div>
      {attendees.length === 0 ? (
        <p className="my-3 text-slate-600">{t('instr.noAttendees')}</p>
      ) : (
        <ul className="my-3 divide-y divide-slate-200">
          {attendees.map((a) => (
            <li key={a.bookingId} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{a.name}</p>
                  <a className="inline-flex min-h-11 items-center text-brand-700 underline" href={`tel:${a.phone.replace(/\s/g, '')}`}>{a.phone}</a>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" variant={a.status === 'ATTENDED' ? 'primary' : 'secondary'} aria-pressed={a.status === 'ATTENDED'} onClick={() => mark(a, 'ATTENDED')}>
                  ✓ {t('instr.attended')}
                </Button>
                <Button className="flex-1" variant={a.status === 'NO_SHOW' ? 'danger' : 'secondary'} aria-pressed={a.status === 'NO_SHOW'} onClick={() => mark(a, 'NO_SHOW')}>
                  ✗ {t('instr.noShow')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <div className="mb-3"><Notice>{msg}</Notice></div>}
      {error != null && <div className="mb-3"><ErrorBox message={err(error)} /></div>}
      <Button variant="secondary" onClick={() => setAdding(true)}>+ {t('instr.walkIn')}</Button>
      {adding && (
        <WalkInDialog
          sessionId={s.id}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setMsg(t('instr.added'));
            reload();
          }}
        />
      )}
    </Card>
  );
}

function WalkInDialog({ sessionId, onClose, onAdded }: { sessionId: string; onClose: () => void; onAdded: () => void }) {
  const { t, err } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ClientHit[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const h = setTimeout(() => {
      api.searchClients(term).then((r) => alive && setHits(r)).catch((e) => alive && setError(e));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q]);

  async function add(c: ClientHit) {
    setError(null);
    try {
      await api.walkIn(sessionId, c.id);
      onAdded();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Modal title={t('instr.walkIn')} onClose={onClose}>
      <Field label={t('instr.walkInSearch')} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {error != null && <ErrorBox message={err(error)} />}
      {hits && hits.length === 0 && <Empty>{t('instr.noResults')}</Empty>}
      {hits && hits.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {hits.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-semibold break-words">{c.name}</p>
                <p className="text-sm text-slate-600">{c.phoneHint}</p>
                {!c.hasValidCard && <p className="text-sm font-semibold text-red-700">{t('instr.noCard')}</p>}
              </div>
              <Button onClick={() => add(c)}>{t('instr.add')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
