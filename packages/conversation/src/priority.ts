import { OWNER_NEEDS, type Need } from './next-step.js';

/**
 * How urgently a lead needs a person, in three levels the portal shows as red, amber and green
 * (always with the words, never colour alone):
 *
 * - **now**: someone may be at risk, or a lead whose next move is the owner's has waited more
 *   than a day;
 * - **soon**: any other lead whose next move is the owner's;
 * - **on_track**: waiting on the customer, confirming, or booked.
 *
 * Worked out from the server's `next` and the time the lead entered its state; the clock comes
 * in as `now`, so the same lead turns red on its own once it has waited too long.
 */

export const OVERDUE_HOURS = 24;

export const PRIORITIES = ['now', 'soon', 'on_track'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface PriorityFacts {
  need: Need;
  urgent: boolean;
  /** When the lead entered its current state (ISO 8601). */
  waitingSince: string;
}

export interface PriorityResult {
  level: Priority;
  /** Why: someone at risk, waited too long, the owner's move, or the customer's. */
  reason: 'risk' | 'overdue' | 'yours' | 'theirs';
}

export function priorityOf(lead: PriorityFacts, now: Date = new Date()): PriorityResult {
  if (lead.urgent) return { level: 'now', reason: 'risk' };
  if (!OWNER_NEEDS.includes(lead.need)) return { level: 'on_track', reason: 'theirs' };
  const waitedHours = (now.getTime() - Date.parse(lead.waitingSince)) / 3_600_000;
  return waitedHours >= OVERDUE_HOURS
    ? { level: 'now', reason: 'overdue' }
    : { level: 'soon', reason: 'yours' };
}

/** The most urgent level among some leads, or null when there are none. */
export function topPriority(levels: readonly Priority[]): Priority | null {
  return PRIORITIES.find((p) => levels.includes(p)) ?? null;
}
