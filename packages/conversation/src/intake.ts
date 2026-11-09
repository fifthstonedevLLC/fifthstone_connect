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
  job: 'send_text_back' | 'handle_offer_reply' | 'clarify_lead' | 'transcribe_voicemail' | null;
}

/**
 * - A missed call from someone without an open lead starts one and gets the text-back. A call on
 *   an open lead joins it quietly.
 * - A voicemail is transcribed and read first (`transcribe_voicemail`), and the text-back for a
 *   new caller follows from what they said. A clinic's voicemail is never transcribed (CLAUDE.md
 *   rule 13): a new clinic caller gets the plain text-back.
 * - A text while times are on offer goes to the offer step (`handle_offer_reply`).
 * - A text while the lead is being clarified, or a first text from someone new, goes to the
 *   clarify step (`clarify_lead`). Not for clinics: their texts never reach the AI layer
 *   (CLAUDE.md rule 13), so a person reads them.
 * - Any other text needs a person: the lead goes to Reply on the Front Desk. A lead already
 *   waiting on a person keeps its reason (an emergency stays one).
 */
export function planInbound(
  kind: InboundKind,
  openLead: LeadState | null,
  options: { clinic?: boolean } = {},
): InboundPlan {
  const create = openLead === null ? 'missed_call' : null;
  if (kind === 'voicemail' && !options.clinic) {
    return { create, move: null, job: 'transcribe_voicemail' };
  }
  if (kind === 'missed_call' || kind === 'voicemail') {
    return { create, move: null, job: openLead === null ? 'send_text_back' : null };
  }
  if (openLead === 'offered') return { create: null, move: null, job: 'handle_offer_reply' };
  const clarifying = openLead === null || openLead === 'new' || openLead === 'clarifying';
  if (clarifying && !options.clinic) {
    return { create: openLead === null ? 'text' : null, move: null, job: 'clarify_lead' };
  }
  if (openLead === 'needs_attention') return { create: null, move: null, job: null };
  return {
    create: openLead === null ? 'text' : null,
    move: { state: 'needs_attention', reason: 'new_message' },
    job: null,
  };
}
