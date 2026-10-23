import bg from './bg';
import en from './en';
import { errorText, translate } from './index';
import { ApiError } from '../api/client';

describe('i18n', () => {
  it('has the same keys in bg and en and no empty strings', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(bg).sort());
    for (const v of [...Object.values(bg), ...Object.values(en)]) expect(v.trim()).not.toBe('');
  });
  it('interpolates params', () => {
    expect(translate('en', 'schedule.free', { n: 3 })).toBe('free spots: 3');
    expect(translate('bg', 'state.WAITLISTED', { n: 2 })).toContain('2');
  });
  it('maps every contract error code to text in both languages', () => {
    const codes = [
      'VALIDATION_ERROR', 'UNAUTHORIZED', 'INVALID_CREDENTIALS', 'FORBIDDEN', 'USER_BLOCKED', 'NOT_FOUND',
      'EMAIL_TAKEN', 'SESSION_FULL', 'SESSION_NOT_FULL', 'SESSION_CANCELLED', 'SESSION_STARTED', 'BOOKING_NOT_OPEN',
      'BOOKING_CLOSED', 'ALREADY_BOOKED', 'ALREADY_ON_WAITLIST', 'NO_VALID_CARD', 'DAILY_LIMIT',
      'CAPACITY_BELOW_BOOKED', 'ATTENDANCE_WINDOW', 'INVALID_STATE', 'RATE_LIMITED',
    ] as const;
    for (const c of codes) {
      expect(errorText('bg', new ApiError(400, c, 'x'))).not.toBe(bg['err.UNKNOWN']);
      expect(errorText('en', new ApiError(400, c, 'x'))).not.toBe(en['err.UNKNOWN']);
    }
  });
  it('falls back to a generic message', () => {
    expect(errorText('en', new Error('boom'))).toBe(en['err.UNKNOWN']);
  });
  it('login failure message is generic', () => {
    expect(errorText('en', new ApiError(401, 'INVALID_CREDENTIALS', ''))).toBe('Wrong email or password.');
  });
});
