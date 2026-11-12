import { describe, expect, it } from 'vitest';
import { priorityOf, topPriority, type PriorityFacts } from './priority.js';

const now = new Date('2026-11-08T18:00:00Z');
const lead = (over: Partial<PriorityFacts>): PriorityFacts => ({
  need: 'reply',
  urgent: false,
  waitingSince: '2026-11-08T16:00:00Z',
  ...over,
});

describe('priorityOf', () => {
  it('is red when someone may be at risk, however new', () => {
    expect(
      priorityOf(
        lead({ need: 'call_now', urgent: true, waitingSince: '2026-11-08T17:59:00Z' }),
        now,
      ),
    ).toEqual({ level: 'now', reason: 'risk' });
  });

  it('is amber for the owner’s move, and turns red after a day of waiting', () => {
    expect(priorityOf(lead({ waitingSince: '2026-11-08T10:00:00Z' }), now)).toEqual({
      level: 'soon',
      reason: 'yours',
    });
    expect(priorityOf(lead({ waitingSince: '2026-11-07T18:00:00Z' }), now)).toEqual({
      level: 'now',
      reason: 'overdue',
    });
  });

  it('is green while waiting on the customer, confirming or booked, however long', () => {
    for (const need of ['their_move', 'nudged', 'confirming', 'booked'] as const) {
      expect(priorityOf(lead({ need, waitingSince: '2026-11-01T00:00:00Z' }), now).level).toBe(
        'on_track',
      );
    }
  });
});

describe('topPriority', () => {
  it('picks the most urgent level, or none', () => {
    expect(topPriority(['on_track', 'soon', 'now'])).toBe('now');
    expect(topPriority(['on_track', 'soon'])).toBe('soon');
    expect(topPriority([])).toBeNull();
  });
});

describe('priorityOf: closer to too late (decision 37)', () => {
  it('turns a request red a few hours before its hold runs out, not when it does', () => {
    const approve = (hoursLeft: number) =>
      priorityOf(
        lead({
          need: 'approve',
          waitingSince: '2026-11-08T08:00:00Z',
          holdExpiresAt: new Date(now.getTime() + hoursLeft * 3_600_000).toISOString(),
        }),
        now,
      );
    expect(approve(5)).toEqual({ level: 'soon', reason: 'yours' });
    expect(approve(4)).toEqual({ level: 'now', reason: 'hold_expiring' });
    expect(approve(-1)).toEqual({ level: 'now', reason: 'hold_expiring' });
  });

  it('turns a move or cancel red at once when the appointment is within two days', () => {
    for (const need of ['reschedule', 'cancel'] as const) {
      expect(priorityOf(lead({ need, appointmentAt: '2026-11-09T15:00:00Z' }), now)).toEqual({
        level: 'now',
        reason: 'appointment_soon',
      });
      expect(priorityOf(lead({ need, appointmentAt: '2026-11-20T15:00:00Z' }), now)).toEqual({
        level: 'soon',
        reason: 'yours',
      });
    }
  });

  it("uses the business's own limit for waiting too long", () => {
    const twoHours = lead({ waitingSince: '2026-11-08T13:00:00Z' });
    expect(priorityOf({ ...twoHours, overdueHours: 4 }, now)).toEqual({
      level: 'now',
      reason: 'overdue',
    });
    expect(priorityOf({ ...twoHours, overdueHours: 24 }, now).level).toBe('soon');
    expect(priorityOf(twoHours, now).level).toBe('soon');
  });

  it('only applies the hold and appointment checks to the needs they are about', () => {
    expect(
      priorityOf(lead({ need: 'reply', holdExpiresAt: '2026-11-08T18:30:00Z' }), now).level,
    ).toBe('soon');
  });
});
