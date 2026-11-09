import { nextStep, urgentFirst, type Need, type NextAction } from '@fsc/conversation';
import { LANE_STATES, type LeadState, type Urgency } from '@fsc/core';
import type { DbClient } from '../db.js';

/** The Today dashboard: one tenant's leads, grouped into the four portal lanes. */

export interface LeadCard {
  id: string;
  name: string | null;
  phone: string | null;
  summary: string | null;
  state: LeadState;
  reason: string | null;
  urgency: Urgency | null;
  createdAt: string;
  /** Slot of the open or approved request, if any (ISO 8601). */
  slotStart: string | null;
  /** State of the open, approved or changed request, if any. */
  requestState: 'pending' | 'approved' | 'changed' | null;
  /** An emergency, safety or crisis lead: shown first and flagged. */
  urgent: boolean;
  /** When the lead entered its current state: how long it has been waiting (ISO 8601). */
  waitingSince: string;
  /** What it needs from a person, and the one action that fits (`nextStep`). */
  next: { need: Need; action: NextAction | null };
}

export type Lanes = Record<keyof typeof LANE_STATES, LeadCard[]>;

interface Row {
  id: string;
  display_name: string | null;
  phone: string | null;
  summary: string | null;
  state: LeadState;
  state_reason: string | null;
  urgency: Urgency | null;
  created_at: Date;
  slot_start: Date | null;
  request_state: 'pending' | 'approved' | 'changed' | null;
  state_changed_at: Date;
  nudged: boolean;
  has_voicemail: boolean;
}

/**
 * Runs inside `withTenant`. The explicit tenant filter repeats what row-level security already
 * enforces, so the query is correct even read on its own (CLAUDE.md rule 3).
 */
export async function getToday(client: DbClient, tenantId: string): Promise<Lanes> {
  const laneStates = Object.values(LANE_STATES).flat();
  const { rows } = await client.query<Row>(
    `select l.id, c.display_name, c.phone, l.summary, l.state, l.state_reason, l.urgency,
            l.created_at, l.state_changed_at, r.slot_start, r.state as request_state,
            exists (select 1 from app.jobs j
                     where j.tenant_id = l.tenant_id and j.lead_id = l.id
                       and j.action_type = 'send_nudge' and j.status <> 'skipped') as nudged,
            exists (select 1 from app.voicemails v
                      join app.calls k on k.tenant_id = v.tenant_id and k.id = v.call_id
                     where v.tenant_id = l.tenant_id and k.lead_id = l.id) as has_voicemail
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       left join lateral (
         select slot_start, state from app.requests r
          where r.tenant_id = l.tenant_id and r.lead_id = l.id
            and r.state in ('pending', 'approved', 'changed')
          order by r.created_at desc
          limit 1
       ) r on true
      where l.tenant_id = $1 and l.state = any($2)
      order by l.state_changed_at desc`,
    [tenantId, laneStates],
  );

  const lanes: Lanes = { needsYou: [], waitingOnCustomer: [], booked: [], wentQuiet: [] };
  for (const row of rows) {
    // A request already decided in the portal no longer needs the owner: an approval waits on the
    // calendar (shown as confirming, with the booked), a change waits on the customer's new pick.
    const decided =
      row.state === 'requested' && row.request_state === 'approved'
        ? 'booked'
        : row.state === 'requested' && row.request_state === 'changed'
          ? 'waitingOnCustomer'
          : null;
    const lane =
      decided ??
      (Object.keys(LANE_STATES) as (keyof Lanes)[]).find((k) =>
        (LANE_STATES[k] as readonly LeadState[]).includes(row.state),
      );
    if (!lane) continue;
    const step = nextStep({
      state: row.state,
      reason: row.state_reason,
      urgency: row.urgency,
      requestState: row.request_state,
      hasPhone: row.phone !== null,
      hasVoicemail: row.has_voicemail,
      nudged: row.nudged,
    });
    lanes[lane].push({
      id: row.id,
      name: row.display_name,
      phone: row.phone,
      summary: row.summary,
      state: row.state,
      reason: row.state_reason,
      urgency: row.urgency,
      createdAt: row.created_at.toISOString(),
      slotStart: row.slot_start?.toISOString() ?? null,
      requestState: row.request_state,
      urgent: step.urgent,
      waitingSince: row.state_changed_at.toISOString(),
      next: { need: step.need, action: step.action },
    });
  }
  // Someone may be at risk: these come first however long ago they came in.
  lanes.needsYou = urgentFirst(lanes.needsYou);
  return lanes;
}
