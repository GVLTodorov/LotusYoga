// OpenAPI 3 description of docs/api-contract.md. Keep in sync with the contract.
type Json = Record<string, unknown>;

const ref = (n: string): Json => ({ $ref: `#/components/schemas/${n}` });
const arr = (items: Json): Json => ({ type: 'array', items });
const str: Json = { type: 'string' };
const int: Json = { type: 'integer' };
const bool: Json = { type: 'boolean' };
const nullable = (s: Json): Json => ({ ...s, nullable: true });
const en = (...v: string[]): Json => ({ type: 'string', enum: v });
const obj = (properties: Json, required?: string[]): Json => ({ type: 'object', properties, ...(required ? { required } : {}) });
const isoTs: Json = { type: 'string', format: 'date-time', example: '2026-11-03T16:30:00.000Z' };
const dateS: Json = { type: 'string', format: 'date', example: '2026-11-03' };

const schemas: Record<string, Json> = {
  Role: en('CLIENT', 'INSTRUCTOR', 'ADMIN'),
  Lang: en('bg', 'en'),
  CardType: en('SINGLE', 'PACK_8', 'PACK_12', 'UNLIMITED_MONTH'),
  PaymentMethod: en('CASH', 'BANK_TRANSFER'),
  SessionStatus: en('SCHEDULED', 'CANCELLED'),
  BookingStatus: en('BOOKED', 'CANCELLED', 'LATE_CANCELLED', 'ATTENDED', 'NO_SHOW', 'CLASS_CANCELLED'),
  WaitlistStatus: en('WAITING', 'PROMOTED', 'LEFT', 'EXPIRED', 'CLASS_CANCELLED'),
  ClientState: en('BOOKED', 'WAITLISTED', 'CAN_BOOK', 'CAN_JOIN_WAITLIST', 'NOT_OPEN', 'CLOSED', 'CANCELLED'),
  Error: obj(
    {
      error: obj({ code: str, message: str, details: arr(obj({ path: str, message: str })) }, ['code', 'message']),
    },
    ['error'],
  ),
  User: obj(
    { id: str, email: str, name: str, phone: str, role: ref('Role'), lang: ref('Lang'), blocked: bool, createdAt: isoTs },
    ['id', 'email', 'name', 'phone', 'role', 'lang', 'blocked', 'createdAt'],
  ),
  InstructorRef: obj({ id: str, name: str }, ['id', 'name']),
  Session: obj(
    {
      id: str,
      templateId: nullable(str),
      name: str,
      startsAt: isoTs,
      durationMin: int,
      instructor: ref('InstructorRef'),
      capacity: int,
      bookedCount: int,
      freeSpots: int,
      waitlistCount: int,
      status: ref('SessionStatus'),
      bookingOpensAt: isoTs,
      bookingClosesAt: isoTs,
      myState: ref('ClientState'),
      myBookingId: nullable(str),
      myWaitlistId: nullable(str),
      myWaitlistPosition: nullable(int),
    },
    ['id', 'templateId', 'name', 'startsAt', 'durationMin', 'instructor', 'capacity', 'bookedCount', 'freeSpots', 'waitlistCount', 'status', 'bookingOpensAt', 'bookingClosesAt'],
  ),
  CardEvent: obj(
    {
      id: str,
      type: en('CREATED', 'EXPIRY_CHANGED'),
      oldExpiresAt: nullable(isoTs),
      newExpiresAt: nullable(isoTs),
      note: nullable(str),
      byUser: ref('InstructorRef'),
      createdAt: isoTs,
    },
    ['id', 'type', 'byUser', 'createdAt'],
  ),
  Card: obj(
    {
      id: str,
      userId: str,
      type: ref('CardType'),
      totalClasses: nullable(int),
      usedClasses: int,
      remainingClasses: nullable(int),
      validFrom: dateS,
      expiresAt: isoTs,
      paymentMethod: ref('PaymentMethod'),
      priceBgn: nullable({ type: 'number' }),
      createdAt: isoTs,
      isActive: bool,
      events: arr(ref('CardEvent')),
    },
    ['id', 'userId', 'type', 'totalClasses', 'usedClasses', 'remainingClasses', 'validFrom', 'expiresAt', 'paymentMethod', 'priceBgn', 'createdAt', 'isActive'],
  ),
  Booking: obj(
    {
      id: str,
      status: ref('BookingStatus'),
      walkIn: bool,
      promotedLate: bool,
      cardId: nullable(str),
      createdAt: isoTs,
      cancelledAt: nullable(isoTs),
      session: ref('Session'),
    },
    ['id', 'status', 'walkIn', 'promotedLate', 'cardId', 'createdAt', 'cancelledAt', 'session'],
  ),
  WaitlistEntry: obj(
    { id: str, status: ref('WaitlistStatus'), position: nullable(int), createdAt: isoTs, session: ref('Session') },
    ['id', 'status', 'position', 'createdAt', 'session'],
  ),
  Attendee: obj(
    { bookingId: str, userId: str, name: str, phone: str, status: ref('BookingStatus'), walkIn: bool },
    ['bookingId', 'userId', 'name', 'phone', 'status', 'walkIn'],
  ),
  Template: obj(
    {
      id: str,
      name: str,
      instructor: ref('InstructorRef'),
      weekday: { type: 'integer', minimum: 1, maximum: 7, description: 'ISO weekday, 1 = Monday' },
      startTime: { type: 'string', example: '18:30', description: 'HH:mm Sofia-local' },
      durationMin: int,
      capacity: int,
      validFrom: dateS,
      active: bool,
    },
    ['id', 'name', 'instructor', 'weekday', 'startTime', 'durationMin', 'capacity', 'validFrom', 'active'],
  ),
  AuthResponse: obj({ token: str, user: ref('User') }, ['token', 'user']),
  CancelPreview: obj({ lateCancel: bool, classReturned: bool, hoursUntilStart: { type: 'number' } }, ['lateCancel', 'classReturned', 'hoursUntilStart']),
  MonthlyReport: obj(
    {
      month: { type: 'string', example: '2026-11' },
      classesHeld: int,
      avgAttendance: { type: 'number' },
      noShowCount: int,
      noShowRate: { type: 'number' },
      cardsSold: obj({ SINGLE: int, PACK_8: int, PACK_12: int, UNLIMITED_MONTH: int, total: int }),
    },
    ['month', 'classesHeld', 'avgAttendance', 'noShowCount', 'noShowRate', 'cardsSold'],
  ),
};

