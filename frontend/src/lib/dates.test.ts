import { addDays, dateKey, endTime, isoWeekday, mondayOf, sofiaToIso, timeOf } from './dates';

describe('Sofia dates', () => {
  it('shows winter time as UTC+2 and summer as UTC+3', () => {
    expect(timeOf('2026-11-03T16:30:00.000Z')).toBe('18:30');
    expect(timeOf('2026-07-03T15:30:00.000Z')).toBe('18:30');
  });
  it('uses the Sofia day, not the UTC day', () => {
    expect(dateKey('2026-11-03T22:30:00.000Z')).toBe('2026-11-04');
  });
  it('converts Sofia local time to UTC across DST', () => {
    expect(sofiaToIso('2026-11-03', '18:30')).toBe('2026-11-03T16:30:00.000Z');
    expect(sofiaToIso('2026-07-03', '18:30')).toBe('2026-07-03T15:30:00.000Z');
    expect(sofiaToIso('2026-03-29', '10:00')).toBe('2026-03-29T07:00:00.000Z');
  });
  it('round-trips', () => {
    expect(timeOf(sofiaToIso('2026-10-25', '09:15'))).toBe('09:15');
  });
  it('week helpers', () => {
    expect(isoWeekday('2026-11-03')).toBe(2);
    expect(isoWeekday('2026-11-08')).toBe(7);
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('end time', () => {
    expect(endTime('2026-11-03T16:30:00.000Z', 75)).toBe('19:45');
  });
});
