# StudioBook — Spec (v1)

Source: `requirements.md`, clarified with the owner on 2026-10-23. API details: `docs/api-contract.md`.

## Glossary & global rules
- **Session** = one dated class (e.g. "Hatha, Tue 2026-11-03 18:30"). **Template** = a weekly repeating
  class from which sessions are generated.
- All times are shown and reasoned about in **Europe/Sofia** (stored as UTC). "Today", "day",
  "evening before" and "month" are Sofia-local, and stay correct across DST changes.
- **Booking window:** opens 14 days before start, closes 30 min before start.
- **Late cancel:** cancelling < 6 h before start uses the class from the card.
- One booking per client per session (no booking for friends).
- UI languages: Bulgarian (default) and English, switchable at any time; the choice is saved on the
  user and used for their emails.

## Auth & accounts
- AC-1 Given a visitor, when they register with email, password (≥ 8 chars), name and phone, then an
  account with role CLIENT is created and they are logged in. Missing phone → validation error.
- AC-2 Given an existing email, when someone registers with it, then they get `EMAIL_TAKEN`.
- AC-3 Given valid credentials, when a user logs in, then they get a token and land on the schedule
  (client), today's classes (instructor) or the admin schedule (admin). Wrong credentials → a generic
  "wrong email or password" message.
- AC-4 Given a logged-in client, when they edit name, phone or language, then the change is saved.
- AC-5 (GDPR) Given a client, when they delete their account and confirm with their password, then
  their name, email, phone and password are erased, future bookings and waitlist entries are
  cancelled, and past attendance stays in the studio records as "Deleted client". They can't log in again.

## Schedule (public)
- AC-6 Given anyone (logged in or not), when they open the schedule, then they see this week and next
  week (Mon–Sun, Sofia time), grouped by day, each session with name, time, instructor, free spots
  ("Full" when 0) and a "Cancelled" badge if cancelled.
- AC-7 Given a logged-in client, then each session also shows their state: booked / on waitlist (position)
  / can book / can join waitlist / booking not open yet / booking closed.

## Booking
- AC-8 Given a client with a valid card and a session with a free spot inside the booking window, when
  they book, then a booking is created, one class is taken from their card, and they get a
  confirmation email.
- AC-9 Given a full session, when a client tries to book, then they get `SESSION_FULL` and are offered
  the waiting list.
- AC-10 Given no card valid on the session date with classes left, when a client tries to book, then
  they get `NO_VALID_CARD` with a message to contact the studio.
- AC-11 Given a session starting in > 14 days or in < 30 min, when a client tries to book, then they get
  `BOOKING_NOT_OPEN` or `BOOKING_CLOSED`.
- AC-12 Given an Unlimited-month card, when the client already has an active booking that Sofia day, then
  a second booking that day is refused with `DAILY_LIMIT` (unless another card can be used).
- AC-13 Given a blocked client, when they try to book or join a waitlist, then they get `USER_BLOCKED`
  with a message to contact the studio.
- AC-14 Given two clients booking the last spot at the same time, then exactly one succeeds
  (no overbooking, guaranteed at the database level).
- AC-15 Given several valid cards, then the card that expires first is used.

## Cancel
- AC-16 Given a booking ≥ 6 h before start, when the client opens cancel, then the dialog says the class
  will be returned to their card; on confirm, the booking is cancelled and the class returned.
- AC-17 Given a booking < 6 h before start, when the client opens cancel, then the dialog clearly warns
  (highlighted) that the class will **not** be returned; on confirm the booking becomes
  `LATE_CANCELLED` and the class stays used.
- AC-18 Given a booking obtained from the waiting list while already inside the 6 h window, when the
  client cancels, then the class is returned (no late-cancel penalty), and the dialog says so.
- AC-19 Cancelling is not possible after the session has started.

## Waiting list
- AC-20 Given a full session inside the booking window, when a client with a valid card joins the
  waiting list, then they see their position. They can leave the waiting list at any time.
- AC-21 Given a waiting list, when a spot frees up (cancel or capacity increase) before booking closes
  (even < 6 h before start), then the first waiting client who has a valid card is booked
  automatically (class taken from their card) and gets a "you got a spot" email. Clients without a
  valid card are skipped.
- AC-22 Given booking has closed (30 min before start), then the remaining waiting entries expire.

## My bookings & cards
- AC-23 Given a client, when they open "My bookings", then they see upcoming bookings and waitlist
  entries, and past bookings with status (attended, no-show, cancelled, late-cancelled, class cancelled).
