import { OWNER_NEEDS, type Need } from './next-step.js';

/**
 * How urgently a lead needs a person, in three levels the portal shows as red, amber and green
 * (always with the words, never colour alone):
 *
 * - **now** ("Act now"): someone may be at risk; a requested time's hold runs out within a few
 *   hours; a customer wants to move or cancel an appointment in the next two days; or a lead whose
 *   next move is the owner's has waited longer than this business allows (decision 37);
 * - **soon**: any other lead whose next move is the owner's;
 * - **on_track**: waiting on the customer, confirming, or booked.
 *
 * Worked out from the server's facts and the time the lead entered its state; the clock comes in
 * as `now`, so the same lead turns red on its own once it gets close to too late.
 */

/** The limit when a business has none of its own (the default before decision 37). */
export const OVERDUE_HOURS = 24;
/** A requested time turns red this long before its hold is released. */
export const HOLD_WARNING_HOURS = 4;
/** A move or cancel turns red when the appointment is this close: the slot needs filling. */
export const APPOINTMENT_SOON_HOURS = 48;

export const PRIORITIES = ['now', 'soon', 'on_track'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface PriorityFacts {
  need: Need;
  urgent: boolean;
  /** When the lead entered its current state (ISO 8601). */
  waitingSince: string;
  /** When the held time is released if nobody decides (ISO 8601), for a request to approve. */
  holdExpiresAt?: string | null;
  /** The booked or requested appointment (ISO 8601), for a move or cancel. */
  appointmentAt?: string | null;
  /** How long this business lets a lead wait on it before it is late; `OVERDUE_HOURS` if unset. */
  overdueHours?: number;
}

export interface PriorityResult {
  level: Priority;
  /**
   * Why: someone at risk, a hold about to run out, an appointment coming up, waited too long, the
   * owner's move, or the customer's.
   */
  reason: 'risk' | 'hold_expiring' | 'appointment_soon' | 'overdue' | 'yours' | 'theirs';
}

const hoursUntil = (iso: string, now: Date) => (Date.parse(iso) - now.getTime()) / 3_600_000;

export function priorityOf(lead: PriorityFacts, now: Date = new Date()): PriorityResult {
  if (lead.urgent) return { level: 'now', reason: 'risk' };
  if (!OWNER_NEEDS.includes(lead.need)) return { level: 'on_track', reason: 'theirs' };
  if (
    lead.need === 'approve' &&
    lead.holdExpiresAt &&
    hoursUntil(lead.holdExpiresAt, now) <= HOLD_WARNING_HOURS
  ) {
    return { level: 'now', reason: 'hold_expiring' };
  }
  if (
    (lead.need === 'reschedule' || lead.need === 'cancel') &&
    lead.appointmentAt &&
    hoursUntil(lead.appointmentAt, now) <= APPOINTMENT_SOON_HOURS
  ) {
    return { level: 'now', reason: 'appointment_soon' };
  }
  const waitedHours = -hoursUntil(lead.waitingSince, now);
  return waitedHours >= (lead.overdueHours ?? OVERDUE_HOURS)
    ? { level: 'now', reason: 'overdue' }
    : { level: 'soon', reason: 'yours' };
}

/** The most urgent level among some leads, or null when there are none. */
export function topPriority(levels: readonly Priority[]): Priority | null {
  return PRIORITIES.find((p) => levels.includes(p)) ?? null;
}
