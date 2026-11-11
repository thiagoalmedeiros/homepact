import { formatDate } from './dates';

describe('formatDate', () => {
  it('formats calendar dates as written, whatever the time zone', () => {
    expect(formatDate('2027-03-15', 'calendar', 'en-CA')).toBe('March 15, 2027');
  });

  it('formats instants in the given locale', () => {
    expect(formatDate('2026-10-30T15:00:00.000Z', 'date', 'en-CA')).toMatch(
      /^October (29|30|31), 2026$/,
    );
    expect(formatDate(new Date(2026, 10, 4), 'weekday', 'en-CA')).toBe('Wednesday, November 4');
  });
});
