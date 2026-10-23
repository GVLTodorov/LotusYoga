# StudioBook — API contract (v1)

Source of truth for frontend ↔ backend. Changes need the brain's approval.

## Conventions
- Base path `/api`. JSON only. The same server also serves the built UI at `/` (SPA fallback) and
  `GET /health` → `200 {"status":"ok"}`.
- Auth: `Authorization: Bearer <jwt>`. Token lifetime 30 days. JWT payload `{ sub: userId, role }`.
  Auth levels used below: **public**, **optional** (works without token, adds per-user fields with one),
  **client**, **instructor** (INSTRUCTOR or ADMIN), **admin**.
- Timestamps: ISO-8601 UTC strings (`2026-11-03T16:30:00.000Z`). Dates: `YYYY-MM-DD` (Sofia-local).
  Times of day: `HH:mm` (Sofia-local). The UI converts and shows Europe/Sofia.
- IDs: string (cuid).
- Errors: `{ "error": { "code": "SESSION_FULL", "message": "human readable (English)" } }`.
  The UI maps `code` to translated text. Validation errors add `"details": [{ "path": "phone", "message": "..." }]`.

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `USER_BLOCKED` |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `SESSION_FULL`, `SESSION_NOT_FULL`, `SESSION_CANCELLED`, `SESSION_STARTED`, `BOOKING_NOT_OPEN`, `BOOKING_CLOSED`, `ALREADY_BOOKED`, `ALREADY_ON_WAITLIST`, `NO_VALID_CARD`, `DAILY_LIMIT`, `CAPACITY_BELOW_BOOKED`, `ATTENDANCE_WINDOW`, `INVALID_STATE` |
| 429 | `RATE_LIMITED` (login/register: 10 per 15 min per IP) |

## Shared types
```ts
type Role = 'CLIENT' | 'INSTRUCTOR' | 'ADMIN';
type Lang = 'bg' | 'en';
type CardType = 'SINGLE' | 'PACK_8' | 'PACK_12' | 'UNLIMITED_MONTH';
// SINGLE: 1 class / 1 month; PACK_8: 8 / 2 months; PACK_12: 12 / 3 months; UNLIMITED_MONTH: null / 1 month, max 1 booking per Sofia day
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';
type SessionStatus = 'SCHEDULED' | 'CANCELLED';
type BookingStatus = 'BOOKED' | 'CANCELLED' | 'LATE_CANCELLED' | 'ATTENDED' | 'NO_SHOW' | 'CLASS_CANCELLED';
// "active" bookings (count toward capacity): BOOKED, ATTENDED, NO_SHOW
type WaitlistStatus = 'WAITING' | 'PROMOTED' | 'LEFT' | 'EXPIRED' | 'CLASS_CANCELLED';
type ClientState = 'BOOKED' | 'WAITLISTED' | 'CAN_BOOK' | 'CAN_JOIN_WAITLIST' | 'NOT_OPEN' | 'CLOSED' | 'CANCELLED';

interface User { id: string; email: string; name: string; phone: string; role: Role; lang: Lang; blocked: boolean; createdAt: string }
interface InstructorRef { id: string; name: string }

interface Session {
  id: string; templateId: string | null; name: string; startsAt: string; durationMin: number;
  instructor: InstructorRef; capacity: number; bookedCount: number; freeSpots: number;
  waitlistCount: number; status: SessionStatus;
  bookingOpensAt: string; bookingClosesAt: string;   // startsAt - 14d, startsAt - 30min
  // present only when called with a CLIENT token:
  myState?: ClientState; myBookingId?: string | null; myWaitlistId?: string | null; myWaitlistPosition?: number | null;
}

interface Card {
  id: string; userId: string; type: CardType; totalClasses: number | null; usedClasses: number;
  remainingClasses: number | null;     // null = unlimited
  validFrom: string /* date */; expiresAt: string /* ISO, end of day Sofia */;
  paymentMethod: PaymentMethod; priceBgn: number | null; createdAt: string;
  isActive: boolean;                   // not expired AND (unlimited OR remaining > 0)
  events?: CardEvent[];                // admin history only
}
interface CardEvent { id: string; type: 'CREATED' | 'EXPIRY_CHANGED'; oldExpiresAt: string | null; newExpiresAt: string | null; note: string | null; byUser: InstructorRef; createdAt: string }

interface Booking {
  id: string; status: BookingStatus; walkIn: boolean;
  promotedLate: boolean;               // got the spot from waitlist < 6h before start → free cancel
  cardId: string | null; createdAt: string; cancelledAt: string | null;
  session: Session;                    // without my* fields
}
interface WaitlistEntry { id: string; status: WaitlistStatus; position: number | null; createdAt: string; session: Session }
interface Attendee { bookingId: string; userId: string; name: string; phone: string; status: BookingStatus; walkIn: boolean }

interface Template {
  id: string; name: string; instructor: InstructorRef; weekday: 1|2|3|4|5|6|7 /* ISO, 1=Mon */;
  startTime: string /* HH:mm */; durationMin: number; capacity: number;
  validFrom: string /* date */; active: boolean;
}
```

