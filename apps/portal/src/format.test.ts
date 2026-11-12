import { describe, expect, it } from 'vitest';
import {
  authorLabel,
  displayName,
  durationLabel,
  leadProgress,
  slotLabel,
  statusLine,
  urgencyLabel,
  whenLabel,
  workLabel,
  actionErrorMessage,
  placeholderLabel,
  savedAtLabel,
  settingsErrorMessage,
  templateProblemMessage,
  urgentFlag,
  guidanceFor,
  needLine,
  waitingLabel,
  sentence,
  waitLimitLabel,
} from './format';
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
  requestState: null,
  holdExpiresAt: null,
  urgent: false,
  waitingSince: '2026-11-05T14:15:00Z',
  next: { need: 'their_move', action: null },
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
  it('names what a new text or an offer problem needs', () => {
    expect(statusLine(card({ state: 'needs_attention', reason: 'new_message' }), TZ)).toBe(
      'New text to read',
    );
    expect(statusLine(card({ state: 'needs_attention', reason: 'no_open_times' }), TZ)).toBe(
      'No open times to offer',
    );
  });

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
    expect(statusLine(card({ state: 'needs_attention', reason: 'crisis_message_sent' }), TZ)).toBe(
      'Crisis message sent',
    );
    expect(statusLine(card({ state: 'needs_attention', reason: 'something_new' }), TZ)).toBe(
      'Needs a person',
    );
  });

  it('flags a crisis lead as a crisis, and other urgent leads as emergencies', () => {
    expect(urgentFlag(card({ urgent: true, reason: 'crisis_message_sent' }))).toBe('Crisis');
    expect(urgentFlag(card({ urgent: true, reason: 'safety_message_sent' }))).toBe('Emergency');
  });

  it('says booked only with what the server reported', () => {
    expect(statusLine(card({ state: 'booked' }), TZ)).toBe('Booked');
  });
});

describe('displayName', () => {
  it('falls back to the phone number for unknown callers', () => {
    expect(displayName(card({ name: null }))).toBe('(319) 555-0142');
  });
});

describe('leadProgress', () => {
  it('marks earlier steps done and the current one current', () => {
    expect(leadProgress('missed_call', 'requested')?.map((s) => s.status)).toEqual([
      'done',
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });

  it('names the first step after how the lead arrived', () => {
    expect(leadProgress('form', 'offered')?.[0]?.label).toBe('Form received');
  });

  it('completes every step once booked', () => {
    expect(leadProgress('text', 'booked')?.every((s) => s.status === 'done')).toBe(true);
  });

  it('shows no line for a lead off the normal path', () => {
    expect(leadProgress('missed_call', 'needs_attention')).toBeNull();
    expect(leadProgress('missed_call', 'quiet')).toBeNull();
  });
});

describe('labels', () => {
  it('formats voicemail length and urgency', () => {
    expect(durationLabel(24)).toBe('0:24');
    expect(durationLabel(95)).toBe('1:35');
    expect(urgencyLabel('this_week')).toBe('This week');
    expect(urgencyLabel(null)).toBe('Not known yet');
  });

  it('says who wrote each message', () => {
    expect(authorLabel('template', 'Marcus T.')).toBe('You, from your template');
    expect(authorLabel('customer', 'Marcus T.')).toBe('Marcus T.');
  });
});

describe('decided requests', () => {
  it('says what is happening after a portal decision', () => {
    const slot = '2026-11-12T20:00:00Z';
    expect(statusLine(card({ slotStart: slot, requestState: 'approved' }), TZ)).toBe(
      `Approved · confirming ${slotLabel(slot, TZ)} with your calendar`,
    );
    expect(statusLine(card({ requestState: 'changed' }), TZ)).toBe('Sending new times');
  });

  it('describes pending work and refused actions in plain words', () => {
    expect(workLabel('confirm_calendar_event', 'queued')).toBe(
      'Creating the calendar event: queued',
    );
    expect(workLabel('something_new', 'dead')).toBe("Working: didn't go through");
    expect(actionErrorMessage('hold_expired')).toMatch(/lapsed/);
    expect(actionErrorMessage('unknown_code')).toMatch(/Nothing was changed/);
  });
});

describe('settings', () => {
  it('names placeholders and template problems in plain words', () => {
    expect(placeholderLabel('slot')).toBe('{slot} (the time)');
    expect(templateProblemMessage({ code: 'missing_opt_out' })).toBe(
      'Keep the opt-out line: "Reply STOP to opt out."',
    );
    expect(templateProblemMessage({ code: 'missing_placeholder', placeholder: 'slots' })).toBe(
      'Keep {slots} (open times) in this text.',
    );
    expect(templateProblemMessage({ code: 'non_gsm', characters: ['’', '🙂'] })).toMatch(
      /^Replace ’ 🙂:/,
    );
    expect(templateProblemMessage({ code: 'too_long', segments: 3 })).toMatch(/3 segments/);
  });

  it('dates versions in the business time zone and explains refusals', () => {
    expect(savedAtLabel('2026-11-05T20:10:00Z', TZ)).toBe('Nov 5, 2:10 PM');
    expect(settingsErrorMessage('stale_version')).toMatch(/changed since you opened them/);
    expect(settingsErrorMessage('something_else')).toMatch(/Nothing was saved/);
  });
});

describe('the work list', () => {
  it('says how long a lead has waited, in plain units', () => {
    const now = new Date('2026-11-05T18:00:00Z');
    expect(waitingLabel('2026-11-05T17:35:00Z', now)).toBe('Waiting 25 min');
    expect(waitingLabel('2026-11-05T15:00:00Z', now)).toBe('Waiting 3 h');
    expect(waitingLabel('2026-11-04T17:00:00Z', now)).toBe('Waiting 1 day');
    expect(waitingLabel('2026-11-01T18:00:00Z', now)).toBe('Waiting 4 days');
  });

  it('describes a nudged lead without guessing whether the text arrived', () => {
    expect(needLine(card({ state: 'quiet', next: { need: 'nudged', action: null } }), TZ)).toBe(
      'Nudged. Waiting for a reply.',
    );
  });

  it('says a booking is moved by a person, never automatically', () => {
    expect(guidanceFor('reschedule')).toMatch(/never moved automatically/);
    expect(guidanceFor('something_new')).toBeNull();
  });
});

describe('sentence', () => {
  it('never doubles the period after an initial', () => {
    expect(sentence('Next: Ben C.')).toBe('Next: Ben C.');
    expect(sentence('Next: Ivy')).toBe('Next: Ivy.');
  });
});

describe('waitLimitLabel', () => {
  it("names the business's Act now limit in plain words", () => {
    expect([1, 4, 8, 24, 48].map(waitLimitLabel)).toEqual([
      'an hour',
      '4 hours',
      '8 hours',
      'a day',
      '2 days',
    ]);
  });
});
