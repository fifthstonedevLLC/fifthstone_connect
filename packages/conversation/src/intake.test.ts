import { describe, expect, it } from 'vitest';
import { isOpenLead, isOptIn, isOptOut, planInbound } from './intake.js';

describe('keywords', () => {
  it('honors the carrier opt-out words, however they are typed', () => {
    for (const body of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'QUIT!', 'StopAll']) {
      expect(isOptOut(body), body).toBe(true);
    }
    for (const body of ['Stop by at 3?', 'please stop texting me tomorrow', '2', 'start']) {
      expect(isOptOut(body), body).toBe(false);
    }
  });

  it('opts back in only on START or UNSTOP', () => {
    expect(isOptIn('START')).toBe(true);
    expect(isOptIn('unstop')).toBe(true);
    expect(isOptIn('yes')).toBe(false);
  });
});

describe('planInbound', () => {
  it('starts a lead and texts back on a missed call from someone new', () => {
    expect(planInbound('missed_call', null)).toEqual({
      create: 'missed_call',
      move: null,
      job: 'send_text_back',
    });
    expect(planInbound('voicemail', null).job).toBe('send_text_back');
  });

  it('joins a call to an open lead without texting again', () => {
    expect(planInbound('missed_call', 'clarifying')).toEqual({
      create: null,
      move: null,
      job: null,
    });
  });

  it('sends a reply to open times to the offer step', () => {
    expect(planInbound('text_received', 'offered')).toEqual({
      create: null,
      move: null,
      job: 'handle_offer_reply',
    });
  });

  it('puts any other text in front of a person, keeping an existing reason', () => {
    expect(planInbound('text_received', null)).toEqual({
      create: 'text',
      move: { state: 'needs_attention', reason: 'new_message' },
      job: null,
    });
    expect(planInbound('text_received', 'booked').move).toEqual({
      state: 'needs_attention',
      reason: 'new_message',
    });
    expect(planInbound('text_received', 'needs_attention').move).toBeNull();
  });

  it('never reopens a closed lead', () => {
    expect(isOpenLead('closed')).toBe(false);
    expect(isOpenLead('opted_out')).toBe(false);
    expect(isOpenLead('quiet')).toBe(true);
  });
});
