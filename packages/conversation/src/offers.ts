import type { LeadState, Urgency } from '@fsc/core';
import { formatSlot } from './templates.js';

/**
 * The offer step (SCOPE.md v0.2, step 3): which open times a customer is offered, how they read
 * in the text, and how a numbered reply is understood. Times come only from the business's hours
 * and calendar through `@fsc/scheduling`; the wording comes only from the owner's `slot_offer`
 * template (CLAUDE.md rule 10). The customer's pick becomes a request with a hold, never a booking.
 */

/** Two or three times are offered (SCOPE.md); three when there are three. */
export const OFFER_SIZE = 3;

/** Nothing sooner than this is offered, so there is time to approve and get there. */
export const OFFER_LEAD_MINUTES = 120;

/** A hold lapses this long before its slot at the latest (decision 19). */
export const HOLD_BEFORE_SLOT_MINUTES = 120;

export interface OfferSlot {
  start: Date;
  end: Date;
  /** The business's local day, so offers can spread across days. */
  date: string;
}

/**
 * How far ahead to look. An emergency is never offered times: a person calls (SCOPE.md,
 * "Emergencies skip the queue"), so there is no horizon.
 */
export function offerHorizonDays(urgency: Urgency | null): number | null {
  if (urgency === 'emergency') return null;
  return urgency === 'this_week' ? 7 : 14;
}

/** Leads that can be sent times: not closed or booked, and not already holding a request. */
export function canOffer(state: LeadState, hasPendingRequest: boolean): boolean {
  if (hasPendingRequest) return false;
  return !['booked', 'closed', 'spam', 'opted_out'].includes(state);
}

/**
 * The times to offer: the earliest open time on each of the first days that have one, so the
 * customer has a real choice of day; then the next earliest times if there are fewer days.
 */
export function chooseOffer(slots: readonly OfferSlot[], size = OFFER_SIZE): OfferSlot[] {
  const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const chosen: OfferSlot[] = [];
  const days = new Set<string>();
  for (const slot of sorted) {
    if (chosen.length === size) break;
    if (days.has(slot.date)) continue;
    days.add(slot.date);
    chosen.push(slot);
  }
  for (const slot of sorted) {
    if (chosen.length === size) break;
    if (!chosen.includes(slot)) chosen.push(slot);
  }
  return chosen.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** `{slots}` in the template: "1) Tue, Nov 10 at 9:00 AM 2) Wed, Nov 11 at 7:00 AM". */
export function slotList(choices: readonly { start: Date }[], timeZone: string): string {
  return choices.map((c, i) => `${i + 1}) ${formatSlot(c.start, timeZone)}`).join(' ');
}

/**
 * The number a customer picked, or null when the reply is not just a number from the offer.
 * Accepts "2", " 2 ", "2.", "#2", "option 2". Anything else (a question, "2 or 3", "Saturday?")
 * is for a person, never guessed.
 */
export function parseChoice(body: string, count: number): number | null {
  const match = /^\s*(?:#|option\s*|number\s*|no\.?\s*)?([1-9])\s*[.)!]?\s*$/i.exec(body);
  if (!match) return null;
  const choice = Number(match[1]);
  return choice >= 1 && choice <= count ? choice : null;
}

/**
 * When a hold placed now is released if nobody approves it: after the business's hold time, or
 * two hours before the slot, whichever is sooner (decision 19), and never in the past.
 */
export function holdExpiry(now: Date, slotStart: Date, holdMinutes: number): Date {
  const byHoldTime = now.getTime() + holdMinutes * 60_000;
  const beforeSlot = slotStart.getTime() - HOLD_BEFORE_SLOT_MINUTES * 60_000;
  return new Date(Math.max(Math.min(byHoldTime, beforeSlot), now.getTime() + 15 * 60_000));
}