- AC-24 Given a client, then they see each active card: type, classes left (or "Unlimited"), and expiry date;
  expired cards are listed separately.

## Instructor
- AC-25 Given an instructor, when they open "Today", then they see the sessions they teach today (Sofia)
  with booked clients' names and phone numbers. They can pick another date. Admins can see all sessions.
- AC-26 Given a session that starts within 30 min or has started (until 24 h after start), when the
  instructor marks a client attended or no-show, then the status is saved; they can change it in that
  time frame. An instructor can't mark sessions they don't teach.
- AC-27 Given a free spot, when the instructor searches a client (name/phone/email, ≥ 2 chars) and adds
  them as a walk-in, then a booking marked walk-in + attended is created using their valid card.
  No valid card → `NO_VALID_CARD`; no spot → `SESSION_FULL`. The booking window does not apply.

## Admin — schedule
- AC-28 Given the admin, when they create a weekly template (name, instructor, weekday, start time,
  duration, capacity default 14, start date), then sessions are generated for every week up to 15 days
  ahead and keep being generated automatically.
- AC-29 Given a template edit (name, instructor, duration, capacity, weekday, time), then it applies to
  all future sessions of that template that have no bookings; future sessions with bookings get the
  name/instructor/duration/capacity change but keep their time. Capacity can't go below the booked count
  (`CAPACITY_BELOW_BOOKED`). Deactivating a template stops generation and removes its future sessions
  that have no bookings.
- AC-30 Given a single session, when the admin moves it (new date/time) or changes its instructor or
  capacity, then only that session changes; existing bookings stay.
- AC-31 Given the admin creates a one-off session, then it appears in the schedule like any other.
- AC-32 Given the admin cancels a session (e.g. a holiday), then every booked client's class goes back on
  their card, they get a cancellation email, the waiting list is cleared, and the session shows "Cancelled".

## Admin — clients & cards
- AC-33 Given the admin, when they open Clients, then they can search by name/email/phone and see each
  client's phone, active card summary and blocked flag.
- AC-34 Given the admin, they can create users (clients on someone's behalf, instructors, admins) and edit
  name, phone, role.
- AC-35 Given the admin, when they record a card (type, payment method cash/bank transfer, optional price,
  start date default today), then validity is: Single 1 class/1 month, 8 classes/2 months, 12 classes/3
  months, Unlimited/1 month (max 1 booking per day). Expiry = start date + period, end of that day (Sofia).
- AC-36 Given a card, when the admin changes its expiry date (extend), then it is saved and logged with
  old/new date, admin and note. Unused classes on an expired card are otherwise lost.
- AC-37 Given a client, when the admin opens their history, then they see cards bought (incl. expiry
  changes), all bookings with status, and totals: attended, no-shows, late cancels.
- AC-38 Given the admin blocks a client, then the client can't book or join waiting lists (existing
  bookings stay); unblocking restores this.

## Admin — monthly overview
- AC-39 Given a month, then the admin sees: classes held (non-cancelled sessions that started), average
  attendance per held class (attended ÷ held), no-show count and rate (no-shows ÷ (attended + no-shows)),
  cards sold per type and total.

## Notifications (email)
- AC-40 Emails are sent in the recipient's language for: booking confirmation (AC-8, AC-27 excluded),
  spot from waiting list (AC-21), session cancelled by studio (AC-32), reminder at 18:00 Sofia the
  evening before for each booked session, card has 1 class left (once per card), card expires in 3 days
  (once per card, only if it still has classes or is unlimited).
- AC-41 Emails are queued in the database and sent by a background worker with retries, so a booking
  never fails because the mail server is down.

## Non-functional
- AC-42 (Responsive) Every page is usable at 360 px, 768 px and 1280 px wide with no horizontal page scroll.
  Client pages are designed mobile-first; admin pages work on a laptop.
- AC-43 (Performance) Initial JS ≤ 150 KB gzipped; the schedule renders usefully on a slow 3G connection;
  no heavy UI frameworks.
- AC-44 (Security) Passwords hashed (argon2 or bcrypt); JWT secret from env, no fallback in production;
  login/register rate-limited; role checks on every protected endpoint.
- AC-45 (Deploy) Runs as a single Docker image (API + built UI on one port) plus Postgres, via
  `docker compose up`. DB migrations run on start. An initial admin is created from env vars if none exists.

## Out of scope (v1)
Online payments, mobile app, multiple studios/rooms, salaries/invoices/accounting, marketing emails,
SMS, booking for friends, password-reset by email (admin can set a new password), "class moved" email.
