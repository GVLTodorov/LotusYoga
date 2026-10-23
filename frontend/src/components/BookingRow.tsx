import type { Booking, BookingStatus } from '../api/types';
import { useI18n } from '../i18n';
import { formatDateTime } from '../lib/dates';
import { Badge, Card } from './ui';

const tone: Record<BookingStatus, 'gray' | 'green' | 'red' | 'amber' | 'blue'> = {
  BOOKED: 'blue', ATTENDED: 'green', NO_SHOW: 'red', LATE_CANCELLED: 'amber', CANCELLED: 'gray', CLASS_CANCELLED: 'gray',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useI18n();
  return <Badge tone={tone[status]}>{t(`booking.${status}`)}</Badge>;
}

export default function BookingRow({ booking: b, children }: { booking: Booking; children?: React.ReactNode }) {
  const { t, lang } = useI18n();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold break-words">{b.session.name}</p>
          <p>{formatDateTime(b.session.startsAt, lang)} · {b.session.instructor.name}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={b.status} />
          {b.walkIn && <Badge>{t('my.walkIn')}</Badge>}
        </div>
      </div>
      {children}
    </Card>
  );
}
