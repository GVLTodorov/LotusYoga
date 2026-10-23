import type { Card as CardT } from '../api/types';
import { useI18n } from '../i18n';
import { formatDate } from '../lib/dates';
import { Badge, Card } from './ui';

export default function CardView({ card, children }: { card: CardT; children?: React.ReactNode }) {
  const { t, lang } = useI18n();
  const expired = new Date(card.expiresAt) < new Date();
  const exhausted = !expired && !card.isActive;
  return (
    <Card className={card.isActive ? 'border-brand-600 border-2' : 'opacity-80'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-bold">{t(`card.${card.type}`)}</p>
        {card.isActive ? <Badge tone="green">{card.remainingClasses === null ? t('card.unlimited') : t('card.left', { n: card.remainingClasses })}</Badge> : <Badge tone="gray">{expired ? t('card.expired', { date: formatDate(card.expiresAt, lang) }) : t('card.exhausted')}</Badge>}
      </div>
      {card.isActive && <p>{t('card.expires', { date: formatDate(card.expiresAt, lang) })}</p>}
      {exhausted && <p>{t('card.expires', { date: formatDate(card.expiresAt, lang) })}</p>}
      {card.totalClasses !== null && !card.isActive && (
        <p className="text-sm text-slate-600">{t('card.used', { used: card.usedClasses, total: card.totalClasses })}</p>
      )}
      {children}
    </Card>
  );
}
