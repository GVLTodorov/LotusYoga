import { formatSofiaDate, formatSofiaDateTime } from '../time.js';

export type EmailTemplate = 'BOOKING_CONFIRMED' | 'WAITLIST_PROMOTED' | 'SESSION_CANCELLED' | 'REMINDER' | 'CARD_LOW' | 'CARD_EXPIRING';
export type EmailLang = 'bg' | 'en';

export interface EmailPayload {
  name?: string;
  sessionName?: string;
  startsAt?: string;
  instructor?: string;
  reason?: string | null;
  expiresAt?: string;
  remaining?: number | null;
  appUrl?: string;
}

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Strings {
  hi: (n: string) => string;
  bookingSubject: (c: string) => string;
  booking: (c: string, when: string, who: string) => string;
  promotedSubject: (c: string) => string;
  promoted: (c: string, when: string) => string;
  cancelledSubject: (c: string) => string;
  cancelled: (c: string, when: string) => string;
  reason: (r: string) => string;
  classReturned: string;
  reminderSubject: (c: string) => string;
  reminder: (c: string, when: string) => string;
  lowSubject: string;
  low: string;
  expiringSubject: string;
  expiring: (d: string) => string;
  manage: string;
  bye: string;
}

const STR: Record<EmailLang, Strings> = {
  bg: {
    hi: (n) => `Здравей, ${n}!`,
    bookingSubject: (c) => `Потвърдена резервация: ${c}`,
    booking: (c, when, who) => `Резервацията ти за "${c}" е потвърдена.\nКога: ${when}${who ? `\nИнструктор: ${who}` : ''}`,
    promotedSubject: (c) => `Освободи се място: ${c}`,
    promoted: (c, when) => `Освободи се място и си записан/а от списъка на чакащите за "${c}".\nКога: ${when}`,
    cancelledSubject: (c) => `Отменено занятие: ${c}`,
    cancelled: (c, when) => `Съжаляваме, занятието "${c}" (${when}) е отменено от студиото.`,
    reason: (r) => `Причина: ${r}`,
    classReturned: 'Заниманието е върнато в картата ти.',
    reminderSubject: (c) => `Напомняне за утре: ${c}`,
    reminder: (c, when) => `Напомняме ти, че утре имаш записано занятие "${c}".\nКога: ${when}`,
    lowSubject: 'Остана ти 1 занимание в картата',
    low: 'В картата ти е останало 1 занимание.',
    expiringSubject: 'Картата ти изтича скоро',
    expiring: (d) => `Картата ти изтича на ${d}.`,
    manage: 'Управление на резервациите',
    bye: 'Поздрави, StudioBook',
  },
  en: {
    hi: (n) => `Hi ${n},`,
    bookingSubject: (c) => `Booking confirmed: ${c}`,
    booking: (c, when, who) => `Your booking for "${c}" is confirmed.\nWhen: ${when}${who ? `\nInstructor: ${who}` : ''}`,
    promotedSubject: (c) => `You got a spot: ${c}`,
    promoted: (c, when) => `A spot opened up and you have been booked from the waiting list for "${c}".\nWhen: ${when}`,
    cancelledSubject: (c) => `Class cancelled: ${c}`,
    cancelled: (c, when) => `We are sorry, the class "${c}" (${when}) has been cancelled by the studio.`,
    reason: (r) => `Reason: ${r}`,
    classReturned: 'The class has been returned to your card.',
    reminderSubject: (c) => `Reminder for tomorrow: ${c}`,
    reminder: (c, when) => `Just a reminder that you are booked tomorrow for "${c}".\nWhen: ${when}`,
    lowSubject: 'You have 1 class left on your card',
    low: 'Your card has 1 class left.',
    expiringSubject: 'Your card expires soon',
    expiring: (d) => `Your card expires on ${d}.`,
    manage: 'Manage your bookings',
    bye: 'Best regards, StudioBook',
  },
};

export function renderEmail(template: EmailTemplate | string, lang: EmailLang, p: EmailPayload): Rendered {
  const s = STR[lang] ?? STR.bg;
  const when = p.startsAt ? formatSofiaDateTime(new Date(p.startsAt), lang) : '';
  const cls = p.sessionName ?? '';
  const lines: string[] = [s.hi(p.name ?? '')];
  let subject: string;
  switch (template) {
    case 'BOOKING_CONFIRMED':
      subject = s.bookingSubject(cls);
      lines.push(s.booking(cls, when, p.instructor ?? ''));
      break;
    case 'WAITLIST_PROMOTED':
      subject = s.promotedSubject(cls);
      lines.push(s.promoted(cls, when));
      break;
    case 'SESSION_CANCELLED':
      subject = s.cancelledSubject(cls);
      lines.push(s.cancelled(cls, when));
      if (p.reason) lines.push(s.reason(p.reason));
      lines.push(s.classReturned);
      break;
    case 'REMINDER':
      subject = s.reminderSubject(cls);
      lines.push(s.reminder(cls, when));
      break;
    case 'CARD_LOW':
      subject = s.lowSubject;
      lines.push(s.low);
      break;
    case 'CARD_EXPIRING':
      subject = s.expiringSubject;
      lines.push(s.expiring(p.expiresAt ? formatSofiaDate(new Date(p.expiresAt), lang) : ''));
      break;
    default:
      throw new Error(`Unknown email template ${template}`);
  }
  if (p.appUrl) lines.push(`${s.manage}: ${p.appUrl}`);
  lines.push(s.bye);
  const text = lines.join('\n\n');
  const html = `<div style="font-family:sans-serif">${lines.map((l) => `<p>${escapeHtml(l).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  return { subject, text, html };
}
