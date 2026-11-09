import { describe, expect, it } from 'vitest';
import {
  canOffer,
  chooseOffer,
  holdExpiry,
  offerHorizonDays,
  parseChoice,
  slotList,
  type OfferSlot,
} from './offers.js';

const slot = (iso: string, date: string): OfferSlot => ({
  start: new Date(iso),
  end: new Date(Date.parse(iso) + 3_600_000),
  date,
});

describe('chooseOffer', () => {
  it('offers the earliest time on each of the first three days', () => {
    const slots = [
      slot('2026-11-10T15:00:00Z', '2026-11-10'),
      slot('2026-11-10T16:00:00Z', '2026-11-10'),
      slot('2026-11-11T14:00:00Z', '2026-11-11'),
      slot('2026-11-12T19:00:00Z', '2026-11-12'),
      slot('2026-11-13T14:00:00Z', '2026-11-13'),
    ];
    expect(chooseOffer(slots).map((s) => s.start.toISOString())).toEqual([
      '2026-11-10T15:00:00.000Z',
      '2026-11-11T14:00:00.000Z',
      '2026-11-12T19:00:00.000Z',
    ]);
  });

  it('fills from the same day when fewer days are open, and offers what there is', () => {
    const slots = [
      slot('2026-11-10T16:00:00Z', '2026-11-10'),
      slot('2026-11-10T15:00:00Z', '2026-11-10'),
      slot('2026-11-11T14:00:00Z', '2026-11-11'),
    ];
    expect(chooseOffer(slots).map((s) => s.start.toISOString())).toEqual([
      '2026-11-10T15:00:00.000Z',
      '2026-11-10T16:00:00.000Z',
      '2026-11-11T14:00:00.000Z',
    ]);
    expect(chooseOffer([])).toEqual([]);
  });
});

describe('offer wording and replies', () => {
  it('numbers the times in the business time zone', () => {
    const list = slotList(
      [{ start: new Date('2026-11-10T15:00:00Z') }, { start: new Date('2026-11-11T20:30:00Z') }],
      'America/Chicago',
    );
    expect(list).toBe('1) Tue, Nov 10 at 9:00 AM 2) Wed, Nov 11 at 2:30 PM');
  });

  it('understands a plain number from the offer and nothing else', () => {
    for (const reply of ['2', ' 2 ', '2.', '#2', 'Option 2', 'no. 2']) {
      expect(parseChoice(reply, 3), reply).toBe(2);
    }
    for (const reply of ['4', '0', '2 or 3', 'Saturday?', 'yes', '', '22']) {
      expect(parseChoice(reply, 3), reply).toBeNull();
    }
    expect(parseChoice('3', 2)).toBeNull();
  });
});

describe('when to offer', () => {
  it('never offers times for an emergency, and looks further ahead when flexible', () => {
    expect(offerHorizonDays('emergency')).toBeNull();
    expect(offerHorizonDays('this_week')).toBe(7);
    expect(offerHorizonDays('flexible')).toBe(14);
    expect(offerHorizonDays(null)).toBe(14);
  });

  it('offers only to open leads without a pending request', () => {
    expect(canOffer('clarifying', false)).toBe(true);
    expect(canOffer('requested', false)).toBe(true);
    expect(canOffer('requested', true)).toBe(false);
    expect(canOffer('booked', false)).toBe(false);
    expect(canOffer('opted_out', false)).toBe(false);
  });
});

describe('holdExpiry', () => {
  const now = new Date('2026-11-10T15:00:00Z');

  it('releases after the hold time, or two hours before the slot if that is sooner', () => {
    expect(holdExpiry(now, new Date('2026-11-14T15:00:00Z'), 1440).toISOString()).toBe(
      '2026-11-11T15:00:00.000Z',
    );
    expect(holdExpiry(now, new Date('2026-11-10T21:00:00Z'), 1440).toISOString()).toBe(
      '2026-11-10T19:00:00.000Z',
    );
  });

  it('never expires in the past', () => {
    expect(holdExpiry(now, new Date('2026-11-10T16:00:00Z'), 1440).toISOString()).toBe(
      '2026-11-10T15:15:00.000Z',
    );
  });
});
