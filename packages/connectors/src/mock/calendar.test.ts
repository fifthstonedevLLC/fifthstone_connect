import { describe, expect, it } from 'vitest';
import { MockCalendar } from './index.js';

const T1 = 'tenant-mock-riverbend';
const T3 = 'tenant-mock-prairie-path';
const cal = { tenantId: T1, calendarId: 'MOCK-GCAL-T1' };
const at = (hour: number) => new Date(Date.UTC(2026, 10, 5, hour));
const slot = (start: number, end = start + 1) => ({ start: at(start), end: at(end) });
const day = slot(0, 24);

describe('MockCalendar', () => {
  it('reports seeded events as busy, per tenant', async () => {
    const calendar = new MockCalendar();
    calendar.addEvent(T1, cal.calendarId, slot(15));
    expect(await calendar.busy({ ...cal, range: day })).toEqual({ ok: true, value: [slot(15)] });
    expect(await calendar.busy({ tenantId: T3, calendarId: cal.calendarId, range: day })).toEqual({
      ok: true,
      value: [],
    });
  });

  it('blocks a held slot from a second customer', async () => {
    const calendar = new MockCalendar();
    const hold = await calendar.placeHold({
      ...cal,
      slot: slot(20),
      title: 'HOLD: AC tune-up',
      idempotencyKey: 'place_hold:lead-rb-02',
    });
    expect(hold).toEqual({ ok: true, value: { holdRef: 'MOCK-CAL-0001' } });

    const second = await calendar.placeHold({
      ...cal,
      slot: { start: new Date(at(20).getTime() + 30 * 60_000), end: at(22) },
      title: 'HOLD: another customer',
      idempotencyKey: 'place_hold:lead-rb-05',
    });
    expect(second).toMatchObject({ ok: false, error: { code: 'slot_unavailable' } });
    expect(await calendar.busy({ ...cal, range: day })).toEqual({ ok: true, value: [slot(20)] });
  });

  it('places a hold once per key, even on retry', async () => {
    const calendar = new MockCalendar();
    const input = { ...cal, slot: slot(20), title: 'HOLD', idempotencyKey: 'place_hold:lead-1' };
    const first = await calendar.placeHold(input);
    expect(await calendar.placeHold(input)).toEqual(first);
    expect(calendar.entriesFor(T1)).toHaveLength(1);
  });

  it('turns a hold into an event on approval, and refuses released holds', async () => {
    const calendar = new MockCalendar();
    const placed = await calendar.placeHold({
      ...cal,
      slot: slot(20),
      title: 'HOLD',
      idempotencyKey: 'place_hold:lead-rb-02',
    });
    if (!placed.ok) throw new Error('hold not placed');
    const { holdRef } = placed.value;

    const confirmed = await calendar.confirmHold({
      ...cal,
      holdRef,
      title: 'AC tune-up: Marcus T.',
      description: '9912 Elm St, Cedar Falls',
      idempotencyKey: 'confirm_hold:lead-rb-02',
    });
    expect(confirmed).toEqual({ ok: true, value: { eventRef: holdRef } });
    expect(calendar.entriesFor(T1)[0]).toMatchObject({ kind: 'event' });
    expect(await calendar.releaseHold({ ...cal, holdRef })).toMatchObject({
      ok: false,
      error: { code: 'hold_confirmed' },
    });

    const other = await calendar.placeHold({
      ...cal,
      slot: slot(13),
      title: 'HOLD',
      idempotencyKey: 'place_hold:lead-rb-15',
    });
    if (!other.ok) throw new Error('hold not placed');
    expect(await calendar.releaseHold({ ...cal, holdRef: other.value.holdRef })).toEqual({
      ok: true,
      value: undefined,
    });
    // Releasing twice is fine; confirming a released hold is not.
    expect((await calendar.releaseHold({ ...cal, holdRef: other.value.holdRef })).ok).toBe(true);
    expect(
      await calendar.confirmHold({
        ...cal,
        holdRef: other.value.holdRef,
        title: 'x',
        description: 'x',
        idempotencyKey: 'confirm_hold:lead-rb-15',
      }),
    ).toMatchObject({ ok: false, error: { code: 'hold_not_found' } });
  });

  it('rejects an inverted slot', async () => {
    const result = await new MockCalendar().placeHold({
      ...cal,
      slot: { start: at(16), end: at(15) },
      title: 'HOLD',
      idempotencyKey: 'place_hold:bad',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_range' } });
  });

  it('fails every call permanently once access is revoked, for that tenant only', async () => {
    const calendar = new MockCalendar();
    calendar.revokeAccess(T1);
    expect(await calendar.busy({ ...cal, range: day })).toMatchObject({
      ok: false,
      error: { kind: 'permanent', code: 'auth_revoked' },
    });
    expect((await calendar.busy({ tenantId: T3, calendarId: 'MOCK-GCAL-T3', range: day })).ok).toBe(
      true,
    );
  });
});
