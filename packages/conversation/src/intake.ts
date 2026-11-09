import type { LeadSource, LeadState } from '@fsc/core';

/**
 * What an inbound call or text does (SCOPE.md v0.2, step 1, Capture). The API records the event
 * and applies this plan in one transaction before it answers (CLAUDE.md rule 1); anything that
 * talks to a customer or a calendar is a queued job. Inbound content is data, never instructions
 * (rule 10): a text is matched against fixed keywords and an offer's numbers, nothing more.
 */

/** Carrier opt-out and opt-in keywords. STOP is honored at once (CLAUDE.md rule 12). */
export const OPT_OUT_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'] as const;
export const OPT_IN_WORDS = ['START', 'UNSTOP'] as const;

const keyword = (body: string) =>
  body
    .trim()
    .replace(/[.!]+$/, '')
    .toUpperCase();

export function isOptOut(body: string): boolean {
  return (OPT_OUT_WORDS as readonly string[]).includes(keyword(body));
}

export function isOptIn(body: string): boolean {
  return (OPT_IN_WORDS as readonly string[]).includes(keyword(body));
}

/**
 * A contact's lead stays open until it is closed: a new call or text from the same number joins
 * it rather than starting another. A closed, spam or opted-out lead never reopens; a new one is
 * started (opted out only after the customer texts START).
 */
export const CLOSED_LEAD_STATES: readonly LeadState[] = ['closed', 'spam', 'opted_out'];

export function isOpenLead(state: LeadState): boolean {
  return !CLOSED_LEAD_STATES.includes(state);
}

export type InboundKind = 'missed_call' | 'voicemail' | 'text_received';

export interface InboundPlan {
  /** Start a lead from this source, when the contact has no open lead. */
  create: LeadSource | null;
  /** Move the lead to this state, or leave it where it is. */
  move: { state: LeadState; reason: string | null } | null;
  /** The job to queue, by type; the key is built from the lead or the message. */
  job: 'send_text_back' | 'handle_offer_reply' | null;
}

/**
 * - A missed call (or a voicemail with no call recorded first) from someone without an open lead
 *   starts one and gets the text-back. A call on an open lead joins it quietly.
 * - A text while times are on offer goes to the offer step (`handle_offer_reply`).
 * - Any other text needs a person until the clarify step reads it: the lead goes to Reply on the
 *   Front Desk. A lead already waiting on a person keeps its reason (an emergency stays one).
 */
export function planInbound(kind: InboundKind, openLead: LeadState | null): InboundPlan {
  if (kind === 'missed_call' || kind === 'voicemail') {
    return openLead === null
      ? { create: 'missed_call', move: null, job: 'send_text_back' }
      : { create: null, move: null, job: null };
  }
  if (openLead === 'offered') return { create: null, move: null, job: 'handle_offer_reply' };
  if (openLead === 'needs_attention') return { create: null, move: null, job: null };
  return {
    create: openLead === null ? 'text' : null,
    move: { state: 'needs_attention', reason: 'new_message' },
    job: null,
  };
}
