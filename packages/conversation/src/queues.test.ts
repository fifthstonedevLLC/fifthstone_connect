import { describe, expect, it } from 'vitest';
import { NEEDS } from './next-step.js';
import { inQueue, isQueueKey, orderForQueue, QUEUES, queueFor, type Queueable } from './queues.js';

const now = new Date('2026-11-09T18:00:00Z');
const facts = (
  need: (typeof NEEDS)[number],
  over: { urgent?: boolean; waitingSince?: string } = {},
) => ({
  need,
  urgent: false,
  waitingSince: '2026-11-09T16:00:00Z',
  ...over,
});

describe('queues', () => {
  it('puts every need in exactly one task queue', () => {
    for (const need of NEEDS) {
      const homes = QUEUES.filter((q) => q.key !== 'act_now' && inQueue(q.key, facts(need), now));
      expect(homes, need).toHaveLength(1);
    }
  });

  it('fills Act now with the red level only: at risk, or waited over a day', () => {
    expect(inQueue('act_now', facts('call_now', { urgent: true }), now)).toBe(true);
    expect(inQueue('act_now', facts('reply', { waitingSince: '2026-11-08T12:00:00Z' }), now)).toBe(
      true,
    );
    expect(inQueue('act_now', facts('reply'), now)).toBe(false);
    expect(
      inQueue('act_now', facts('their_move', { waitingSince: '2026-11-01T00:00:00Z' }), now),
    ).toBe(false);
  });

  it('files related needs together, urgent calls with call-backs', () => {
    expect(queueFor('call_now')).toBe('call_back');
    expect(queueFor('cancel')).toBe('reschedule');
    expect(queueFor('nudged')).toBe('waiting');
    expect(queueFor('confirming')).toBe('booked');
  });

  it('recognises queue keys from a link', () => {
    expect(isQueueKey('act_now')).toBe(true);
    expect(isQueueKey('needs_you')).toBe(false);
    expect(isQueueKey(null)).toBe(false);
  });
});

describe('orderForQueue', () => {
  const item = (id: string, over: Partial<Queueable>) => ({
    id,
    urgent: false,
    waitingSince: '2026-11-05T12:00:00Z',
    slotStart: null,
    ...over,
  });
  const ids = (list: { id: string }[]) => list.map((i) => i.id);

  it('works business queues risk first, then longest waiting', () => {
    const list = [
      item('newest', { waitingSince: '2026-11-05T15:00:00Z' }),
      item('oldest', { waitingSince: '2026-11-04T09:00:00Z' }),
      item('urgent', { urgent: true, waitingSince: '2026-11-05T16:00:00Z' }),
    ];
    expect(ids(orderForQueue('act_now', list, (i) => i))).toEqual(['urgent', 'oldest', 'newest']);
  });

  it('shows the most recent first while waiting on the customer', () => {
    const list = [
      item('older', { waitingSince: '2026-11-04T09:00:00Z' }),
      item('recent', { waitingSince: '2026-11-05T15:00:00Z' }),
    ];
    expect(ids(orderForQueue('waiting', list, (i) => i))).toEqual(['recent', 'older']);
  });

  it('lists bookings by the soonest appointment', () => {
    const list = [
      item('friday', { slotStart: '2026-11-13T15:00:00Z' }),
      item('tuesday', { slotStart: '2026-11-10T15:00:00Z' }),
    ];
    expect(ids(orderForQueue('booked', list, (i) => i))).toEqual(['tuesday', 'friday']);
  });
});
