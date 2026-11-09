import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  directionsUrl,
  preferredMaps,
  clockMinutes,
  duration,
  gridHours,
  lanes,
  onDay,
  openStretches,
  rangeLabel,
  untilLabel,
} from './calendar';

const TZ = 'America/Chicago';

describe('placing things on the business clock', () => {
  it('reads minutes since midnight in the business time zone', () => {
    expect(clockMinutes('2026-11-10T15:30:00Z', TZ)).toBe(9 * 60 + 30);
  });

  it('splits a span across the days it touches', () => {
    // 10 PM Monday to 2 AM Tuesday, Chicago.
    const span = { start: '2026-11-10T04:00:00Z', end: '2026-11-10T08:00:00Z' };
    expect(onDay(span, '2026-11-09', TZ)).toEqual({ from: 22 * 60, to: 1440 });
    expect(onDay(span, '2026-11-10', TZ)).toEqual({ from: 0, to: 120 });
    expect(onDay(span, '2026-11-11', TZ)).toBeNull();
  });

  it('shows the business hours, widened to anything outside them', () => {
    const hours = [{ open: '07:00', close: '18:00' }];
    expect(gridHours(hours, [])).toEqual({ first: 7, last: 18 });
    expect(gridHours(hours, [{ from: 6 * 60 + 30, to: 7 * 60 }])).toEqual({ first: 6, last: 18 });
  });
});

describe('openStretches', () => {
  it('joins overlapping hourly slots into one stretch and counts them', () => {
    const slots = [
      { start: '2026-11-10T15:00:00Z', end: '2026-11-10T16:00:00Z' },
      { start: '2026-11-10T16:00:00Z', end: '2026-11-10T17:00:00Z' },
      { start: '2026-11-10T20:00:00Z', end: '2026-11-10T21:00:00Z' },
    ];
    expect(openStretches(slots)).toEqual([
      { start: '2026-11-10T15:00:00Z', end: '2026-11-10T17:00:00Z', slots: 2 },
      { start: '2026-11-10T20:00:00Z', end: '2026-11-10T21:00:00Z', slots: 1 },
    ]);
  });
});

describe('lanes', () => {
  it('puts overlapping blocks side by side and leaves others full width', () => {
    const placed = lanes([
      { id: 'a', from: 540, to: 660 },
      { id: 'b', from: 600, to: 720 },
      { id: 'c', from: 780, to: 840 },
    ]);
    expect(placed.map((p) => [p.id, p.lane, p.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ]);
  });
});

describe('labels', () => {
  it('writes time ranges the way people say them', () => {
    expect(rangeLabel(9 * 60, 11 * 60)).toBe('9–11 AM');
    expect(rangeLabel(11 * 60 + 30, 13 * 60)).toBe('11:30 AM–1 PM');
    expect(rangeLabel(13 * 60, 17 * 60)).toBe('1–5 PM');
    expect(rangeLabel(8 * 60, 12 * 60)).toBe('8 AM–12 PM');
    expect(duration(90)).toBe('1 h 30 min');
    expect(duration(45)).toBe('45 min');
  });

  it('counts down to the next appointment', () => {
    const now = new Date('2026-11-10T15:00:00Z');
    expect(untilLabel(now, '2026-11-10T17:10:00Z')).toBe('in 2 h 10 min');
    expect(untilLabel(now, '2026-11-10T14:00:00Z')).toBe('now');
    expect(untilLabel(now, '2026-11-13T15:00:00Z')).toBe('in 3 days');
  });

  it('says how long ago the calendar synced', () => {
    const now = new Date('2026-11-10T15:00:00Z');
    expect(agoLabel('2026-11-10T14:59:40Z', now)).toBe('just now');
    expect(agoLabel('2026-11-10T14:57:00Z', now)).toBe('3 min ago');
    expect(agoLabel('2026-11-10T12:00:00Z', now)).toBe('3 h ago');
  });
});

describe('directions', () => {
  it('links to driving directions in Apple Maps or Google Maps', () => {
    expect(directionsUrl('9904 Cedar Ave, Cedar Falls', 'apple')).toBe(
      'https://maps.apple.com/?daddr=9904%20Cedar%20Ave%2C%20Cedar%20Falls&dirflg=d',
    );
    expect(directionsUrl('9904 Cedar Ave, Cedar Falls', 'google')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=9904%20Cedar%20Ave%2C%20Cedar%20Falls&travelmode=driving',
    );
  });

  it('picks Apple Maps on Apple devices and Google Maps elsewhere', () => {
    expect(preferredMaps('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('apple');
    expect(preferredMaps('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('google');
    expect(preferredMaps('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('google');
  });
});
