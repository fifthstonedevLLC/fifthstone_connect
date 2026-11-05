import type { ConnectorIdentity, ConnectorResult, TimeRange } from './result.js';

/**
 * Calendar access (Google Calendar, Acuity). The calendar is the source of truth for time:
 * slots are computed from `busy`, a customer's pick becomes a tentative hold, and approval turns
 * the hold into an event (ADR-0002 decision 7). Holds count as busy, so a held slot is never
 * offered twice.
 */

export interface CalendarRef {
  tenantId: string;
  /** Provider calendar ID (Google calendar ID, Acuity calendar ID). */
  calendarId: string;
}

export interface PlaceHoldInput extends CalendarRef {
  slot: TimeRange;
  /** Shown on the owner's calendar, e.g. "HOLD: AC tune-up (awaiting approval)". */
  title: string;
  idempotencyKey: string;
}

export interface ConfirmHoldInput extends CalendarRef {
  holdRef: string;
  title: string;
  /** Customer, address, job summary and a link to the lead page. */
  description: string;
  idempotencyKey: string;
}

export interface CalendarProvider extends ConnectorIdentity {
  /** Busy intervals (events and holds) that overlap the range. */
  busy(input: CalendarRef & { range: TimeRange }): Promise<ConnectorResult<TimeRange[]>>;
  /** Fails with `slot_unavailable` if the slot is no longer free. */
  placeHold(input: PlaceHoldInput): Promise<ConnectorResult<{ holdRef: string }>>;
  /** Fails with `hold_not_found` if the hold was released or expired. */
  confirmHold(input: ConfirmHoldInput): Promise<ConnectorResult<{ eventRef: string }>>;
  /** Releasing an already released hold succeeds. */
  releaseHold(input: CalendarRef & { holdRef: string }): Promise<ConnectorResult<void>>;
}
