import { useState } from 'react';
import { api } from '../api/client';
import type { Booking } from '../api/types';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Modal, Spinner, useLoad } from './ui';

interface Props {
  bookingId: string;
  label: string; // "Hatha, Tue 18:30"
  onClose: () => void;
  onDone: (b: Booking) => void;
}

/** AC-16/17/18: cancel dialog. Late cancel (< 6h, no promotedLate) is a loud red warning. */
export default function CancelDialog({ bookingId, label, onClose, onDone }: Props) {
  const { t, err } = useI18n();
  const preview = useLoad(() => api.cancelPreview(bookingId), [bookingId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const p = preview.data;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.cancelBooking(bookingId));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('cancel.title')} onClose={onClose}>
      <p className="font-semibold">{label}</p>
      {preview.loading && <Spinner />}
      {preview.error != null && <ErrorBox message={err(preview.error)} onRetry={preview.reload} />}
      {p && (
        <>
          <p>{t('cancel.hoursLeft', { n: Math.max(0, Math.round(p.hoursUntilStart * 10) / 10) })}</p>
          {p.lateCancel ? (
            <div role="alert" data-testid="late-warning" className="rounded-xl border-4 border-red-700 bg-red-50 p-4 text-red-900">
              <p className="text-xl font-extrabold">⚠ {t('cancel.lateTitle')}</p>
              <p className="mt-2 text-lg">{t('cancel.lateBody')}</p>
            </div>
          ) : (
            <p data-testid="returned-note" className="rounded-xl border-2 border-green-300 bg-green-50 p-4 text-green-900">
              {p.hoursUntilStart < 6 ? t('cancel.returnedLate') : t('cancel.returned')}
            </p>
          )}
        </>
      )}
      {error != null && <ErrorBox message={err(error)} />}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="secondary" onClick={onClose} className="flex-1">{t('cancel.keep')}</Button>
        <Button variant="danger" disabled={!p || busy} onClick={confirm} className="flex-1">
          {p?.lateCancel ? t('cancel.confirmLate') : t('cancel.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
