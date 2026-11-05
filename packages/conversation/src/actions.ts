import type { HoldState, LeadState, RequestState } from '@fsc/core';

/**
 * What a person can do to a lead from the portal (or, later, by text), and what each action
 * changes. Pure: the caller loads a snapshot inside a locked transaction, asks for a plan, and
 * applies it in that same transaction, so the decision, its jobs and its audit event commit
 * together (CLAUDE.md rule 1). Third-party work (calendar, texts) only ever happens in jobs.
 *
 * Owners and staff can take every action (decision 25). State the customer sees changes only
 * when a job actually completes: approving does not make a lead `booked`; the calendar event
 * does (decision 24).
 */

export const PORTAL_ACTIONS = ['approve', 'suggest_time', 'nudge', 'close'] as const;
export type PortalAction = (typeof PORTAL_ACTIONS)[number];

export interface LeadSnapshot {
  leadId: string;
  state: LeadState;
  /** The lead's most recent request, if any. */
  request: {
    id: string;
    state: RequestState;
    hold: { state: HoldState; expiresAt: Date } | null;
  } | null;
  /** The contact has replied STOP to this business and not opted back in. */
  optedOut: boolean;
  /** A nudge has already been queued for this lead (one nudge per lead). */
  nudged: boolean;
  now: Date;
}

export type ActionError =
  | 'no_pending_request'
  | 'hold_expired'
  | 'not_quiet'
  | 'already_nudged'
  | 'opted_out'
  | 'already_closed'
  | 'booked';

export interface ActionPlan {
  /** A decision on the lead's request; who, how and when are added by the caller. */
  request?: { id: string; state: 'approved' | 'changed' | 'declined' };
  lead?: { state: LeadState; reason: string };
  /** Jobs to queue. Keys are unique per tenant, so a repeated action never queues twice. */
  jobs: { actionType: string; idempotencyKey: string }[];
  /** Queued jobs of these types for this lead no longer apply and are marked skipped. */
  skip: string[];
  audit: { action: string; subjectType: 'request' | 'lead'; subjectId: string };
}

export type PlanResult = { ok: true; plan: ActionPlan } | { ok: false; error: ActionError };

const CLOSED: readonly LeadState[] = ['closed', 'spam', 'opted_out'];

function pendingRequest(snapshot: LeadSnapshot) {
  const { request } = snapshot;
  return snapshot.state === 'requested' && request?.state === 'pending' ? request : null;
}

export function planAction(action: PortalAction, snapshot: LeadSnapshot): PlanResult {
  switch (action) {
    case 'approve': {
      const request = pendingRequest(snapshot);
      if (!request) return { ok: false, error: 'no_pending_request' };
      if (request.hold?.state !== 'active' || request.hold.expiresAt <= snapshot.now) {
        return { ok: false, error: 'hold_expired' };
      }
      return {
        ok: true,
        plan: {
          request: { id: request.id, state: 'approved' },
          // The calendar event is created by the worker; only then is the lead booked and the
          // customer's confirmation sent.
          jobs: [
            {
              actionType: 'confirm_calendar_event',
              idempotencyKey: `confirm_calendar_event:${request.id}`,
            },
          ],
          skip: ['approval_reminder'],
          audit: { action: 'request.approved', subjectType: 'request', subjectId: request.id },
        },
      };
    }

    case 'suggest_time': {
      const request = pendingRequest(snapshot);
      if (!request) return { ok: false, error: 'no_pending_request' };
      if (snapshot.optedOut) return { ok: false, error: 'opted_out' };
      return {
        ok: true,
        plan: {
          request: { id: request.id, state: 'changed' },
          jobs: [
            ...(request.hold?.state === 'active'
              ? [{ actionType: 'release_hold', idempotencyKey: `release_hold:${request.id}` }]
              : []),
            { actionType: 'send_slot_offer', idempotencyKey: `send_slot_offer:${request.id}` },
          ],
          skip: ['approval_reminder'],
          audit: { action: 'request.changed', subjectType: 'request', subjectId: request.id },
        },
      };
    }

    case 'nudge': {
      if (snapshot.state !== 'quiet') return { ok: false, error: 'not_quiet' };
      if (snapshot.optedOut) return { ok: false, error: 'opted_out' };
      if (snapshot.nudged) return { ok: false, error: 'already_nudged' };
      return {
        ok: true,
        plan: {
          jobs: [{ actionType: 'send_nudge', idempotencyKey: `send_nudge:${snapshot.leadId}` }],
          skip: [],
          audit: { action: 'lead.nudged', subjectType: 'lead', subjectId: snapshot.leadId },
        },
      };
    }

    case 'close': {
      if (CLOSED.includes(snapshot.state)) return { ok: false, error: 'already_closed' };
      // A booked job is on the calendar; closing the lead would not remove it, and only a person
      // moves an existing customer (CLAUDE.md rule 14).
      if (snapshot.state === 'booked') return { ok: false, error: 'booked' };
      const request = pendingRequest(snapshot);
      return {
        ok: true,
        plan: {
          ...(request ? { request: { id: request.id, state: 'declined' as const } } : {}),
          lead: { state: 'closed', reason: 'closed_in_portal' },
          jobs:
            request?.hold?.state === 'active'
              ? [{ actionType: 'release_hold', idempotencyKey: `release_hold:${request.id}` }]
              : [],
          skip: ['approval_reminder', 'send_nudge', 'send_slot_offer', 'send_clarifying_question'],
          audit: { action: 'lead.closed', subjectType: 'lead', subjectId: snapshot.leadId },
        },
      };
    }
  }
}