## Card consumption rules (backend)
- On book / walk-in / waitlist promotion: pick the card valid on the session's Sofia date
  (`validFrom ≤ date`, `expiresAt ≥ startsAt`) with classes left (or unlimited without another active
  booking that day), earliest `expiresAt` first; increment `usedClasses` (unlimited: just link the card).
- Cancel ≥ 6 h before start, or `promotedLate`, or class cancelled by studio → decrement `usedClasses`.
- Late cancel and no-show → class stays used.
- Capacity is enforced in a transaction with a row lock on the session (or serializable isolation).

---

## Auth & me
### POST /api/auth/register — public
Req `{ email, password (min 8), name (1–100), phone (string, 6–20 chars, digits/+/space), lang?: Lang = 'bg' }`
→ 201 `{ token, user: User }`. Errors: 400, 409 `EMAIL_TAKEN`, 429.
```json
{ "email": "ivana@example.com", "password": "secret123", "name": "Ивана Петрова", "phone": "+359 888 123 456", "lang": "bg" }
```
### POST /api/auth/login — public
Req `{ email, password }` → 200 `{ token, user: User }`. Errors: 401 `INVALID_CREDENTIALS` (also for
deleted accounts), 429. Blocked users can log in (they just can't book).
### GET /api/me — client|instructor|admin → 200 `User`
### PATCH /api/me — any logged-in
Req `{ name?, phone?, lang? }` → 200 `User`.
### DELETE /api/me — CLIENT only
Req `{ password }` → 204. Anonymises: name → "Deleted client", email → `deleted-<id>@invalid`, phone → "",
password hash cleared, `deletedAt` set; future BOOKED → CANCELLED (no email); WAITING → LEFT.
Errors: 401 `INVALID_CREDENTIALS`, 403 for non-clients.

## Schedule
### GET /api/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD — optional
Default: Monday of current Sofia week → Sunday of next week. Max range 15 days. Includes cancelled
sessions. Sorted by `startsAt`. → 200 `Session[]`.
```json
[{ "id": "cs1", "templateId": "t1", "name": "Хатха йога", "startsAt": "2026-11-03T16:30:00.000Z", "durationMin": 75,
   "instructor": { "id": "u2", "name": "Елена" }, "capacity": 14, "bookedCount": 14, "freeSpots": 0, "waitlistCount": 2,
   "status": "SCHEDULED", "bookingOpensAt": "2026-10-20T16:30:00.000Z", "bookingClosesAt": "2026-11-03T16:00:00.000Z",
   "myState": "WAITLISTED", "myBookingId": null, "myWaitlistId": "w9", "myWaitlistPosition": 2 }]
```
### GET /api/sessions/:id — optional → 200 `Session`

## Bookings (client)
### POST /api/sessions/:id/bookings — client
No body → 201 `Booking`. Queues confirmation email.
Errors: 403 `USER_BLOCKED`; 404; 409 `SESSION_CANCELLED`, `BOOKING_NOT_OPEN`, `BOOKING_CLOSED`, `ALREADY_BOOKED`, `SESSION_FULL`, `NO_VALID_CARD`, `DAILY_LIMIT`.
If the client is WAITING on this session and a spot exists, the waitlist entry becomes PROMOTED.
### GET /api/me/bookings?scope=upcoming|past — client
upcoming: session not yet ended (`startsAt + durationMin > now`), status BOOKED, sorted ascending.
past: everything else, sorted descending, max 100. → 200 `Booking[]`.
### GET /api/bookings/:id/cancel-preview — client (own booking)
→ 200 `{ lateCancel: boolean, classReturned: boolean, hoursUntilStart: number }`
(`lateCancel` = < 6 h AND not `promotedLate`; `classReturned` = !lateCancel). Errors: 404, 409 `SESSION_STARTED`, `INVALID_STATE`.
### POST /api/bookings/:id/cancel — client (own booking)
→ 200 `Booking` (status `CANCELLED` or `LATE_CANCELLED`). Frees a spot → triggers waitlist promotion.
Errors: 404, 409 `SESSION_STARTED`, `INVALID_STATE` (not BOOKED).

## Waiting list (client)
### POST /api/sessions/:id/waitlist — client
→ 201 `WaitlistEntry`. Errors: 403 `USER_BLOCKED`; 409 `SESSION_NOT_FULL`, `ALREADY_BOOKED`,
`ALREADY_ON_WAITLIST`, `NO_VALID_CARD`, `BOOKING_NOT_OPEN`, `BOOKING_CLOSED`, `SESSION_CANCELLED`.
### DELETE /api/waitlist/:id — client (own) → 204 (status LEFT)
### GET /api/me/waitlist — client → 200 `WaitlistEntry[]` (status WAITING, upcoming)

Promotion (backend, in the same transaction as the event that frees the spot, and after admin capacity
increase): while free spots > 0 and now < bookingClosesAt, take WAITING entries by `createdAt`; for each,
if a valid card exists → create BOOKED booking (`promotedLate = startsAt - now < 6h`), entry → PROMOTED,
queue `WAITLIST_PROMOTED` email; else skip. At `bookingClosesAt` the worker sets remaining WAITING → EXPIRED.

## Cards (client)
### GET /api/me/cards — client → 200 `Card[]` (active first, then by expiresAt desc; no `events`)

## Instructor
### GET /api/instructor/sessions?date=YYYY-MM-DD — instructor
Default today (Sofia). INSTRUCTOR: only own sessions; ADMIN: all. Non-cancelled.
→ 200 `[{ session: Session, attendees: Attendee[] }]` (attendees = active bookings, sorted by name).
### PATCH /api/bookings/:id/attendance — instructor (own session) or admin
Req `{ status: 'ATTENDED' | 'NO_SHOW' }` → 200 `Attendee`. Allowed from 30 min before start until 24 h after
start, only on active bookings. Errors: 403, 404, 409 `ATTENDANCE_WINDOW`, `INVALID_STATE`.
### GET /api/instructor/clients?q=… — instructor
`q` ≥ 2 chars, matches name/email/phone, CLIENT role, not deleted, max 20 →
200 `[{ id, name, phone, hasValidCard: boolean }]`.
### POST /api/sessions/:id/walk-ins — instructor (own session) or admin
Req `{ userId }` → 201 `Attendee` (status ATTENDED, walkIn true). Ignores booking window; allowed from
30 min before start until session end. No email. Errors: 403 (incl. `USER_BLOCKED`), 404, 409 `SESSION_FULL`,
`NO_VALID_CARD`, `DAILY_LIMIT`, `ALREADY_BOOKED`, `SESSION_CANCELLED`, `ATTENDANCE_WINDOW`.

## Admin — schedule
### GET /api/admin/templates — admin → 200 `Template[]`
### POST /api/admin/templates — admin
Req `{ name, instructorId, weekday, startTime, durationMin (15–240), capacity (1–50, default 14), validFrom }`
→ 201 `Template`; generates sessions up to 15 days ahead.
### PATCH /api/admin/templates/:id — admin
Req: any of the POST fields, plus `active?: boolean` → 200 `Template`. Propagation per spec AC-29.
Errors: 409 `CAPACITY_BELOW_BOOKED`.
### POST /api/admin/sessions — admin (one-off)
Req `{ name, instructorId, startsAt (ISO), durationMin, capacity }` → 201 `Session`.
### PATCH /api/admin/sessions/:id — admin
Req `{ name?, instructorId?, startsAt?, durationMin?, capacity? }` → 200 `Session`. Capacity increase
triggers promotion. Errors: 409 `CAPACITY_BELOW_BOOKED`, `SESSION_CANCELLED`.
### POST /api/admin/sessions/:id/cancel — admin
Req `{ reason?: string }` → 200 `Session`. Bookings BOOKED → CLASS_CANCELLED (class returned, email
`SESSION_CANCELLED` incl. reason); WAITING → CLASS_CANCELLED. Errors: 409 `SESSION_CANCELLED`, `SESSION_STARTED`.
### GET /api/admin/sessions/:id/attendees — admin → 200 `{ session: Session, attendees: Attendee[], waitlist: [{ id, userId, name, position }] }`

## Admin — users & cards
### GET /api/admin/users?q=&role=&page=1&pageSize=50 — admin
→ 200 `{ items: (User & { activeCard: Card | null })[], total: number }`. Deleted users excluded.
### POST /api/admin/users — admin
Req `{ email, password, name, phone, role, lang? }` → 201 `User`. Errors: 409 `EMAIL_TAKEN`.
### PATCH /api/admin/users/:id — admin
Req `{ name?, phone?, role?, lang?, blocked?, password? }` → 200 `User`. Admin can't remove their own ADMIN role (409 `INVALID_STATE`).
### GET /api/admin/users/:id/history — admin
→ 200 `{ user: User, cards: Card[] /* with events */, bookings: Booking[] /* all, newest first */,
stats: { attended: number, noShows: number, lateCancels: number } }`
### POST /api/admin/users/:id/cards — admin
Req `{ type: CardType, paymentMethod: PaymentMethod, priceBgn?: number, validFrom?: date = today }`
→ 201 `Card`. `expiresAt` = end of day (Sofia) of `validFrom + period − 1 day`
(e.g. validFrom 2026-11-03, 1 month → 2026-12-02 23:59:59.999 Sofia). Logs CardEvent CREATED.
### PATCH /api/admin/cards/:id — admin
Req `{ expiresAt: date, note?: string }` → 200 `Card` (with events). Logs EXPIRY_CHANGED.

## Admin — reports
### GET /api/admin/reports/monthly?month=YYYY-MM — admin
→ 200
```json
{ "month": "2026-11", "classesHeld": 78, "avgAttendance": 10.4, "noShowCount": 41, "noShowRate": 0.048,
  "cardsSold": { "SINGLE": 12, "PACK_8": 20, "PACK_12": 9, "UNLIMITED_MONTH": 5, "total": 46 } }
```
Definitions: spec AC-39. Month boundaries are Sofia-local.

## Emails & background jobs (backend-internal)
`EmailOutbox` table `{ id, to, lang, template, payload JSON, status PENDING|SENT|FAILED, attempts, sendAfter, sentAt }`;
worker every 30 s, max 5 attempts with backoff. Templates (bg + en): `BOOKING_CONFIRMED`,
`WAITLIST_PROMOTED`, `SESSION_CANCELLED`, `REMINDER`, `CARD_LOW` (1 left), `CARD_EXPIRING` (3 days).
Jobs (Sofia time): generate sessions daily 03:00 and on template change; reminders daily 18:00 for
tomorrow's BOOKED; card alerts daily 09:00; waitlist expiry every minute. Jobs must be idempotent
(e.g. `Booking.reminderSentAt`, `Card.lowAlertSentAt`, `Card.expiryAlertSentAt`).

## Environment variables (backend)
`NODE_ENV, PORT, HOST, DATABASE_URL, JWT_SECRET, CORS_ORIGIN` (existing) plus
`APP_URL` (links in emails), `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE (true|false), MAIL_FROM`,
`STATIC_DIR` (built UI to serve; set to `/app/public` in the image; unset in dev = don't serve UI),
`ADMIN_EMAIL, ADMIN_PASSWORD` (initial admin created on start if no ADMIN exists), `JOBS_ENABLED (true|false; false in test)`.
In production a missing `JWT_SECRET` or `SMTP_HOST` must stop startup (no fallback).
Frontend: `VITE_API_URL` (empty = same origin `/api`).
