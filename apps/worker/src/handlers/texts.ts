import { renderTemplate, type MessageValues } from '@fsc/conversation';
import type { DbClient } from '../db.js';

export type QueuedText =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'no_template' | 'texting_not_live' | 'opted_out' | 'missing_values' };

/**
 * Records a text from one of the business's active templates as queued, and queues the
 * `send_text` job that sends it, in the caller's transaction (CLAUDE.md rule 1). Nothing is
 * queued while texting is not live or the customer has opted out (rule 12); `send_text` checks
 * both again right before sending.
 */
export async function queueTemplateText(
  client: DbClient,
  tenantId: string,
  leadId: string,
  templateKey: string,
  values: Omit<MessageValues, 'business'>,
): Promise<QueuedText> {
  const { rows } = await client.query<{
    template: string | null;
    business: string;
    texting: string | null;
    opted_out: boolean;
  }>(
    `select tt.content ->> $3 as template, t.name as business,
            (select state from app.service_registrations
              where tenant_id = $1 and service = 'texting') as texting,
            exists (select 1 from app.opt_outs o
                     where o.tenant_id = $1 and o.phone = c.phone and o.opted_in_at is null)
              as opted_out
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       join app.tenants t on t.id = l.tenant_id
       left join app.tenant_templates tt on tt.tenant_id = l.tenant_id and tt.active
      where l.tenant_id = $1 and l.id = $2`,
    [tenantId, leadId, templateKey],
  );
  const f = rows[0];
  if (!f?.template) return { ok: false, reason: 'no_template' };
  if (f.texting !== 'approved') return { ok: false, reason: 'texting_not_live' };
  if (f.opted_out) return { ok: false, reason: 'opted_out' };
  const rendered = renderTemplate(f.template, { ...values, business: f.business });
  if (!rendered.ok) return { ok: false, reason: 'missing_values' };

  await client.query(
    `insert into app.conversations (tenant_id, lead_id, channel) values ($1, $2, 'sms')
     on conflict (tenant_id, lead_id, channel) do nothing`,
    [tenantId, leadId],
  );
  const message = await client.query<{ id: string }>(
    `insert into app.messages
       (tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
     select $1, c.id, 'out', 'template', $3, $4, 'queued'
       from app.conversations c
      where c.tenant_id = $1 and c.lead_id = $2 and c.channel = 'sms'
     returning id`,
    [tenantId, leadId, templateKey, rendered.body],
  );
  const messageId = message.rows[0]?.id;
  if (!messageId) return { ok: false, reason: 'no_template' };
  await client.query(
    `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
     values ($1, $2, 'send_text', $3)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, leadId, `send_text:${messageId}`],
  );
  return { ok: true, messageId };
}
