/**
 * Fixed safety and crisis messages (SCOPE.md v0.2, Guardrails: "Emergencies skip the queue").
 * When a customer's own words show a hazard, a fixed message goes out before anything else and
 * the approvers are alerted at once. The wording lives here, in code: owners cannot edit or remove
 * it and the AI layer never writes it (CLAUDE.md rule 11). Detection is a fixed list of phrases,
 * not AI, so it works for clinics without their messages ever reaching a model (rule 13).
 *
 * The crisis message points to 911 only (owner, 2026-11-09). The exact customer wording is a draft
 * until the owner approves it (decision 32).
 */

export const HAZARDS = ['crisis', 'gas', 'water'] as const;
export type Hazard = (typeof HAZARDS)[number];

/** Checked in this order: someone's own safety first. */
const PATTERNS: Record<Hazard, RegExp> = {
  // Indirect words matter as much as direct ones: "I don't know if I can keep going".
  crisis:
    /\b(suicid\w*|kill(ing)? myself|end(ing)? (my life|it all)|hurt(ing)? myself|self[- ]harm\w*|want to die|don'?t want to (live|be alive)|no reason to live|better off (dead|without me)|(don'?t know if i can|i can'?t|i cannot) (keep going|go on|take (it|this) anymore))\b/i,
  gas: /\b(smell(s|ing|ed)?( of| like)? (natural )?gas|gas (smell|leak)\w*|leaking gas)\b/i,
  water:
    /\b(flood(ing|ed|s)?|burst (pipe|water line)|pipe (burst|exploded)|water (is )?(everywhere|pouring|gushing|spraying))\b/i,
};

/** The hazard in a customer's words, or null. A match never depends on AI. */
export function detectHazard(text: string): Hazard | null {
  return HAZARDS.find((h) => PATTERNS[h].test(text)) ?? null;
}

/** Why the lead is in front of a person, as the Front Desk reads it. */
export const HAZARD_REASON: Record<Hazard, 'crisis_message_sent' | 'safety_message_sent'> = {
  crisis: 'crisis_message_sent',
  gas: 'safety_message_sent',
  water: 'safety_message_sent',
};

/** The template key recorded on the sent message (not an owner template; it cannot be edited). */
export const HAZARD_MESSAGE_KEY: Record<Hazard, 'crisis_message' | 'safety_message'> = {
  crisis: 'crisis_message',
  gas: 'safety_message',
  water: 'safety_message',
};

/** The fixed message to the customer. Draft wording, pending the owner's approval (decision 32). */
export function safetyMessage(hazard: Hazard, business: string): string {
  switch (hazard) {
    case 'crisis':
      return `If you are in danger or thinking about hurting yourself, call 911 now. ${business} will see your message as soon as someone is available.`;
    case 'gas':
      return `${business}: If you smell gas, leave the building now. Do not use light switches, phones or lighters inside. Once outside, call 911 and your gas company. We will call you as soon as we can.`;
    case 'water':
      return `${business}: Stay away from water near outlets or wiring. Shut off the main water valve only if it is safe to reach. If anyone is in danger, call 911. We will call you as soon as we can.`;
  }
}

const HAZARD_WORDS: Record<Hazard, string> = {
  crisis: 'sent a message that needs a person now',
  gas: 'reported a gas smell',
  water: 'reported flooding or a burst pipe',
};

/**
 * The alert to approvers. A crisis alert never repeats what was written (the business's own
 * people read it on the Front Desk); a hazard alert names the caller so they can be called back.
 */
export function emergencyAlert(
  what: Hazard | 'emergency',
  caller: { name: string; phone: string | null },
): string {
  if (what === 'crisis') {
    return 'Urgent: a new message needs a person now. The fixed crisis message went out. Open the Front Desk.';
  }
  const said = what === 'emergency' ? 'may be at risk' : HAZARD_WORDS[what];
  const sent = what === 'emergency' ? '' : ' The safety message went out.';
  const call = caller.phone ? ` Call them now at ${caller.phone}.` : ' Open the Front Desk.';
  return `Urgent: ${caller.name} ${said}.${sent}${call}`;
}
