import { useState } from 'react';
import { api } from '../../api/client';
import type { CardType } from '../../api/types';
import { Async, Button, Card, Field, PageTitle, useLoad } from '../../components/ui';
import { useI18n } from '../../i18n';
import { currentMonthKey, formatMonth } from '../../lib/dates';

const TYPES: CardType[] = ['SINGLE', 'PACK_8', 'PACK_12', 'UNLIMITED_MONTH'];

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export default function ReportPage() {
  const { t, lang } = useI18n();
  const [month, setMonth] = useState(currentMonthKey());
  const state = useLoad(() => api.monthlyReport(month), [month]);
  return (
    <>
      <PageTitle>{t('report.title')}</PageTitle>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Button variant="secondary" aria-label={t('common.prev')} onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
        <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
          <Field label={t('report.month')} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <Button variant="secondary" aria-label={t('common.next')} onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
      </div>
      <h2 className="mb-3 text-lg font-semibold capitalize">{formatMonth(month, lang)}</h2>
      <Async state={state}>
        {(r) => (
          <div className="flex flex-col gap-6">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [t('report.classesHeld'), String(r.classesHeld)],
                [t('report.avgAttendance'), r.avgAttendance.toFixed(1)],
                [t('report.noShows'), String(r.noShowCount)],
                [t('report.noShowRate'), pct(r.noShowRate)],
              ].map(([k, v]) => (
                <Card key={k}>
                  <dd className="text-3xl font-extrabold">{v}</dd>
                  <dt className="text-slate-600">{k}</dt>
                </Card>
              ))}
            </dl>
            <Card>
              <h3 className="mb-2 text-lg font-bold">{t('report.cardsSold')}</h3>
              <table className="w-full text-left">
                <tbody>
                  {TYPES.map((c) => (
                    <tr key={c} className="border-t border-slate-200">
                      <th scope="row" className="py-2 font-normal">{t(`card.${c}`)}</th>
                      <td className="py-2 text-right font-semibold">{r.cardsSold[c]}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-400">
                    <th scope="row" className="py-2">{t('report.total')}</th>
                    <td className="py-2 text-right text-lg font-bold">{r.cardsSold.total}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
