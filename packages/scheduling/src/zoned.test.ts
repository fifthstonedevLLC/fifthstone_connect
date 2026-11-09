import { describe, expect, it } from 'vitest';
import { addDays, isLocalDate, isoWeekday, localDate, weekStart, zonedTime } from './zoned.js';

const CHICAGO = 'America/Chicago';

describe('zonedTime', () => {
  it('turns wall-clock time into the right instant, summer and winter', () => {
    expect(zonedTime('2026-07-15', '09:00', CHICAGO).toISOString()).toBe(
      '2026-07-15T14:00:00.000Z',
    );
    expect(zonedTime('2026-11-10', '09:00', CHICAGO).toISOString()).toBe(
      '2026-11-10T15:00:00.000Z',
    );
  });

  it('handles the nights the clocks change', () => {
    // 1 November 2026: 01:30 happens twice; the first one counts.
    expect(zonedTime('2026-11-01', '01:30', CHICAGO).toISOString()).toBe(
      '2026-11-01T06:30:00.000Z',
    );
    // 8 March 2026: 02:30 never happens; it lands an hour later on the clock.
    expect(zonedTime('2026-03-08', '02:30', CHICAGO).toISOString()).toBe(
      '2026-03-08T08:30:00.000Z',
    );
  });
});

describe('local dates', () => {
  it('reads the business day at an instant', () => {
    // 03:00 UTC on the 10th is still the evening of the 9th in Chicago.
    expect(localDate(new Date('2026-11-10T03:00:00Z'), CHICAGO)).toBe('2026-11-09');
  });

  it('does calendar arithmetic across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(weekStart('2026-11-15')).toBe('2026-11-09');
  });

  it('accepts only real dates', () => {
    expect(isLocalDate('2026-11-09')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('11/09/2026')).toBe(false);
  });
});
