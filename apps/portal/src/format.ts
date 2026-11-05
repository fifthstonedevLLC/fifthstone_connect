import type { LeadCard, LeadState, ServiceState, Urgency } from './types';

/**
 * Turns lead data into the plain words the dashboard shows. Every line describes what the server
 * reported; nothing here guesses at a state the data does not hold (decision 24).
 */

const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: 'emergency',
  this_week: 'this week',
  flexible: 'flexible',
};

const REASON_LABEL: Record<string, string> = {
  emergency: 'Emergency',
  safety_message_sent: 'Safety message sent',
  unsure: "We couldn't tell what they need",
  price_question: 'Asked about price',
  hold_expired: 'Hold expired before approval',
  delivery_failed: 'Text-back undelivered',
  complaint: 'Upset; needs a person',
};

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** "9:42 AM" today, "Yesterday", or "Mon, Nov 2", in the business's time zone. */
export function whenLabel(iso: string, timeZone: string, now = new Date()): string {
  const date = new Date(iso);
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
  const day = dayKey(date, timeZone);
  if (day === today) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  if (day === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** "Thu 2:00 PM" for a slot, in the business's time zone. */
export function slotLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function isEmergency(card: LeadCard): boolean {
  return card.urgency === 'emergency' && card.state === 'needs_attention';
}

/** The one-line status under each card. */
export function statusLine(card: LeadCard, timeZone: string): string {
  const urgency = card.urgency ? ` · ${URGENCY_LABEL[card.urgency]}` : '';
  const slot = card.slotStart ? slotLabel(card.slotStart, timeZone) : null;
  const byState: Partial<Record<LeadState, string>> = {
    needs_attention: (card.reason && REASON_LABEL[card.reason]) ?? 'Needs a person',
    requested: slot
      ? `Picked ${slot}${urgency} · waiting for your OK`
      : `Waiting for your OK${urgency}`,
    offered: `Times sent, no pick yet${urgency}`,
    clarifying: `Waiting for their details${urgency}`,
    new: 'Just came in',
    booked: slot ? `On your calendar · ${slot}` : 'Booked',
    quiet: 'No reply for a day or more',
  };
  return byState[card.state] ?? card.state;
}

/** "+13195550142" as "(319) 555-0142"; other numbers are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** The person's name, or their number when no name is known yet. */
export function displayName(card: LeadCard): string {
  return card.name ?? (card.phone ? formatPhone(card.phone) : 'Unknown caller');
}

const SERVICE_LABEL: Record<ServiceState, string> = {
  not_started: 'Not started',
  submitted: 'Pending approval',
  approved: 'Live',
  rejected: 'Needs attention',
  disabled: 'Off',
};

export function serviceLabel(state: ServiceState): string {
  return SERVICE_LABEL[state];
}

/** The sentence under "Today": who needs the owner, by name, in plain words. */
export function summarySentence(needsYou: LeadCard[]): string {
  if (needsYou.length === 0) return 'Nothing needs you right now.';
  const names = needsYou.map(displayName);
  if (names.length === 1) return `${names[0]} needs you.`;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} need you.`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others need you.`;
}
