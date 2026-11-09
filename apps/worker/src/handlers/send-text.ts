import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';

/**
 * `send_text:<message id>`: sends one outbound message already recorded as queued (a portal
 * reply, a confirmation). Opt-out is checked again right before sending (CLAUDE.md rule 12), and
 * nothing goes out while the business's texting is not live. The message becomes "sent" with the
 * provider's reference; delivery receipts arrive later through the status webhook (Phase 4).
 */
export const sendText: JobHandler = async (job, ctx) => {
  const messageId = keyId(job.idempotencyKey);
  if (!messageId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      direction: 'in' | 'out';
      delivery_status: string;
      body: string;
      phone: string | null;
      connect_number: string | null;
      texting: string | null;
      opted_out: boolean;
    }>(
      `select m.direction, m.delivery_status, m.body, c.phone, cfg.connect_number,
              (select state from app.service_registrations
                where tenant_id = m.tenant_id and service = 'texting') as texting,
              exists (select 1 from app.opt_outs o
                       where o.tenant_id = m.tenant_id and o.phone = c.phone
                         and o.opted_in_at is null) as opted_out
         from app.messages m
         join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
         join app.leads l on l.tenant_id = cv.tenant_id and l.id = cv.lead_id
         join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
         left join app.tenant_config cfg on cfg.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.id = $2`,
      [job.tenantId, messageId],
    );
    return rows[0] ?? null;
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'message_not_found' } };
  if (facts.direction !== 'out') return { outcome: { kind: 'skipped', reason: 'not_outbound' } };
  if (facts.delivery_status !== 'queued') {
    return { outcome: { kind: 'skipped', reason: 'already_sent' } };
  }

  const markFailed = async (client: DbClient) => {
    await client.query(
      `update app.messages set delivery_status = 'failed'
        where tenant_id = $1 and id = $2 and delivery_status = 'queued'`,
      [job.tenantId, messageId],
    );
  };
  const failWhenDead = async (client: DbClient, settled: { status: string }) => {
    if (settled.status === 'dead') await markFailed(client);
  };

  if (facts.opted_out) {
    return { outcome: { kind: 'skipped', reason: 'opted_out' }, apply: markFailed };
  }
  if (facts.texting !== 'approved') {
    return {
      outcome: {
        kind: 'failed',
        error: { kind: 'permanent', code: 'texting_not_live', message: 'Texting is not approved' },
      },
      apply: failWhenDead,
    };
  }
  if (!facts.phone || !facts.connect_number) {
    return {
      outcome: {
        kind: 'failed',
        error: { kind: 'permanent', code: 'no_number', message: 'No number to send from or to' },
      },
      apply: failWhenDead,
    };
  }

  const sent = await ctx.connectors.sms.send({
    tenantId: job.tenantId,
    from: facts.connect_number,
    to: facts.phone,
    body: facts.body,
    idempotencyKey: job.idempotencyKey,
  });
  if (!sent.ok) return { outcome: { kind: 'failed', error: sent.error }, apply: failWhenDead };

  return {
    outcome: { kind: 'succeeded', externalRef: sent.value.messageRef },
    apply: async (client) => {
      await client.query(
        `update app.messages
            set delivery_status = 'sent', provider_message_id = $3, segments = $4
          where tenant_id = $1 and id = $2 and delivery_status = 'queued'`,
        [job.tenantId, messageId, sent.value.messageRef, sent.value.segments],
      );
    },
  };
};
