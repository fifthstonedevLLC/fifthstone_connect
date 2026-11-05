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
}

/**
 * Runs inside `withTenant`. The explicit tenant filter repeats what row-level security already
 * enforces, so the query is correct even read on its own (CLAUDE.md rule 3).
 */
export async function getToday(client: DbClient, tenantId: string): Promise<Lanes> {
  const laneStates = Object.values(LANE_STATES).flat();
  const { rows } = await client.query<Row>(
    `select l.id, c.display_name, c.phone, l.summary, l.state, l.state_reason, l.urgency,
            l.created_at, r.slot_start
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       left join lateral (
         select slot_start from app.requests r
          where r.tenant_id = l.tenant_id and r.lead_id = l.id
            and r.state in ('pending', 'approved')
          order by r.created_at desc
          limit 1
       ) r on true
      where l.tenant_id = $1 and l.state = any($2)
      order by l.state_changed_at desc`,
    [tenantId, laneStates],
  );

  const lanes: Lanes = { needsYou: [], waitingOnCustomer: [], booked: [], wentQuiet: [] };
  for (const row of rows) {
    const lane = (Object.keys(LANE_STATES) as (keyof Lanes)[]).find((k) =>
      (LANE_STATES[k] as readonly LeadState[]).includes(row.state),
    );
    if (!lane) continue;
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
    });
  }
  return lanes;
}
