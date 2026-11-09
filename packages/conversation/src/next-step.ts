import type { LeadState, Urgency } from '@fsc/core';
import { isUrgent } from './attention.js';

/**
 * What a lead needs from a person right now, and the one action that fits. The portal shows the
 * need as the tile's indicator and the action as its button; the rule lives here, on the server,
 * so the two can never disagree with what the API will accept (decision 24).
 *
 * Only a person moves or cancels an existing booking (CLAUDE.md rule 14), so those needs lead to
 * the lead page with a call, never to an automatic change.
 */

export const NEEDS = [
  /** Someone may be at risk: an emergency, a safety or a crisis message went out. */
  'call_now',
  /** A customer picked a time; it is held and waits for an OK. */
  'approve',
  /** A person should call: under 18, not in English, upset, a text that did not arrive ... */
  'call_back',
  /** They asked something only a person answers, such as a price. */
  'reply',
  /** They want to move or cancel an existing booking. */
  'reschedule',
  'cancel',
  /** A voicemail nobody could read for them (unclear, or a minimum-data business). */
  'listen',
  /** Something did not go through (a lapsed hold, a failed booking); look before acting. */
  'review',
  /** Approved; the calendar event is being made. */
  'confirming',
  /** Waiting on the customer's reply. */
  'their_move',
  'booked',
  /** No reply for a day; one nudge is allowed. */
  'follow_up',
  /** The one nudge is queued or sent. */
  'nudged',
] as const;

export const NEXT_ACTIONS = [
  'call',
  'approve',
  'nudge',
  'reply',
  'reschedule',
  'listen',
  'open',
] as const;

export type Need = (typeof NEEDS)[number];

export type NextAction = (typeof NEXT_ACTIONS)[number];

export interface NextStep {
  need: Need;
  /** The tile's button, or null when there is nothing for a person to do. */
  action: NextAction | null;
  urgent: boolean;
}

export interface NextStepFacts {
  state: LeadState;
  reason: string | null;
  urgency: Urgency | null;
  requestState: 'pending' | 'approved' | 'changed' | null;
  hasPhone: boolean;
  hasVoicemail: boolean;
  nudged: boolean;
}

const CALL_BACK_REASONS = new Set([
  'minor',
  'not_english',
  'texting_not_live',
  'private_details',
  'complaint',
  'delivery_failed',
  // The offer step could not offer times: a person calls to agree one.
  'no_open_times',
  'calendar_unavailable',
]);

export function nextStep(lead: NextStepFacts): NextStep {
  const urgent = isUrgent(lead);
  const call: NextAction = lead.hasPhone ? 'call' : 'open';

  switch (lead.state) {
    case 'needs_attention': {
      if (urgent) return { need: 'call_now', action: call, urgent };
      switch (lead.reason) {
        case 'reschedule':
          return { need: 'reschedule', action: 'reschedule', urgent };
        case 'cancellation':
          return { need: 'cancel', action: call, urgent };
        // A price question, an answer to the offered times that is not a number from it, or a
        // new text a person has not read yet.
        case 'price_question':
        case 'unclear_reply':
        case 'new_message':
          return { need: 'reply', action: 'reply', urgent };
        case 'voicemail_to_review':
          return { need: 'listen', action: 'listen', urgent };
        case 'unsure':
          return lead.hasVoicemail
            ? { need: 'listen', action: 'listen', urgent }
            : { need: 'call_back', action: call, urgent };
        case 'hold_expired':
        case 'booking_failed':
          return { need: 'review', action: 'open', urgent };
        default:
          return lead.reason !== null && !CALL_BACK_REASONS.has(lead.reason)
            ? { need: 'review', action: 'open', urgent }
            : { need: 'call_back', action: call, urgent };
      }
    }
    case 'requested':
      if (lead.requestState === 'pending') return { need: 'approve', action: 'approve', urgent };
      if (lead.requestState === 'approved') return { need: 'confirming', action: null, urgent };
      return { need: 'their_move', action: null, urgent };
    case 'quiet':
      return lead.nudged
        ? { need: 'nudged', action: null, urgent }
        : { need: 'follow_up', action: 'nudge', urgent };
    case 'booked':
      return { need: 'booked', action: null, urgent };
    default:
      return { need: 'their_move', action: null, urgent };
  }
}

/** Needs whose next move is a person's at the business (the rest wait on the customer). */
export const OWNER_NEEDS: readonly Need[] = [
  'call_now',
  'approve',
  'reply',
  'call_back',
  'reschedule',
  'cancel',
  'listen',
  'review',
  'follow_up',
];
