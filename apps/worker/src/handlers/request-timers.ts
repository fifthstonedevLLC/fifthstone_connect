import type { CalendarProvider } from '@fsc/connectors';
import { approverAnswer, formatSlot } from '@fsc/conversation';
import type { LeadState } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { phoneLabel, queueApproverText } from './approver-texts.js';
import { mirrorHoldIntoMock } from './holds.js';

/**
 * What happens when nobody approves a customer's pick (SCOPE.md v0.2, step 4): the approvers are
 * reminded once after the business's approval window (`approval_reminder`), and when the hold
 * runs out (decision 19) the time is released and a person takes the lead over (`expire_hold`).
 * Both are queued when the pick becomes a request, and both do nothing once someone has decided.
 * Approvers are texted only for playbooks that approve by text; the Front Desk shows the rest.
 */

interface RequestFacts {
  request_id: string;
  request_state: string;
  lead_id: string;
  lead_state: LeadState;
  slot_start: Date;
  slot_end: Date;
  hold_id: string | null;
  hold_state: 'active' | 'converted' | 'released' | null;
  hold_expires_at: Date | null;
  calendar_id: string | null;
  provider_hold_ref: string | null;
  name: string | null;
  phone: string | null;
  timezone: string;
  channel: 'text' | 'portal';
  approvers: string[];
}

async function requestFacts(
  client: DbClient,
  tenantId: string,
  where: { requestId: string } | { pendingForLead: string },
): Promise<RequestFacts | null> {
  const byRequest = 'requestId' in where;
  const { rows } = await client.query<Omit<RequestFacts, 'approvers'>>(
    `select r.id as request_id, r.state as request_state, r.lead_id, l.state as lead_state,
            r.slot_start, r.slot_end, h.id as hold_id, h.state as hold_state,
            h.expires_at as hold_expires_at, h.calendar_id, h.provider_hold_ref,
            c.display_name as name, c.phone, t.timezone, p.default_approver_channel as channel
       from app.requests r
       join app.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       join app.tenants t on t.id = r.tenant_id
       join app.tenant_config cfg on cfg.tenant_id = r.tenant_id
       join app.playbooks p on p.key = cfg.playbook_key
       left join app.calendar_holds h on h.tenant_id = r.tenant_id and h.request_id = r.id
      where r.tenant_id = $1
        and ${byRequest ? 'r.id = $2' : `r.lead_id = $2 and r.state = 'pending'`}
      order by r.created_at desc
      limit 1`,
    [tenantId, byRequest ? where.requestId : where.pendingForLead],
  );
  const row = rows[0];
  if (!row) return null;
  const approvers = await client.query<{ id: string }>(
    `select id from app.portal_users
      where tenant_id = $1 and approves_requests and mobile is not null and disabled_at is null`,
    [tenantId],
  );
  return { ...row, approvers: row.channel === 'text' ? approvers.rows.map((a) => a.id) : [] };
}

const nameOf = (f: RequestFacts) => f.name ?? (f.phone ? phoneLabel(f.phone) : 'A customer');

/** `approval_reminder:<request id>`: one reminder to the approvers while the request waits. */
export const approvalReminder: JobHandler = async (job, ctx) => {
  if (!job.leadId) return { outcome: { kind: 'skipped', reason: 'no_lead' } };
  const now = ctx.now();
  const facts = await withTenant(ctx.pool, job.tenantId, (client) =>
    requestFacts(client, job.tenantId, { pendingForLead: job.leadId! }),
  );
  if (!facts) return { outcome: { kind: 'skipped', reason: 'already_decided' } };
  if (facts.hold_state !== 'active' || !facts.hold_expires_at || facts.hold_expires_at <= now) {
    return { outcome: { kind: 'skipped', reason: 'hold_lapsed' } };
  }
  if (facts.channel !== 'text') return { outcome: { kind: 'skipped', reason: 'portal_approvals' } };
  if (facts.approvers.length === 0) return { outcome: { kind: 'skipped', reason: 'no_approver' } };

  const body = approverAnswer({
    kind: 'reminder',
    name: nameOf(facts),
    slot: formatSlot(facts.slot_start, facts.timezone),
  });
  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      // Sent as an approval request, so a bare "1" in reply answers this request.
      for (const approver of facts.approvers) {
        await queueApproverText(
          client,
          job.tenantId,
          approver,
          facts.request_id,
          'approval_request',
          body,
        );
      }
    },
  };
};

/** `expire_hold:<request id>`, due when the hold runs out. */
export const expireHold: JobHandler = async (job, ctx) => {
  const requestId = keyId(job.idempotencyKey);
  if (!requestId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };
  const now = ctx.now();
  const facts = await withTenant(ctx.pool, job.tenantId, (client) =>
    requestFacts(client, job.tenantId, { requestId }),
  );
  if (!facts) return { outcome: { kind: 'skipped', reason: 'request_not_found' } };
  if (facts.request_state !== 'pending') {
    return { outcome: { kind: 'skipped', reason: 'already_decided' } };
  }
  if (
    facts.hold_state !== 'active' ||
    !facts.hold_id ||
    !facts.calendar_id ||
    !facts.provider_hold_ref
  ) {
    return { outcome: { kind: 'skipped', reason: 'no_active_hold' } };
  }
  if (facts.hold_expires_at && facts.hold_expires_at > now) {
    return { outcome: { kind: 'skipped', reason: 'not_due' } };
  }

  const calendar: CalendarProvider = ctx.connectors.calendar;
  mirrorHoldIntoMock(calendar, job.tenantId, {
    hold_id: facts.hold_id,
    hold_state: 'active',
    calendar_id: facts.calendar_id,
    provider_hold_ref: facts.provider_hold_ref,
    slot_start: facts.slot_start,
    slot_end: facts.slot_end,
  });
  const released = await calendar.releaseHold({
    tenantId: job.tenantId,
    calendarId: facts.calendar_id,
    holdRef: facts.provider_hold_ref,
  });
  if (!released.ok) return { outcome: { kind: 'failed', error: released.error } };

  const lapsed = approverAnswer({
    kind: 'lapsed',
    name: nameOf(facts),
    slot: formatSlot(facts.slot_start, facts.timezone),
  });
  return {
    outcome: { kind: 'succeeded', externalRef: facts.provider_hold_ref },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await client.query(
        `update app.calendar_holds set state = 'released'
          where tenant_id = $1 and id = $2 and state = 'active'`,
        [job.tenantId, facts.hold_id],
      );
      const expired = await client.query(
        `update app.requests set state = 'expired'
          where tenant_id = $1 and id = $2 and state = 'pending'`,
        [job.tenantId, requestId],
      );
      if (!expired.rowCount) return;
      await client.query(
        `update app.leads set state = 'needs_attention', state_reason = 'hold_expired',
                state_changed_at = now()
          where tenant_id = $1 and id = $2 and state = 'requested'`,
        [job.tenantId, facts.lead_id],
      );
      await client.query(
        `update app.jobs set status = 'skipped', last_error = 'superseded_by_expiry'
          where tenant_id = $1 and lead_id = $2 and action_type = 'approval_reminder'
            and status in ('queued', 'failed')`,
        [job.tenantId, facts.lead_id],
      );
      await client.query(
        `insert into app.audit_events (tenant_id, actor_type, action, subject_type, subject_id)
         values ($1, 'system', 'request.expired', 'request', $2)`,
        [job.tenantId, requestId],
      );
      for (const approver of facts.approvers) {
        await queueApproverText(client, job.tenantId, approver, requestId, 'answer', lapsed);
      }
    },
  };
};