const errorExample = (code: string, message: string): Json => ({ error: { code, message } });
const errRes = (description: string, code: string): Json => ({
  description,
  content: { 'application/json': { schema: ref('Error'), example: errorExample(code, description) } },
});

const body = (schema: Json, example?: unknown): Json => ({
  required: true,
  content: { 'application/json': { schema, ...(example === undefined ? {} : { example }) } },
});
const ok = (description: string, schema?: Json, example?: unknown): Json => ({
  description,
  ...(schema ? { content: { 'application/json': { schema, ...(example === undefined ? {} : { example }) } } } : {}),
});
const pathId = (name = 'id'): Json => ({ name, in: 'path', required: true, schema: str });
const query = (name: string, schema: Json, description?: string, required = false): Json => ({ name, in: 'query', required, schema, ...(description ? { description } : {}) });

const sessionExample = {
  id: 'cs1',
  templateId: 't1',
  name: 'Хатха йога',
  startsAt: '2026-11-03T16:30:00.000Z',
  durationMin: 75,
  instructor: { id: 'u2', name: 'Елена' },
  capacity: 14,
  bookedCount: 14,
  freeSpots: 0,
  waitlistCount: 2,
  status: 'SCHEDULED',
  bookingOpensAt: '2026-10-20T16:30:00.000Z',
  bookingClosesAt: '2026-11-03T16:00:00.000Z',
  myState: 'WAITLISTED',
  myBookingId: null,
  myWaitlistId: 'w9',
  myWaitlistPosition: 2,
};

const E = {
  validation: ['400', errRes('Invalid input', 'VALIDATION_ERROR')],
  unauthorized: ['401', errRes('Authentication required', 'UNAUTHORIZED')],
  forbidden: ['403', errRes('Forbidden', 'FORBIDDEN')],
  notFound: ['404', errRes('Not found', 'NOT_FOUND')],
} as const;

