// Types copied from docs/api-contract.md (source of truth).
export type Role = 'CLIENT' | 'INSTRUCTOR' | 'ADMIN';
export type Lang = 'bg' | 'en';
export type CardType = 'SINGLE' | 'PACK_8' | 'PACK_12' | 'UNLIMITED_MONTH';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
export type SessionStatus = 'SCHEDULED' | 'CANCELLED';
export type BookingStatus = 'BOOKED' | 'CANCELLED' | 'LATE_CANCELLED' | 'ATTENDED' | 'NO_SHOW' | 'CLASS_CANCELLED';
export type WaitlistStatus = 'WAITING' | 'PROMOTED' | 'LEFT' | 'EXPIRED' | 'CLASS_CANCELLED';
export type ClientState =
  | 'BOOKED'
  | 'WAITLISTED'
  | 'CAN_BOOK'
  | 'CAN_JOIN_WAITLIST'
  | 'NOT_OPEN'
  | 'CLOSED'
  | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: Role;
  lang: Lang;
  blocked: boolean;
  createdAt: string;
}
export interface InstructorRef {
  id: string;
  name: string;
}

export interface Session {
  id: string;
  templateId: string | null;
  name: string;
  startsAt: string;
  durationMin: number;
  instructor: InstructorRef;
  capacity: number;
  bookedCount: number;
  freeSpots: number;
  waitlistCount: number;
  status: SessionStatus;
  bookingOpensAt: string;
  bookingClosesAt: string;
  myState?: ClientState;
  myBookingId?: string | null;
  myWaitlistId?: string | null;
  myWaitlistPosition?: number | null;
}

export interface CardEvent {
  id: string;
  type: 'CREATED' | 'EXPIRY_CHANGED';
  oldExpiresAt: string | null;
  newExpiresAt: string | null;
  note: string | null;
  byUser: InstructorRef;
  createdAt: string;
}
export interface Card {
  id: string;
  userId: string;
  type: CardType;
  totalClasses: number | null;
  usedClasses: number;
  remainingClasses: number | null;
  validFrom: string;
  expiresAt: string;
  paymentMethod: PaymentMethod;
  priceBgn: number | null;
  createdAt: string;
  isActive: boolean;
  events?: CardEvent[];
}

export interface Booking {
  id: string;
  status: BookingStatus;
  walkIn: boolean;
  promotedLate: boolean;
  cardId: string | null;
  createdAt: string;
  cancelledAt: string | null;
  session: Session;
}
export interface WaitlistEntry {
  id: string;
  status: WaitlistStatus;
  position: number | null;
  createdAt: string;
  session: Session;
}
export interface Attendee {
  bookingId: string;
  userId: string;
  name: string;
  phone: string;
  status: BookingStatus;
  walkIn: boolean;
}

export interface Template {
  id: string;
  name: string;
  instructor: InstructorRef;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: string;
  durationMin: number;
  capacity: number;
  validFrom: string;
  active: boolean;
}

export interface AuthResult {
  token: string;
  user: User;
}
export interface CancelPreview {
  lateCancel: boolean;
  classReturned: boolean;
  hoursUntilStart: number;
}
export interface InstructorDay {
  session: Session;
  attendees: Attendee[];
}
export interface ClientHit {
  // phoneHint: last 3 digits only
  id: string;
  name: string;
  phoneHint: string;
  hasValidCard: boolean;
}
export interface AdminUser extends User {
  activeCard: Card | null;
}
export interface UserHistory {
  user: User;
  cards: Card[];
  bookings: Booking[];
  stats: { attended: number; noShows: number; lateCancels: number };
}
export interface AdminSessionDetail {
  session: Session;
  attendees: Attendee[];
  waitlist: { id: string; userId: string; name: string; position: number }[];
}
export interface MonthlyReport {
  month: string;
  classesHeld: number;
  avgAttendance: number;
  noShowCount: number;
  noShowRate: number;
  cardsSold: Record<CardType, number> & { total: number };
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'USER_BLOCKED'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'SESSION_FULL'
  | 'SESSION_NOT_FULL'
  | 'SESSION_CANCELLED'
  | 'SESSION_STARTED'
  | 'BOOKING_NOT_OPEN'
  | 'BOOKING_CLOSED'
  | 'ALREADY_BOOKED'
  | 'ALREADY_ON_WAITLIST'
  | 'NO_VALID_CARD'
  | 'DAILY_LIMIT'
  | 'CAPACITY_BELOW_BOOKED'
  | 'ATTENDANCE_WINDOW'
  | 'INVALID_STATE'
  | 'RATE_LIMITED';
