import { describe, expect, it } from 'vitest';
import { planAction, type LeadSnapshot } from './actions.js';

const now = new Date('2026-11-05T15:00:00Z');
const later = new Date('2026-11-06T15:00:00Z');
const earlier = new Date('2026-11-05T14:00:00Z');

const requested = (over: Partial<LeadSnapshot> = {}): LeadSnapshot => ({
  leadId: 'lead-1',
  state: 'requested',
  request: { id: 'req-1', state: 'pending', hold: { state: 'active', expiresAt: later } },
  optedOut: false,
  nudged: false,
  now,
  ...over,
});

describe('approve', () => {
  it('approves the pending request and queues the calendar event, not the booking', () => {
    const result = planAction('approve', requested());
    expect(result).toEqual({
      ok: true,
      plan: {
        request: { id: 'req-1', state: 'approved' },
        jobs: [
          { actionType: 'confirm_calendar_event', idempotencyKey: 'confirm_calendar_event:req-1' },
        ],
        skip: ['approval_reminder'],
        audit: { action: 'request.approved', subjectType: 'request', subjectId: 'req-1' },
      },
    });
    // The lead is not marked booked until the event exists (decision 24).
    expect(result.ok && result.plan.lead).toBeUndefined();
  });

  it('refuses when there is no pending request, or the hold has lapsed', () => {
    expect(planAction('approve', requested({ state: 'offered' }))).toEqual({
      ok: false,
      error: 'no_pending_request',
    });
    expect(
      planAction('approve', requested({ request: { id: 'req-1', state: 'approved', hold: null } })),
    ).toEqual({ ok: false, error: 'no_pending_request' });
    expect(
      planAction(
        'approve',
        requested({
          request: { id: 'req-1', state: 'pending', hold: { state: 'active', expiresAt: earlier } },
        }),
      ),
    ).toEqual({ ok: false, error: 'hold_expired' });
    expect(
      planAction(
        'approve',
        requested({
          request: { id: 'req-1', state: 'pending', hold: { state: 'released', expiresAt: later } },
        }),
      ),
    ).toEqual({ ok: false, error: 'hold_expired' });
  });
});

describe('suggest another time', () => {
  it('releases the hold and queues a fresh offer', () => {
    const result = planAction('suggest_time', requested());
    expect(result.ok && result.plan.jobs.map((j) => j.actionType)).toEqual([
      'release_hold',
      'send_slot_offer',
    ]);
    expect(result.ok && result.plan.request).toEqual({ id: 'req-1', state: 'changed' });
  });

  it('never queues a text to someone who opted out', () => {
    expect(planAction('suggest_time', requested({ optedOut: true }))).toEqual({
      ok: false,
      error: 'opted_out',
    });
  });
});

describe('nudge', () => {
  const quiet = requested({ state: 'quiet', request: null });

  it('queues one nudge for a quiet lead', () => {
    const result = planAction('nudge', quiet);
    expect(result.ok && result.plan.jobs).toEqual([
      { actionType: 'send_nudge', idempotencyKey: 'send_nudge:lead-1' },
    ]);
  });

  it('refuses a second nudge, a lead that is not quiet, or an opted-out contact', () => {
    expect(planAction('nudge', { ...quiet, nudged: true })).toEqual({
      ok: false,
      error: 'already_nudged',
    });
    expect(planAction('nudge', requested())).toEqual({ ok: false, error: 'not_quiet' });
    expect(planAction('nudge', { ...quiet, optedOut: true })).toEqual({
      ok: false,
      error: 'opted_out',
    });
  });
});

describe('close', () => {
  it('declines a pending request, releases its hold and stops follow-ups', () => {
    const result = planAction('close', requested());
    expect(result).toMatchObject({
      ok: true,
      plan: {
        request: { id: 'req-1', state: 'declined' },
        lead: { state: 'closed', reason: 'closed_in_portal' },
        jobs: [{ actionType: 'release_hold', idempotencyKey: 'release_hold:req-1' }],
      },
    });
    expect(result.ok && result.plan.skip).toContain('send_nudge');
  });

  it('closes a lead with no request without touching requests', () => {
    const result = planAction('close', requested({ state: 'needs_attention', request: null }));
    expect(result.ok && result.plan.request).toBeUndefined();
    expect(result.ok && result.plan.jobs).toEqual([]);
  });

  it('refuses booked and already-closed leads', () => {
    expect(planAction('close', requested({ state: 'booked' }))).toEqual({
      ok: false,
      error: 'booked',
    });
    for (const state of ['closed', 'spam', 'opted_out'] as const) {
      expect(planAction('close', requested({ state }))).toEqual({
        ok: false,
        error: 'already_closed',
      });
    }
  });
});