const conflicts = (...codes: string[]): [string, Json] => [
  '409',
  {
    description: `Conflict: ${codes.join(', ')}`,
    content: {
      'application/json': {
        schema: ref('Error'),
        example: errorExample(codes[0], codes[0].toLowerCase().replace(/_/g, ' ')),
      },
    },
  },
];

type Auth = 'public' | 'optional' | 'client' | 'instructor' | 'admin' | 'any';
interface Op {
  summary: string;
  auth: Auth;
  tag: string;
  params?: Json[];
  requestBody?: Json;
  success: [string, Json];
  errors?: ([string, Json] | readonly [string, Json])[];
}

function build(op: Op): Json {
  const responses: Record<string, Json> = { [op.success[0]]: op.success[1] };
  const add = (e: readonly [string, Json]) => {
    responses[e[0]] = e[1];
  };
  if (op.requestBody || op.params?.some((p) => p.in === 'query')) add(E.validation);
  if (op.auth !== 'public' && op.auth !== 'optional') {
    add(E.unauthorized);
    if (op.auth !== 'any') add(E.forbidden);
  }
  for (const e of op.errors ?? []) add(e);
  const security = op.auth === 'public' ? [] : op.auth === 'optional' ? [{}, { bearer: [] }] : [{ bearer: [] }];
  return {
    tags: [op.tag],
    summary: `${op.summary} (${op.auth})`,
    security,
    ...(op.params ? { parameters: op.params } : {}),
    ...(op.requestBody ? { requestBody: op.requestBody } : {}),
    responses,
  };
}

const rateLimited = ['429', errRes('Too many attempts (10 per 15 minutes per IP)', 'RATE_LIMITED')] as const;
const date = (name: string, d?: string) => query(name, dateS, d);

const registerExample = { email: 'ivana@example.com', password: 'secret123', name: 'Ивана Петрова', phone: '+359 888 123 456', lang: 'bg' };
const userExample = { id: 'u1', email: 'ivana@example.com', name: 'Ивана Петрова', phone: '+359 888 123 456', role: 'CLIENT', lang: 'bg', blocked: false, createdAt: '2026-10-23T09:00:00.000Z' };

