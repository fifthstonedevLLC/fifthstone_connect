import {
  planAction,
  type ActionError,
  type LeadSnapshot,
  type PortalAction,
} from '@fsc/conversation';
import type { DbClient } from '../db.js';

/**
 * Applies a portal action to a lead, decided in the portal or by an approver's text reply. Runs inside `withTenant`: the lead and its request are
 * locked, the plan from @fsc/conversation is applied, and the decision, its jobs and its audit
 * event commit together or not at all (CLAUDE.md rule 1).
 */

export type ApplyResult = { ok: true } | { ok: false; error: ActionError | 'not_found' };

export async function applyAction(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  leadId: string,
  action: PortalAction,
  /** How the person decided: in the portal, or by replying to an approval text. */
  via: 'portal' | 'text' = 'portal',
): Promise<ApplyResult> {
  const lead = await client.query<{ state: LeadSnapshot['state']; phone: string | null }>(
    `select l.state, c.phone
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
      where l.tenant_id = $1 and l.id = $2
      for update of l`,
    [tenantId, leadId],
  );
  const row = lead.rows[0];
  if (!row) return { ok: false, error: 'not_found' };

  const request = await client.query<{
    id: string;
    state: NonNullable<LeadSnapshot['request']>['state'];
    hold_state: 'active' | 'converted' | 'released' | null;
    hold_expires_at: Date | null;
  }>(
    `select r.id, r.state, h.state as hold_state, h.expires_at as hold_expires_at
       from app.requests r
       left join app.calendar_holds h on h.tenant_id = r.tenant_id and h.request_id = r.id
      where r.tenant_id = $1 and r.lead_id = $2
      order by r.created_at desc
      limit 1
      for update of r`,
    [tenantId, leadId],
  );
  const flags = await client.query<{ opted_out: boolean; nudged: boolean }>(
    `select
       exists (select 1 from app.opt_outs o
                where o.tenant_id = $1 and o.phone = $2 and o.opted_in_at is null) as opted_out,
       exists (select 1 from app.jobs j
                where j.tenant_id = $1 and j.idempotency_key = 'send_nudge:' || $3) as nudged`,
    [tenantId, row.phone, leadId],
  );

  const r = request.rows[0];
  const snapshot: LeadSnapshot = {
    leadId,
    state: row.state,
    request: r
      ? {
          id: r.id,
          state: r.state,
          hold:
            r.hold_state && r.hold_expires_at
              ? { state: r.hold_state, expiresAt: r.hold_expires_at }
              : null,
        }
      : null,
    optedOut: flags.rows[0]?.opted_out ?? false,
    nudged: flags.rows[0]?.nudged ?? false,
    now: new Date(),
  };

  const result = planAction(action, snapshot);
  if (!result.ok) return result;
  const { plan } = result;

  if (plan.request) {
    await client.query(
      `update app.requests
          set state = $3, decided_by = $4, decided_via = $5, decided_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, plan.request.id, plan.request.state, portalUserId, via],
    );
  }
  if (plan.lead) {
    await client.query(
      `update app.leads
          set state = $3, state_reason = $4, state_changed_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, leadId, plan.lead.state, plan.lead.reason],
    );
  }
  for (const job of plan.jobs) {
    await client.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, $3, $4)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, leadId, job.actionType, job.idempotencyKey],
    );
  }
  if (plan.skip.length > 0) {
    await client.query(
      `update app.jobs
          set status = 'skipped', last_error = $4
        where tenant_id = $1 and lead_id = $2 and action_type = any($3)
          and status in ('queued', 'failed')`,
      [tenantId, leadId, plan.skip, `superseded_by_${action}`],
    );
  }
  await client.query(
    `insert into app.audit_events
       (tenant_id, actor_type, actor_portal_user_id, action, subject_type, subject_id, detail)
     values ($1, 'portal_user', $2, $3, $4, $5, $6)`,
    [
      tenantId,
      portalUserId,
      plan.audit.action,
      plan.audit.subjectType,
      plan.audit.subjectId,
      JSON.stringify({ via, jobs: plan.jobs.map((j) => j.actionType) }),
    ],
  );
  return { ok: true };
}
