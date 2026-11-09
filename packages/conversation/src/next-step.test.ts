import { describe, expect, it } from 'vitest';
import { nextStep, type NextStepFacts } from './next-step.js';

const lead = (over: Partial<NextStepFacts>): NextStepFacts => ({
  state: 'needs_attention',
  reason: null,
  urgency: null,
  requestState: null,
  hasPhone: true,
  hasVoicemail: false,
  nudged: false,
  ...over,
});

describe('nextStep', () => {
  it('asks for a call first when someone may be at risk', () => {
    expect(nextStep(lead({ reason: 'emergency', urgency: 'emergency' }))).toEqual({
      need: 'call_now',
      action: 'call',
      urgent: true,
    });
    expect(nextStep(lead({ reason: 'crisis_message_sent' }))).toMatchObject({
      need: 'call_now',
      urgent: true,
    });
  });

  it('offers Approve for a held pick, and nothing while the calendar confirms it', () => {
    expect(nextStep(lead({ state: 'requested', requestState: 'pending' }))).toMatchObject({
      need: 'approve',
      action: 'approve',
    });
    expect(nextStep(lead({ state: 'requested', requestState: 'approved' }))).toMatchObject({
      need: 'confirming',
      action: null,
    });
    expect(nextStep(lead({ state: 'requested', requestState: 'changed' }))).toMatchObject({
      need: 'their_move',
      action: null,
    });
  });

  it('sends a reschedule to the lead page, never to an automatic move', () => {
    expect(nextStep(lead({ reason: 'reschedule' }))).toMatchObject({
      need: 'reschedule',
      action: 'reschedule',
    });
    expect(nextStep(lead({ reason: 'cancellation' }))).toMatchObject({
      need: 'cancel',
      action: 'call',
    });
  });

  it('matches the action to the need', () => {
    expect(nextStep(lead({ reason: 'price_question' })).action).toBe('reply');
    expect(nextStep(lead({ reason: 'voicemail_to_review' })).action).toBe('listen');
    expect(nextStep(lead({ reason: 'unsure', hasVoicemail: true })).action).toBe('listen');
    expect(nextStep(lead({ reason: 'minor' }))).toMatchObject({
      need: 'call_back',
      action: 'call',
    });
    expect(nextStep(lead({ reason: 'hold_expired' }))).toMatchObject({
      need: 'review',
      action: 'open',
    });
  });

  it('sends offer-step problems to the right person action', () => {
    expect(nextStep(lead({ reason: 'no_open_times' }))).toMatchObject({ need: 'call_back' });
    expect(nextStep(lead({ reason: 'calendar_unavailable' }))).toMatchObject({ need: 'call_back' });
    expect(nextStep(lead({ reason: 'unclear_reply' }))).toMatchObject({
      need: 'reply',
      action: 'reply',
    });
  });

  it('opens the lead instead of offering a call when there is no number', () => {
    expect(nextStep(lead({ reason: 'complaint', hasPhone: false })).action).toBe('open');
  });

  it('offers one nudge to a quiet lead, then nothing', () => {
    expect(nextStep(lead({ state: 'quiet' }))).toMatchObject({
      need: 'follow_up',
      action: 'nudge',
    });
    expect(nextStep(lead({ state: 'quiet', nudged: true }))).toMatchObject({
      need: 'nudged',
      action: null,
    });
  });

  it('leaves leads waiting on the customer, or booked, without a button', () => {
    for (const state of ['new', 'clarifying', 'offered'] as const) {
      expect(nextStep(lead({ state })).action).toBeNull();
    }
    expect(nextStep(lead({ state: 'booked' }))).toMatchObject({ need: 'booked', action: null });
  });
});
