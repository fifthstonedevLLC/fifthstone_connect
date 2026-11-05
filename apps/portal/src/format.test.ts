import { describe, expect, it } from 'vitest';
import { displayName, slotLabel, statusLine, summarySentence, whenLabel } from './format';
import type { LeadCard } from './types';

const TZ = 'America/Chicago';
const card = (over: Partial<LeadCard>): LeadCard => ({
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Marcus T.',
  phone: '+13195550142',
  summary: null,
  state: 'requested',
  reason: null,
  urgency: null,
  createdAt: '2026-11-05T14:15:00Z',
  slotStart: null,
  ...over,
});

describe('whenLabel', () => {
  const now = new Date('2026-11-05T18:00:00Z'); // 12:00 PM in Chicago
  it('shows a clock time for today, "Yesterday", then a date, in the business time zone', () => {
    expect(whenLabel('2026-11-05T14:42:00Z', TZ, now)).toBe('8:42 AM');
    expect(whenLabel('2026-11-04T23:30:00Z', TZ, now)).toBe('Yesterday');
    expect(whenLabel('2026-11-02T15:00:00Z', TZ, now)).toBe('Mon, Nov 2');
  });

  it('uses the business time zone, not UTC, for the day boundary', () => {
    // 03:00 UTC on Nov 5 is still Nov 4 in Chicago.
    expect(whenLabel('2026-11-05T03:00:00Z', TZ, now)).toBe('Yesterday');
  });
});

describe('statusLine', () => {
  it('describes a request with its slot and urgency', () => {
    const slot = '2026-11-12T20:00:00Z';
    expect(statusLine(card({ slotStart: slot, urgency: 'flexible' }), TZ)).toBe(
      `Picked ${slotLabel(slot, TZ)} · flexible · waiting for your OK`,
    );
  });

  it('names why a lead needs a person, with a safe default', () => {
    expect(statusLine(card({ state: 'needs_attention', reason: 'emergency' }), TZ)).toBe(
      'Emergency',
    );
    expect(statusLine(card({ state: 'needs_attention', reason: 'something_new' }), TZ)).toBe(
      'Needs a person',
    );
  });

  it('says booked only with what the server reported', () => {
    expect(statusLine(card({ state: 'booked' }), TZ)).toBe('Booked');
  });
});

describe('summarySentence', () => {
  it('names who needs the owner', () => {
    expect(summarySentence([])).toBe('Nothing needs you right now.');
    expect(summarySentence([card({})])).toBe('Marcus T. needs you.');
    expect(summarySentence([card({ name: 'Dana M.' }), card({})])).toBe(
      'Dana M. and Marcus T. need you.',
    );
    expect(summarySentence([card({ name: 'A' }), card({ name: 'B' }), card({}), card({})])).toBe(
      'A, B and 2 others need you.',
    );
  });

  it('falls back to the phone number for unknown callers', () => {
    expect(displayName(card({ name: null }))).toBe('(319) 555-0142');
  });
});
