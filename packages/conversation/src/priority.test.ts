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
