import {
  detectHazard,
  emergencyAlert,
  HAZARD_MESSAGE_KEY,
  HAZARD_REASON,
  safetyMessage,
  type Hazard,
} from '@fsc/conversation';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { phoneLabel } from './approver-texts.js';
import { queueFixedText } from './texts.js';

/**
 * Emergencies skip the queue (SCOPE.md v0.2, Guardrails). Two jobs:
 *
 * - `send_safety_message:<message or voicemail id>`: the customer's own words show a hazard (a
 *   fixed phrase list, never AI). The fixed safety or crisis message goes out first, and every
 *   approver is alerted at once, whatever the business's approval channel.
 * - `emergency_alert:<lead id>`: the clarify step found someone may be at risk without one of
 *   those phrases. The approvers are alerted; no fixed message is sent.
 *
 * Alerts are texts to the business's own people, recorded in `app.approver_texts` as kind
 * `alert`; a crisis alert never repeats what the customer wrote. Opt-out still applies to the
 * customer's message (CLAUDE.md rule 12).
 */

interface Caller {
  lead_id: string;
  name: string | null;
  phone: string | null;
  business: string;
  approvers: string[];
}

async function caller(client: DbClient, tenantId: string, leadId: string): Promise<Caller | null> {
  const { rows } = await client.query<Omit<Caller, 'approvers'>>(
    `select l.id as lead_id, c.display_name as name, c.phone, t.name as business
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       join app.tenants t on t.id = l.tenant_id
      where l.tenant_id = $1 and l.id = $2`,
    [tenantId, leadId],
  );
  const row = rows[0];
  if (!row) return null;
  const approvers = await client.query<{ id: string }>(
    `select id from app.portal_users
      where tenant_id = $1 and approves_requests and mobile is not null and disabled_at is null`,
    [tenantId],
  );
  return { ...row, approvers: approvers.rows.map((a) => a.id) };
}

async function alertApprovers(
  client: DbClient,
  tenantId: string,
  who: Caller,
  what: Hazard | 'emergency',
): Promise<void> {
  const body = emergencyAlert(what, {
    name: who.name ?? (who.phone ? phoneLabel(who.phone) : 'A customer'),
    phone: who.phone ? phoneLabel(who.phone) : null,
  });
  for (const approver of who.approvers) {
    const { rows } = await client.query<{ id: string }>(
      `insert into app.approver_texts (tenant_id, portal_user_id, direction, kind, body, status)
       values ($1, $2, 'out', 'alert', $3, 'queued') returning id`,
      [tenantId, approver, body],
    );
    await client.query(
      `insert into app.jobs (tenant_id, action_type, idempotency_key)
       values ($1, 'send_approver_text', $2)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, `send_approver_text:${rows[0]!.id}`],
    );
  }
}

export const sendSafetyMessage: JobHandler = async (job, ctx) => {
  const sourceId = keyId(job.idempotencyKey);
  if (!sourceId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    // The customer's words: an inbound text, or a voicemail's transcript.
    const { rows } = await client.query<{ lead_id: string; words: string | null }>(
      `select cv.lead_id, m.body as words from app.messages m
         join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
        where m.tenant_id = $1 and m.id = $2 and m.direction = 'in'
       union all
       select c.lead_id, v.transcript from app.voicemails v
         join app.calls c on c.tenant_id = v.tenant_id and c.id = v.call_id
        where v.tenant_id = $1 and v.id = $2`,
      [job.tenantId, sourceId],
    );
    const source = rows[0];
    if (!source) return null;
    const who = await caller(client, job.tenantId, source.lead_id);
    return who ? { ...who, words: source.words ?? '' } : null;
  });
  if (!facts) return { outcome: { kind: 'skipped', reason: 'source_not_found' } };
  const hazard = detectHazard(facts.words);
  if (!hazard) return { outcome: { kind: 'skipped', reason: 'no_hazard' } };

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await client.query(
        `update app.leads set state = 'needs_attention', state_reason = $3, urgency = 'emergency',
                state_changed_at = now()
          where tenant_id = $1 and id = $2 and state not in ('closed', 'spam', 'opted_out')
            and (state <> 'needs_attention' or state_reason is distinct from $3)`,
        [job.tenantId, facts.lead_id, HAZARD_REASON[hazard]],
      );
      await queueFixedText(
        client,
        job.tenantId,
        facts.lead_id,
        HAZARD_MESSAGE_KEY[hazard],
        safetyMessage(hazard, facts.business),
      );
      await alertApprovers(client, job.tenantId, facts, hazard);
    },
  };
};

export const emergencyAlertJob: JobHandler = async (job, ctx) => {
  const leadId = keyId(job.idempotencyKey) ?? job.leadId;
  if (!leadId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };
  const facts = await withTenant(ctx.pool, job.tenantId, (client) =>
    caller(client, job.tenantId, leadId),
  );
  if (!facts) return { outcome: { kind: 'skipped', reason: 'lead_not_found' } };
  if (facts.approvers.length === 0) return { outcome: { kind: 'skipped', reason: 'no_approver' } };
  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status === 'succeeded') {
        await alertApprovers(client, job.tenantId, facts, 'emergency');
      }
    },
  };
};