const paths: Record<string, Record<string, Json>> = {
  '/api/auth/register': {
    post: build({
      tag: 'Auth',
      summary: 'Register a client account',
      auth: 'public',
      requestBody: body(obj({ email: str, password: { type: 'string', minLength: 8 }, name: str, phone: str, lang: ref('Lang') }, ['email', 'password', 'name', 'phone']), registerExample),
      success: ['201', ok('Created', ref('AuthResponse'), { token: '<jwt>', user: userExample })],
      errors: [conflicts('EMAIL_TAKEN'), rateLimited],
    }),
  },
  '/api/auth/login': {
    post: build({
      tag: 'Auth',
      summary: 'Log in',
      auth: 'public',
      requestBody: body(obj({ email: str, password: str }, ['email', 'password']), { email: 'ivana@example.com', password: 'secret123' }),
      success: ['200', ok('OK', ref('AuthResponse'))],
      errors: [['401', errRes('Wrong email or password', 'INVALID_CREDENTIALS')], rateLimited],
    }),
  },
  '/api/me': {
    get: build({ tag: 'Me', summary: 'Current user', auth: 'any', success: ['200', ok('OK', ref('User'), userExample)] }),
    patch: build({
      tag: 'Me',
      summary: 'Update own name / phone / language',
      auth: 'any',
      requestBody: body(obj({ name: str, phone: str, lang: ref('Lang') })),
      success: ['200', ok('OK', ref('User'))],
    }),
    delete: build({
      tag: 'Me',
      summary: 'Delete (anonymise) own client account',
      auth: 'client',
      requestBody: body(obj({ password: str }, ['password']), { password: 'secret123' }),
      success: ['204', ok('Deleted')],
      errors: [['401', errRes('Wrong password', 'INVALID_CREDENTIALS')]],
    }),
  },
  '/api/sessions': {
    get: build({
      tag: 'Schedule',
      summary: 'List sessions (default: this week and next, max 15 days)',
      auth: 'optional',
      params: [date('from', 'Default: Monday of the current Sofia week'), date('to', 'Default: from + 13 days; range max 15 days')],
      success: ['200', ok('Sorted by startsAt; includes cancelled sessions', arr(ref('Session')), [sessionExample])],
    }),
  },
  '/api/sessions/{id}': {
    get: build({ tag: 'Schedule', summary: 'One session', auth: 'optional', params: [pathId()], success: ['200', ok('OK', ref('Session'), sessionExample)], errors: [E.notFound] }),
  },
  '/api/sessions/{id}/bookings': {
    post: build({
      tag: 'Bookings',
      summary: 'Book a session (queues confirmation email)',
      auth: 'client',
      params: [pathId()],
      success: ['201', ok('Created', ref('Booking'))],
      errors: [E.notFound, conflicts('SESSION_CANCELLED', 'BOOKING_NOT_OPEN', 'BOOKING_CLOSED', 'ALREADY_BOOKED', 'SESSION_FULL', 'NO_VALID_CARD', 'DAILY_LIMIT')],
    }),
  },
  '/api/me/bookings': {
    get: build({
      tag: 'Bookings',
      summary: 'My bookings (upcoming asc / past desc, max 100)',
      auth: 'client',
      params: [query('scope', en('upcoming', 'past'))],
      success: ['200', ok('OK', arr(ref('Booking')))],
    }),
  },
  '/api/bookings/{id}/cancel-preview': {
    get: build({
      tag: 'Bookings',
      summary: 'What would cancelling do (late cancel / class returned)',
      auth: 'client',
      params: [pathId()],
      success: ['200', ok('OK', ref('CancelPreview'), { lateCancel: false, classReturned: true, hoursUntilStart: 30.5 })],
      errors: [E.notFound, conflicts('SESSION_STARTED', 'INVALID_STATE')],
    }),
  },
  '/api/bookings/{id}/cancel': {
    post: build({
      tag: 'Bookings',
      summary: 'Cancel a booking (frees a spot, promotes the waiting list)',
      auth: 'client',
      params: [pathId()],
      success: ['200', ok('Status CANCELLED or LATE_CANCELLED', ref('Booking'))],
      errors: [E.notFound, conflicts('SESSION_STARTED', 'INVALID_STATE')],
    }),
  },
  '/api/sessions/{id}/waitlist': {
    post: build({
      tag: 'Waiting list',
      summary: 'Join the waiting list of a full session',
      auth: 'client',
      params: [pathId()],
      success: ['201', ok('Created', ref('WaitlistEntry'))],
      errors: [E.notFound, conflicts('SESSION_NOT_FULL', 'ALREADY_BOOKED', 'ALREADY_ON_WAITLIST', 'NO_VALID_CARD', 'BOOKING_NOT_OPEN', 'BOOKING_CLOSED', 'SESSION_CANCELLED')],
    }),
  },
  '/api/waitlist/{id}': {
    delete: build({ tag: 'Waiting list', summary: 'Leave the waiting list', auth: 'client', params: [pathId()], success: ['204', ok('Left')], errors: [E.notFound, conflicts('INVALID_STATE')] }),
  },
  '/api/me/waitlist': {
    get: build({ tag: 'Waiting list', summary: 'My waiting entries (WAITING, upcoming)', auth: 'client', success: ['200', ok('OK', arr(ref('WaitlistEntry')))] }),
  },
  '/api/me/cards': {
    get: build({ tag: 'Cards', summary: 'My cards (active first, then expiresAt desc)', auth: 'client', success: ['200', ok('OK', arr(ref('Card')))] }),
  },
  '/api/instructor/sessions': {
    get: build({
      tag: 'Instructor',
      summary: "Sessions of a day with attendees (instructor: own; admin: all)",
      auth: 'instructor',
      params: [date('date', 'Default: today (Sofia)')],
      success: ['200', ok('OK', arr(obj({ session: ref('Session'), attendees: arr(ref('Attendee')) })))],
    }),
  },
  '/api/bookings/{id}/attendance': {
    patch: build({
      tag: 'Instructor',
      summary: 'Mark attended / no-show (own session, or admin)',
      auth: 'instructor',
      params: [pathId()],
      requestBody: body(obj({ status: en('ATTENDED', 'NO_SHOW') }, ['status']), { status: 'ATTENDED' }),
      success: ['200', ok('OK', ref('Attendee'))],
      errors: [E.notFound, conflicts('ATTENDANCE_WINDOW', 'INVALID_STATE')],
    }),
  },
  '/api/instructor/clients': {
    get: build({
      tag: 'Instructor',
      summary: 'Search clients by name / email / phone (min 2 chars, max 20)',
      auth: 'instructor',
      params: [query('q', str, undefined, true)],
      success: ['200', ok('OK', arr(obj({ id: str, name: str, phoneHint: str, hasValidCard: bool })))],
    }),
  },
  '/api/sessions/{id}/walk-ins': {
    post: build({
      tag: 'Instructor',
      summary: 'Add a walk-in (own session, or admin); no email',
      auth: 'instructor',
      params: [pathId()],
      requestBody: body(obj({ userId: str }, ['userId']), { userId: 'u1' }),
      success: ['201', ok('Created', ref('Attendee'))],
      errors: [E.notFound, conflicts('SESSION_FULL', 'NO_VALID_CARD', 'DAILY_LIMIT', 'ALREADY_BOOKED', 'SESSION_CANCELLED', 'ATTENDANCE_WINDOW')],
    }),
  },
  '/api/admin/templates': {
    get: build({ tag: 'Admin schedule', summary: 'List templates', auth: 'admin', success: ['200', ok('OK', arr(ref('Template')))] }),
    post: build({
      tag: 'Admin schedule',
      summary: 'Create a weekly template (generates sessions up to 15 days ahead)',
      auth: 'admin',
      requestBody: body(
        obj(
          { name: str, instructorId: str, weekday: int, startTime: str, durationMin: { type: 'integer', minimum: 15, maximum: 240 }, capacity: { type: 'integer', minimum: 1, maximum: 50, default: 14 }, validFrom: dateS },
          ['name', 'instructorId', 'weekday', 'startTime', 'durationMin', 'validFrom'],
        ),
        { name: 'Хатха йога', instructorId: 'u2', weekday: 2, startTime: '18:30', durationMin: 75, capacity: 14, validFrom: '2026-11-03' },
      ),
      success: ['201', ok('Created', ref('Template'))],
    }),
  },
  '/api/admin/templates/{id}': {
    patch: build({
      tag: 'Admin schedule',
      summary: 'Edit / deactivate a template (propagates to future sessions, AC-29)',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ name: str, instructorId: str, weekday: int, startTime: str, durationMin: int, capacity: int, validFrom: dateS, active: bool })),
      success: ['200', ok('OK', ref('Template'))],
      errors: [E.notFound, conflicts('CAPACITY_BELOW_BOOKED')],
    }),
  },
  '/api/admin/sessions': {
    post: build({
      tag: 'Admin schedule',
      summary: 'Create a one-off session',
      auth: 'admin',
      requestBody: body(obj({ name: str, instructorId: str, startsAt: isoTs, durationMin: int, capacity: int }, ['name', 'instructorId', 'startsAt', 'durationMin', 'capacity'])),
      success: ['201', ok('Created', ref('Session'))],
    }),
  },
  '/api/admin/sessions/{id}': {
    patch: build({
      tag: 'Admin schedule',
      summary: 'Change one session (capacity increase promotes the waiting list)',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ name: str, instructorId: str, startsAt: isoTs, durationMin: int, capacity: int })),
      success: ['200', ok('OK', ref('Session'))],
      errors: [E.notFound, conflicts('CAPACITY_BELOW_BOOKED', 'SESSION_CANCELLED')],
    }),
  },
  '/api/admin/sessions/{id}/cancel': {
    post: build({
      tag: 'Admin schedule',
      summary: 'Cancel a session (classes returned, clients emailed, waiting list cleared)',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ reason: str }), { reason: 'Public holiday' }),
      success: ['200', ok('OK', ref('Session'))],
      errors: [E.notFound, conflicts('SESSION_CANCELLED', 'SESSION_STARTED')],
    }),
  },
  '/api/admin/sessions/{id}/attendees': {
    get: build({
      tag: 'Admin schedule',
      summary: 'Attendees and waiting list of a session',
      auth: 'admin',
      params: [pathId()],
      success: ['200', ok('OK', obj({ session: ref('Session'), attendees: arr(ref('Attendee')), waitlist: arr(obj({ id: str, userId: str, name: str, position: int })) }))],
      errors: [E.notFound],
    }),
  },
  '/api/admin/users': {
    get: build({
      tag: 'Admin users',
      summary: 'Search users (deleted excluded)',
      auth: 'admin',
      params: [query('q', str), query('role', ref('Role')), query('page', { type: 'integer', default: 1 }), query('pageSize', { type: 'integer', default: 50 })],
      success: ['200', ok('OK', obj({ items: arr({ allOf: [ref('User'), obj({ activeCard: nullable(ref('Card')) })] }), total: int }))],
    }),
    post: build({
      tag: 'Admin users',
      summary: 'Create a user (client / instructor / admin)',
      auth: 'admin',
      requestBody: body(obj({ email: str, password: str, name: str, phone: str, role: ref('Role'), lang: ref('Lang') }, ['email', 'password', 'name', 'phone', 'role'])),
      success: ['201', ok('Created', ref('User'))],
      errors: [conflicts('EMAIL_TAKEN')],
    }),
  },
  '/api/admin/users/{id}': {
    patch: build({
      tag: 'Admin users',
      summary: 'Edit a user (role, block, new password)',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ name: str, phone: str, role: ref('Role'), lang: ref('Lang'), blocked: bool, password: str })),
      success: ['200', ok('OK', ref('User'))],
      errors: [E.notFound, conflicts('INVALID_STATE')],
    }),
  },
  '/api/admin/users/{id}/history': {
    get: build({
      tag: 'Admin users',
      summary: 'Cards (with events), bookings and totals of a client',
      auth: 'admin',
      params: [pathId()],
      success: [
        '200',
        ok('OK', obj({ user: ref('User'), cards: arr(ref('Card')), bookings: arr(ref('Booking')), stats: obj({ attended: int, noShows: int, lateCancels: int }) })),
      ],
      errors: [E.notFound],
    }),
  },
  '/api/admin/users/{id}/cards': {
    post: build({
      tag: 'Admin users',
      summary: 'Record a card purchase',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ type: ref('CardType'), paymentMethod: ref('PaymentMethod'), priceBgn: { type: 'number' }, validFrom: dateS }, ['type', 'paymentMethod']), {
        type: 'PACK_8',
        paymentMethod: 'CASH',
        priceBgn: 120,
        validFrom: '2026-11-03',
      }),
      success: ['201', ok('Created', ref('Card'))],
      errors: [E.notFound],
    }),
  },
  '/api/admin/cards/{id}': {
    patch: build({
      tag: 'Admin users',
      summary: 'Change a card expiry date (logged as EXPIRY_CHANGED)',
      auth: 'admin',
      params: [pathId()],
      requestBody: body(obj({ expiresAt: dateS, note: str }, ['expiresAt']), { expiresAt: '2026-12-20', note: 'Extended: was ill' }),
      success: ['200', ok('OK', ref('Card'))],
      errors: [E.notFound],
    }),
  },
  '/api/admin/reports/monthly': {
    get: build({
      tag: 'Admin reports',
      summary: 'Monthly overview (Sofia month boundaries)',
      auth: 'admin',
      params: [query('month', { type: 'string', example: '2026-11' }, 'YYYY-MM', true)],
      success: ['200', ok('OK', ref('MonthlyReport'), { month: '2026-11', classesHeld: 78, avgAttendance: 10.4, noShowCount: 41, noShowRate: 0.048, cardsSold: { SINGLE: 12, PACK_8: 20, PACK_12: 9, UNLIMITED_MONTH: 5, total: 46 } })],
    }),
  },
};

export function buildOpenApi(): Json {
  return {
    openapi: '3.0.3',
    info: {
      title: 'StudioBook API',
      version: '1.0.0',
      description:
        'Yoga class booking API. Timestamps are UTC ISO-8601; dates and times of day are Europe/Sofia-local. Errors: `{ "error": { "code", "message", "details?" } }`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas,
    },
    paths: {
      '/health': {
        get: { tags: ['System'], summary: 'Health check', security: [], responses: { '200': ok('OK', obj({ status: str }), { status: 'ok' }) } },
      },
      ...paths,
    },
  };
}

export const contractPaths = Object.keys(paths);
