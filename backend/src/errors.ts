export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message: string, details?: { path: string; message: string }[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message?: string) => new AppError(409, code, message ?? code.toLowerCase().replace(/_/g, ' '));

export const MESSAGES: Record<string, string> = {
  SESSION_FULL: 'This class is full. You can join the waiting list.',
  NO_VALID_CARD: 'No valid card for this class. Please contact the studio.',
  USER_BLOCKED: 'Your account is blocked. Please contact the studio.',
  BOOKING_NOT_OPEN: 'Booking is not open yet (opens 14 days before the class).',
  BOOKING_CLOSED: 'Booking is closed (closes 30 minutes before the class).',
  ALREADY_BOOKED: 'Already booked for this class.',
  ALREADY_ON_WAITLIST: 'Already on the waiting list for this class.',
  SESSION_NOT_FULL: 'The class still has free spots; book directly.',
  SESSION_CANCELLED: 'This class is cancelled.',
  SESSION_STARTED: 'This class has already started.',
  DAILY_LIMIT: 'An Unlimited card allows only one class per day.',
  CAPACITY_BELOW_BOOKED: 'Capacity cannot be lower than the number of booked clients.',
  ATTENDANCE_WINDOW: 'Outside the allowed time window for this action.',
  INVALID_STATE: 'The item is not in a state that allows this action.',
  EMAIL_TAKEN: 'This email is already registered.',
};

export const conflictCode = (code: string) => new AppError(409, code, MESSAGES[code] ?? code);
