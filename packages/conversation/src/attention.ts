import type { LeadState, Urgency } from '@fsc/core';

/**
 * Which leads a person must see first. An emergency, a safety message or a crisis message means
 * someone may be at risk, so those leads sit at the top of every queue they are in, however long ago
 * they came in. Nothing here acts on a lead; it only orders what a person sees.
 */

/** Reasons that mean a fixed safety or crisis message already went out and a person must follow up. */
export const URGENT_REASONS = ['emergency', 'safety_message_sent', 'crisis_message_sent'] as const;

export interface AttentionFacts {
  state: LeadState;
  urgency: Urgency | null;
  reason: string | null;
}

export function isUrgent(lead: AttentionFacts): boolean {
  if (lead.state !== 'needs_attention') return false;
  return (
    lead.urgency === 'emergency' ||
    (URGENT_REASONS as readonly string[]).includes(lead.reason ?? '')
  );
}

/** Urgent leads first; otherwise the order given (newest change first) is kept. */
export function urgentFirst<T extends AttentionFacts>(leads: readonly T[]): T[] {
  return [...leads.filter(isUrgent), ...leads.filter((lead) => !isUrgent(lead))];
}
