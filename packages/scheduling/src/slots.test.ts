import { describe, expect, it } from 'vitest';
import {
  afterOpenMinutes,
  dayCapacity,
  openSlots,
  openWindows,
  personalBusy,
  subtractBusy,
  type WeeklyHours,
} from './slots.js';

const CHICAGO = 'America/Chicago';
const WEEKDAYS: WeeklyHours[] = [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' }];
const at = (iso: string) => new Date(iso);
const iso = (list: { start: Date; end: Date }[]) =>
  list.map((i) => `${i.start.toISOString().slice(11, 16)}-${i.end.toISOString().slice(11, 16)}`);

describe('openWindows', () => {
  it('opens only on the business days, in local time', () => {
    // Monday 9 to Sunday 15 November 2026: five weekdays, nothing at the weekend.
    const windows = openWindows({
      hours: WEEKDAYS,
      timeZone: CHICAGO,
      from: '2026-11-09',
      days: 7,
    });
    expect(windows.map((w) => w.date)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    expect(iso(windows.slice(0, 1))).toEqual(['14:00-23:00']);
  });

  it('supports split hours and a short Saturday', () => {
    const hours: WeeklyHours[] = [
      { days: [6], open: '09:00', close: '12:00' },
      { days: [6], open: '13:00', close: '15:00' },
    ];
    const windows = openWindows({ hours, timeZone: CHICAGO, from: '2026-11-14', days: 1 });
    expect(iso(windows)).toEqual(['15:00-18:00', '19:00-21:00']);
  });
});

describe('subtractBusy', () => {
  it('cuts busy time out of a window, including overlapping and edge blocks', () => {
    const window = {
      date: '2026-11-09',
      start: at('2026-11-09T14:00:00Z'),
      end: at('2026-11-09T23:00:00Z'),
    };
    const busy = [
      { start: at('2026-11-09T13:00:00Z'), end: at('2026-11-09T15:00:00Z') },
      { start: at('2026-11-09T17:00:00Z'), end: at('2026-11-09T18:00:00Z') },
      { start: at('2026-11-09T17:30:00Z'), end: at('2026-11-09T19:00:00Z') },
    ];
    expect(iso(subtractBusy([window], busy))).toEqual(['15:00-17:00', '19:00-23:00']);
  });

  it('leaves nothing when the day is fully booked', () => {
    const window = {
      date: '2026-11-09',
      start: at('2026-11-09T14:00:00Z'),
      end: at('2026-11-09T23:00:00Z'),
    };
    expect(subtractBusy([window], [window])).toEqual([]);
  });
});

describe('openSlots', () => {
  const base = { hours: WEEKDAYS, timeZone: CHICAGO, from: '2026-11-09', days: 1 };

  it('offers whole jobs on the hour, skipping busy time', () => {
    const slots = openSlots({
      ...base,
      jobMinutes: 120,
      busy: [{ start: at('2026-11-09T17:30:00Z'), end: at('2026-11-09T19:00:00Z') }],
    });
    // 8–10, 9–11, 10–12 (local) fit before the 11:30 block; after it, the grid resumes at 13:00.
    expect(iso(slots)).toEqual([
      '14:00-16:00',
      '15:00-17:00',
      '19:00-21:00',
      '20:00-22:00',
      '21:00-23:00',
    ]);
  });

  it('never offers time that has passed', () => {
    const slots = openSlots({
      ...base,
      jobMinutes: 60,
      busy: [],
      notBefore: at('2026-11-09T20:10:00Z'),
    });
    expect(iso(slots)).toEqual(['21:00-22:00', '22:00-23:00']);
  });
});

describe('dayCapacity', () => {
  it('counts open and free minutes per day, closed days included', () => {
    const days = dayCapacity({
      hours: WEEKDAYS,
      timeZone: CHICAGO,
      from: '2026-11-13',
      days: 2,
      busy: [{ start: at('2026-11-13T15:00:00Z'), end: at('2026-11-13T18:00:00Z') }],
    });
    expect(days).toEqual([
      { date: '2026-11-13', openMinutes: 540, freeMinutes: 360 },
      { date: '2026-11-14', openMinutes: 0, freeMinutes: 0 },
    ]);
  });
});

describe('personalBusy', () => {
  it("keeps the owner's own events and drops the time this service booked", () => {
    const reported = [
      // A dentist visit, reported merged with our 2–3 PM job right after it.
      { start: at('2026-11-10T19:00:00Z'), end: at('2026-11-10T21:00:00Z') },
      // Our hold on its own.
      { start: at('2026-11-11T15:00:00Z'), end: at('2026-11-11T16:00:00Z') },
      // Two overlapping personal events.
      { start: at('2026-11-12T14:00:00Z'), end: at('2026-11-12T15:00:00Z') },
      { start: at('2026-11-12T14:30:00Z'), end: at('2026-11-12T16:00:00Z') },
    ];
    const own = [
      { start: at('2026-11-10T20:00:00Z'), end: at('2026-11-10T21:00:00Z') },
      { start: at('2026-11-11T15:00:00Z'), end: at('2026-11-11T16:00:00Z') },
    ];
    expect(iso(personalBusy(reported, own))).toEqual(['19:00-20:00', '14:00-16:00']);
  });
});

describe('afterOpenMinutes', () => {
  // Weekdays 08:00–17:00 Chicago (14:00–23:00 UTC in November).
  it('counts within the same open day', () => {
    expect(afterOpenMinutes(at('2026-11-10T15:00:00Z'), 120, WEEKDAYS, CHICAGO).toISOString()).toBe(
      '2026-11-10T17:00:00.000Z',
    );
  });

  it('carries over the close to the next opening', () => {
    // 4:30 PM Tuesday: 30 minutes left today, 90 more from 8:00 Wednesday.
    expect(afterOpenMinutes(at('2026-11-10T22:30:00Z'), 120, WEEKDAYS, CHICAGO).toISOString()).toBe(
      '2026-11-11T15:30:00.000Z',
    );
  });

  it('starts counting at the next opening, across the weekend', () => {
    // Friday 7 PM: nothing counts until Monday 8:00.
    expect(afterOpenMinutes(at('2026-11-14T01:00:00Z'), 120, WEEKDAYS, CHICAGO).toISOString()).toBe(
      '2026-11-16T16:00:00.000Z',
    );
  });

  it('counts plain minutes when there are no hours', () => {
    expect(afterOpenMinutes(at('2026-11-14T01:00:00Z'), 120, [], CHICAGO).toISOString()).toBe(
      '2026-11-14T03:00:00.000Z',
    );
  });
});
