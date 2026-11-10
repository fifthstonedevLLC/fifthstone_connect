import { renderTemplate, withoutUnfilled, type MessageValues } from '@fsc/conversation';
import type { DbClient } from '../db.js';

export type QueuedText =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'no_template' | 'texting_not_live' | 'opted_out' | 'missing_values' };

interface LeadTextFacts {
  template: string | null;
  business: string;
  texting: string | null;
  opted_out: boolean;
}

async function leadTextFacts(
  client: DbClient,
  tenantId: string,
  leadId: string,
  templateKey: string | null,
): Promise<LeadTextFacts | null> {
  const { rows } = await client.query<LeadTextFacts>(
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
    [tenantId, leadId, templateKey ?? ''],
  );
  return rows[0] ?? null;
}

/** Records an outbound text as queued in the lead's thread and queues its `send_text` job. */
async function queueOutbound(
  client: DbClient,
  tenantId: string,
  leadId: string,
  author: 'template' | 'ai_question',
  templateKey: string | null,
  body: string,
): Promise<string | null> {
  await client.query(
    `insert into app.conversations (tenant_id, lead_id, channel) values ($1, $2, 'sms')
     on conflict (tenant_id, lead_id, channel) do nothing`,
    [tenantId, leadId],
  );
  const message = await client.query<{ id: string }>(
    `insert into app.messages
       (tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
     select $1, c.id, 'out', $3, $4, $5, 'queued'
       from app.conversations c
      where c.tenant_id = $1 and c.lead_id = $2 and c.channel = 'sms'
     returning id`,
    [tenantId, leadId, author, templateKey, body],
  );
  const messageId = message.rows[0]?.id;
  if (!messageId) return null;
  await client.query(
    `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
     values ($1, $2, 'send_text', $3)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, leadId, `send_text:${messageId}`],
  );
  return messageId;
}

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
  /** Leave out sentences whose AI-filled placeholders have no value yet (`withoutUnfilled`). */
  options: { leaveOutUnfilled?: boolean } = {},
): Promise<QueuedText> {
  const f = await leadTextFacts(client, tenantId, leadId, templateKey);
  if (!f?.template) return { ok: false, reason: 'no_template' };
  if (f.texting !== 'approved') return { ok: false, reason: 'texting_not_live' };
  if (f.opted_out) return { ok: false, reason: 'opted_out' };
  const template = options.leaveOutUnfilled ? withoutUnfilled(f.template, values) : f.template;
  const rendered = renderTemplate(template, { ...values, business: f.business });
  if (!rendered.ok) return { ok: false, reason: 'missing_values' };
  const messageId = await queueOutbound(
    client,
    tenantId,
    leadId,
    'template',
    templateKey,
    rendered.body,
  );
  return messageId ? { ok: true, messageId } : { ok: false, reason: 'no_template' };
}

/**
 * Queues a fixed safety or crisis message (`packages/conversation/src/safety.ts`). It is not an
 * owner template and cannot be edited, but the same opt-out and texting checks apply (rule 12).
 */
export async function queueFixedText(
  client: DbClient,
  tenantId: string,
  leadId: string,
  key: string,
  body: string,
): Promise<QueuedText> {
  const f = await leadTextFacts(client, tenantId, leadId, null);
  if (!f) return { ok: false, reason: 'no_template' };
  if (f.texting !== 'approved') return { ok: false, reason: 'texting_not_live' };
  if (f.opted_out) return { ok: false, reason: 'opted_out' };
  const messageId = await queueOutbound(client, tenantId, leadId, 'template', key, body);
  return messageId ? { ok: true, messageId } : { ok: false, reason: 'no_template' };
}

/**
 * Queues one of the owner's clarifying questions, word for word from their AI settings (the AI
 * layer chose which one; it wrote none of it). Same opt-out and texting checks as a template.
 */
export async function queueQuestionText(
  client: DbClient,
  tenantId: string,
  leadId: string,
  question: string,
): Promise<QueuedText> {
  const f = await leadTextFacts(client, tenantId, leadId, null);
  if (!f) return { ok: false, reason: 'no_template' };
  if (f.texting !== 'approved') return { ok: false, reason: 'texting_not_live' };
  if (f.opted_out) return { ok: false, reason: 'opted_out' };
  const messageId = await queueOutbound(client, tenantId, leadId, 'ai_question', null, question);
  return messageId ? { ok: true, messageId } : { ok: false, reason: 'no_template' };
}
