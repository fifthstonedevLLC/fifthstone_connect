import { formatSlot, renderTemplate, withoutUnfilled } from '@fsc/conversation';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';

/**
 * Texts to the business's approvers (SCOPE.md v0.2, step 4). They are the business's own people,
 * so customer opt-outs do not apply, but nothing goes out while texting is not live. Each text is
 * recorded in `app.approver_texts` and sent by its own job, so a retry never sends twice.
 */

/** "(319) 555-0142" for a US number; anything else as it is. */
export function phoneLabel(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Records an outbound approver text as queued and queues its `send_approver_text` job. */
export async function queueApproverText(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  requestId: string | null,
  kind: 'approval_request' | 'answer',
  body: string,
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `insert into app.approver_texts
       (tenant_id, portal_user_id, request_id, direction, kind, body, status)
     values ($1, $2, $3, 'out', $4, $5, 'queued') returning id`,
    [tenantId, portalUserId, requestId, kind, body],
  );
  await client.query(
    `insert into app.jobs (tenant_id, action_type, idempotency_key)
     values ($1, 'send_approver_text', $2)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, `send_approver_text:${rows[0]!.id}`],
  );
}

/**
 * `send_approval_request:<request id>`, queued when a customer picks a time. One text per
 * approver from the owner's `approval_request` template. A business that approves in the portal
 * (its playbook's channel) gets none; the request is in the Approve queue either way. A clinic's
 * text leaves out the job summary (minimum data, CLAUDE.md rule 13).
 */
export const sendApprovalRequest: JobHandler = async (job, ctx) => {
  const requestId = keyId(job.idempotencyKey);
  if (!requestId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      request_state: string;
      slot_start: Date;
      summary: string | null;
      name: string | null;
      phone: string | null;
      timezone: string;
      channel: 'text' | 'portal';
      clinic: boolean;
      template: string | null;
    }>(
      `select r.state as request_state, r.slot_start, l.summary, c.display_name as name, c.phone,
              t.timezone, p.default_approver_channel as channel, cfg.clinic_minimum_data as clinic,
              tt.content ->> 'approval_request' as template
         from app.requests r
         join app.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
         join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
         join app.tenants t on t.id = r.tenant_id
         join app.tenant_config cfg on cfg.tenant_id = r.tenant_id
         join app.playbooks p on p.key = cfg.playbook_key
         left join app.tenant_templates tt on tt.tenant_id = r.tenant_id and tt.active
        where r.tenant_id = $1 and r.id = $2`,
      [job.tenantId, requestId],
    );
    const approvers = await client.query<{ id: string }>(
      `select id from app.portal_users
        where tenant_id = $1 and approves_requests and mobile is not null and disabled_at is null`,
      [job.tenantId],
    );
    return rows[0] ? { ...rows[0], approvers: approvers.rows } : null;
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'request_not_found' } };
  if (facts.request_state !== 'pending') {
    return { outcome: { kind: 'skipped', reason: 'already_decided' } };
  }
  if (facts.channel !== 'text') return { outcome: { kind: 'skipped', reason: 'portal_approvals' } };
  if (facts.approvers.length === 0) return { outcome: { kind: 'skipped', reason: 'no_approver' } };
  if (!facts.template) return { outcome: { kind: 'skipped', reason: 'no_template' } };

  // A caller with no name on file is named by their number, so the time is never left out.
  const name = facts.name ?? (facts.phone ? phoneLabel(facts.phone) : null);
  const values = {
    slot: formatSlot(facts.slot_start, facts.timezone),
    ...(name ? { name } : {}),
    ...(facts.summary && !facts.clinic ? { summary: facts.summary.replace(/[.!?]+$/, '') } : {}),
  };
  const rendered = renderTemplate(
    withoutUnfilled(facts.template, values, ['summary', 'name']),
    values,
  );
  if (!rendered.ok) return { outcome: { kind: 'skipped', reason: 'missing_values' } };

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      for (const approver of facts.approvers) {
        await queueApproverText(
          client,
          job.tenantId,
          approver.id,
          requestId,
          'approval_request',
          rendered.body,
        );
      }
    },
  };
};

/** `send_approver_text:<approver text id>`: sends one queued text to an approver's mobile. */
export const sendApproverText: JobHandler = async (job, ctx) => {
  const textId = keyId(job.idempotencyKey);
  if (!textId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      status: string;
      body: string;
      mobile: string | null;
      connect_number: string | null;
      texting: string | null;
    }>(
      `select a.status, a.body, u.mobile, cfg.connect_number,
              (select state from app.service_registrations
                where tenant_id = a.tenant_id and service = 'texting') as texting
         from app.approver_texts a
         join app.portal_users u on u.tenant_id = a.tenant_id and u.id = a.portal_user_id
         left join app.tenant_config cfg on cfg.tenant_id = a.tenant_id
        where a.tenant_id = $1 and a.id = $2 and a.direction = 'out'`,
      [job.tenantId, textId],
    );
    return rows[0] ?? null;
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'text_not_found' } };
  if (facts.status !== 'queued') return { outcome: { kind: 'skipped', reason: 'already_sent' } };
  const markFailed = async (client: DbClient, settled: { status: string }) => {
    if (settled.status !== 'dead') return;
    await client.query(
      `update app.approver_texts set status = 'failed'
        where tenant_id = $1 and id = $2 and status = 'queued'`,
      [job.tenantId, textId],
    );
  };
  if (facts.texting !== 'approved' || !facts.mobile || !facts.connect_number) {
    return {
      outcome: {
        kind: 'failed',
        error: { kind: 'permanent', code: 'cannot_text', message: 'Texting is off or no number' },
      },
      apply: markFailed,
    };
  }

  const sent = await ctx.connectors.sms.send({
    tenantId: job.tenantId,
    from: facts.connect_number,
    to: facts.mobile,
    body: facts.body,
    idempotencyKey: job.idempotencyKey,
  });
  if (!sent.ok) return { outcome: { kind: 'failed', error: sent.error }, apply: markFailed };

  return {
    outcome: { kind: 'succeeded', externalRef: sent.value.messageRef },
    apply: async (client) => {
      await client.query(
        `update app.approver_texts set status = 'sent', provider_message_id = $3
          where tenant_id = $1 and id = $2 and status = 'queued'`,
        [job.tenantId, textId, sent.value.messageRef],
      );
    },
  };
};
