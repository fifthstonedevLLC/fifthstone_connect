import { describe, expect, it } from 'vitest';
import { isUrgent, urgentFirst, type AttentionFacts } from './attention.js';

const lead = (over: Partial<AttentionFacts> & { id?: string } = {}) => ({
  id: 'x',
  state: 'needs_attention' as const,
  urgency: null,
  reason: null,
  ...over,
});

describe('isUrgent', () => {
  it('marks emergencies, safety messages and crisis messages', () => {
    expect(isUrgent(lead({ urgency: 'emergency' }))).toBe(true);
    expect(isUrgent(lead({ reason: 'safety_message_sent' }))).toBe(true);
    // Minimum-data leads have no urgency; the crisis reason alone is enough.
    expect(isUrgent(lead({ reason: 'crisis_message_sent' }))).toBe(true);
  });

  it('leaves other leads in their usual order', () => {
    expect(isUrgent(lead({ reason: 'price_question', urgency: 'this_week' }))).toBe(false);
    expect(isUrgent(lead({ state: 'booked', urgency: 'emergency' }))).toBe(false);
  });
});

describe('urgentFirst', () => {
  it('moves urgent leads to the top and keeps the rest in order', () => {
    const ordered = urgentFirst([
      lead({ id: 'a' }),
      lead({ id: 'b', reason: 'crisis_message_sent' }),
      lead({ id: 'c' }),
      lead({ id: 'd', urgency: 'emergency' }),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
