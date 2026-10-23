import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { InstructorRef, Session, Template } from '../../api/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Modal, Notice, PageTitle, Select, useLoad } from '../../components/ui';
import { useI18n } from '../../i18n';
import { addDays, dateKey, endTime, formatDateTime, sofiaToIso, timeOf, todayKey } from '../../lib/dates';

async function loadInstructors(): Promise<InstructorRef[]> {
  const [a, b] = await Promise.all([api.users(undefined, 'INSTRUCTOR'), api.users(undefined, 'ADMIN')]);
  return [...a.items, ...b.items].map((u) => ({ id: u.id, name: u.name }));
}

export default function AdminSchedulePage() {
  const { t } = useI18n();
  const instructors = useLoad(loadInstructors, []);
  const templates = useLoad(() => api.templates(), []);
  const sessions = useLoad(() => api.sessions(todayKey(), addDays(todayKey(), 14)), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [tplForm, setTplForm] = useState<Template | 'new' | null>(null);
  const [sesForm, setSesForm] = useState<Session | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [viewing, setViewing] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { err } = useI18n();
  const list = instructors.data ?? [];

  const refresh = () => {
    templates.reload();
    sessions.reload();
  };

  return (
    <>
      <PageTitle>{t('admin.sessions')}</PageTitle>
      {msg && <div className="mb-4"><Notice>{msg}</Notice></div>}
      {error != null && <div className="mb-4"><ErrorBox message={err(error)} /></div>}
      {instructors.data && list.length === 0 && <div className="mb-4"><Notice tone="amber">{t('admin.noInstructors')}</Notice></div>}

      <section className="mb-10" aria-labelledby="h-tpl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="h-tpl" className="text-xl font-bold">{t('admin.templates')}</h2>
          <Button onClick={() => setTplForm('new')}>+ {t('admin.newTemplate')}</Button>
        </div>
        <Async state={templates}>
          {(tpls) =>
            tpls.length === 0 ? (
              <Empty>{t('admin.noTemplates')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tpls.map((tp) => (
                  <li key={tp.id}>
                    <Card className={tp.active ? '' : 'opacity-70'}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-lg font-bold break-words">{tp.name}</p>
                        <Badge tone={tp.active ? 'green' : 'gray'}>{tp.active ? t('admin.active') : t('admin.inactive')}</Badge>
                      </div>
                      <p>{t(`weekday.${tp.weekday}`)}, {tp.startTime} · {tp.durationMin} {t('common.min')}</p>
                      <p className="text-slate-600">{tp.instructor.name} · {t('admin.capacity')}: {tp.capacity}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setTplForm(tp)}>{t('common.edit')}</Button>
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            setError(null);
                            try {
                              await api.updateTemplate(tp.id, { active: !tp.active });
                              refresh();
                            } catch (e) {
                              setError(e);
                            }
                          }}
                        >
                          {tp.active ? t('admin.deactivate') : t('admin.activate')}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      <section aria-labelledby="h-ses">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="h-ses" className="text-xl font-bold">{t('admin.upcomingSessions')}</h2>
          <Button onClick={() => setSesForm('new')}>+ {t('admin.newSession')}</Button>
        </div>
        <Async state={sessions}>
          {(list2) =>
            list2.length === 0 ? (
              <Empty>{t('schedule.empty')}</Empty>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list2.map((s) => (
                  <li key={s.id}>
                    <Card className={s.status === 'CANCELLED' ? 'opacity-70' : ''}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-bold"><SessionWhen s={s} /></p>
                        {s.status === 'CANCELLED' ? <Badge tone="red">{t('schedule.cancelled')}</Badge> : <Badge tone="blue">{s.bookedCount}/{s.capacity}</Badge>}
                      </div>
                      <p className="text-lg font-semibold break-words">{s.name}</p>
                      <p className="text-slate-600">{s.instructor.name}{s.waitlistCount > 0 ? ` · ${t('schedule.waitlistCount', { n: s.waitlistCount })}` : ''}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="ghost" onClick={() => setViewing(s)}>{t('admin.attendees')}</Button>
                        {s.status !== 'CANCELLED' && (
                          <>
                            <Button variant="secondary" onClick={() => setSesForm(s)}>{t('common.edit')}</Button>
                            <Button variant="danger" onClick={() => setCancelling(s)}>{t('admin.cancelSession')}</Button>
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      {tplForm && (
        <TemplateForm
          initial={tplForm === 'new' ? null : tplForm}
          instructors={list}
          onClose={() => setTplForm(null)}
          onSaved={() => {
            setTplForm(null);
            setMsg(t('common.saved'));
            refresh();
          }}
        />
      )}
      {sesForm && (
        <SessionForm
          initial={sesForm === 'new' ? null : sesForm}
          instructors={list}
          onClose={() => setSesForm(null)}
          onSaved={() => {
            setSesForm(null);
            setMsg(t('common.saved'));
            sessions.reload();
          }}
        />
      )}
      {cancelling && (
        <CancelSessionDialog
          session={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            setMsg(t('admin.sessionCancelled'));
            sessions.reload();
          }}
        />
      )}
      {viewing && <AttendeesDialog session={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function SessionWhen({ s }: { s: Session }) {
  const { lang } = useI18n();
  return <>{formatDateTime(s.startsAt, lang)} – {endTime(s.startsAt, s.durationMin)}</>;
}

function TemplateForm({ initial, instructors, onClose, onSaved }: {
  initial: Template | null; instructors: InstructorRef[]; onClose: () => void; onSaved: () => void;
}) {
  const { t, err } = useI18n();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    instructorId: initial?.instructor.id ?? instructors[0]?.id ?? '',
    weekday: String(initial?.weekday ?? 1),
    startTime: initial?.startTime ?? '18:30',
    durationMin: String(initial?.durationMin ?? 75),
    capacity: String(initial?.capacity ?? 14),
    validFrom: initial?.validFrom ?? todayKey(),
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(), instructorId: f.instructorId, weekday: Number(f.weekday), startTime: f.startTime,
      durationMin: Number(f.durationMin), capacity: Number(f.capacity), validFrom: f.validFrom,
    };
    try {
      if (initial) await api.updateTemplate(initial.id, body);
      else await api.createTemplate(body);
      onSaved();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? t('admin.editTemplate') : t('admin.newTemplate')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('common.name')} required maxLength={100} value={f.name} onChange={set('name')} />
        <Select label={t('admin.instructor')} required value={f.instructorId} onChange={set('instructorId')}>
          {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Select label={t('admin.weekday')} value={f.weekday} onChange={set('weekday')}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`weekday.${d}` as 'weekday.1')}</option>)}
        </Select>
        <Field label={t('admin.startTime')} type="time" required value={f.startTime} onChange={set('startTime')} />
        <Field label={t('admin.duration')} type="number" inputMode="numeric" min={15} max={240} required value={f.durationMin} onChange={set('durationMin')} />
        <Field label={t('admin.capacity')} type="number" inputMode="numeric" min={1} max={50} required value={f.capacity} onChange={set('capacity')} />
        <Field label={t('admin.validFrom')} type="date" required value={f.validFrom} onChange={set('validFrom')} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy || !f.instructorId}>{t('common.save')}</Button>
      </form>
    </Modal>
  );
}

function SessionForm({ initial, instructors, onClose, onSaved }: {
  initial: Session | null; instructors: InstructorRef[]; onClose: () => void; onSaved: () => void;
}) {
  const { t, err } = useI18n();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    instructorId: initial?.instructor.id ?? instructors[0]?.id ?? '',
    date: initial ? dateKey(initial.startsAt) : todayKey(),
    time: initial ? timeOf(initial.startsAt) : '18:30',
    durationMin: String(initial?.durationMin ?? 75),
    capacity: String(initial?.capacity ?? 14),
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(), instructorId: f.instructorId, startsAt: sofiaToIso(f.date, f.time),
      durationMin: Number(f.durationMin), capacity: Number(f.capacity),
    };
    try {
      if (initial) await api.updateSession(initial.id, body);
      else await api.createSession(body);
      onSaved();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? t('admin.editSession') : t('admin.newSession')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('common.name')} required maxLength={100} value={f.name} onChange={set('name')} />
        <Select label={t('admin.instructor')} required value={f.instructorId} onChange={set('instructorId')}>
          {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Field label={t('admin.date')} type="date" required value={f.date} onChange={set('date')} />
        <Field label={t('admin.startTime')} type="time" required value={f.time} onChange={set('time')} />
        <Field label={t('admin.duration')} type="number" inputMode="numeric" min={15} max={240} required value={f.durationMin} onChange={set('durationMin')} />
        <Field label={t('admin.capacity')} type="number" inputMode="numeric" min={1} max={50} required value={f.capacity} onChange={set('capacity')} />
        {error != null && <ErrorBox message={err(error)} />}
        <Button type="submit" disabled={busy || !f.instructorId}>{t('common.save')}</Button>
      </form>
    </Modal>
  );
}

function CancelSessionDialog({ session, onClose, onDone }: { session: Session; onClose: () => void; onDone: () => void }) {
  const { t, err, lang } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelSession(session.id, reason.trim() || undefined);
      onDone();
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('admin.cancelSessionTitle')} onClose={onClose}>
      <p className="font-semibold">{session.name}, {formatDateTime(session.startsAt, lang)}</p>
      <p role="alert" className="rounded-xl border-4 border-red-700 bg-red-50 p-3 text-red-900">{t('admin.cancelSessionWarn')}</p>
      <Field label={t('admin.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      {error != null && <ErrorBox message={err(error)} />}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.back')}</Button>
        <Button variant="danger" className="flex-1" disabled={busy} onClick={go}>{t('admin.cancelSession')}</Button>
      </div>
    </Modal>
  );
}

function AttendeesDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const { t } = useI18n();
  const state = useLoad(() => api.sessionAttendees(session.id), [session.id]);
  return (
    <Modal title={`${session.name}`} onClose={onClose}>
      <Async state={state}>
        {(d) => (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-bold">{t('admin.attendees')} ({d.attendees.length})</h3>
              {d.attendees.length === 0 ? <p className="text-slate-600">{t('instr.noAttendees')}</p> : (
                <ul className="divide-y divide-slate-200">
                  {d.attendees.map((a) => <li key={a.bookingId} className="py-2 break-words">{a.name} · {a.phone}</li>)}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-bold">{t('admin.waitlist')} ({d.waitlist.length})</h3>
              <ul className="divide-y divide-slate-200">
                {d.waitlist.map((w) => <li key={w.id} className="py-2 break-words">{w.position}. {w.name}</li>)}
              </ul>
            </div>
          </div>
        )}
      </Async>
    </Modal>
  );
}
