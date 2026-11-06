import { countSegments } from '@fsc/connectors';
import { renderReply, replyAllowed, type ReplyError } from '@fsc/conversation';
import type { DbClient } from '../db.js';

/**
 * Template replies from the portal (decision 26). Runs inside `withTenant`. The message is
 * recorded as queued and its send job is queued in the same transaction; the worker sends it
 * (CLAUDE.md rule 1). The client supplies the message ID, so a repeated submit records one message.
 */

/** The tenant's active template version and business name, or null if none is set up yet. */
export async function activeTemplates(
  client: DbClient,
  tenantId: string,
): Promise<{ version: number; content: Record<string, string>; business: string } | null> {
  const { rows } = await client.query<{
    version: number;
    content: Record<string, string>;
    business: string;
  }>(
    `select tt.version, tt.content, t.name as business
       from app.tenant_templates tt
       join app.tenants t on t.id = tt.tenant_id
      where tt.tenant_id = $1 and tt.active`,
    [tenantId],
  );
  return rows[0] ?? null;
}

export async function contactOptedOut(
  client: DbClient,
  tenantId: string,
  phone: string | null,
): Promise<boolean> {
  if (!phone) return false;
  const { rows } = await client.query<{ opted_out: boolean }>(
    `select exists (select 1 from app.opt_outs
                     where tenant_id = $1 and phone = $2 and opted_in_at is null) as opted_out`,
    [tenantId, phone],
  );
  return rows[0]?.opted_out ?? false;
}

export type ReplyResult = { ok: true } | { ok: false; error: ReplyError | 'not_found' };

export async function sendReply(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  leadId: string,
  templateKey: string,
  messageId: string,
): Promise<ReplyResult> {
  const lead = await client.query<{
    state: Parameters<typeof replyAllowed>[0];
    name: string | null;
    phone: string | null;
  }>(
    `select l.state, c.display_name as name, c.phone
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
      where l.tenant_id = $1 and l.id = $2
      for update of l`,
    [tenantId, leadId],
  );
  const row = lead.rows[0];
  if (!row) return { ok: false, error: 'not_found' };

  const allowed = replyAllowed(row.state, await contactOptedOut(client, tenantId, row.phone));
  if (!allowed.ok) return allowed;

  const templates = await activeTemplates(client, tenantId);
  if (!templates) return { ok: false, error: 'template_not_found' };
  const rendered = renderReply(templates.content, templateKey, {
    name: row.name,
    business: templates.business,
  });
  if (!rendered.ok) return rendered;

  await client.query(
    `insert into app.conversations (tenant_id, lead_id, channel) values ($1, $2, 'sms')
     on conflict (tenant_id, lead_id, channel) do nothing`,
    [tenantId, leadId],
  );
  const inserted = await client.query(
    `insert into app.messages
       (id, tenant_id, conversation_id, direction, author, template_key, body, segments,
        delivery_status)
     select $1, $2, c.id, 'out', 'template', $4, $5, $6, 'queued'
       from app.conversations c
      where c.tenant_id = $2 and c.lead_id = $3 and c.channel = 'sms'
     on conflict (id) do nothing
     returning id`,
    [
      messageId,
      tenantId,
      leadId,
      templateKey,
      rendered.body,
      countSegments(rendered.body).segments,
    ],
  );
  // Already recorded by an earlier submit of the same message: nothing more to do.
  if (inserted.rowCount === 0) return { ok: true };

  await client.query(
    `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
     values ($1, $2, 'send_text', $3)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, leadId, `send_text:${messageId}`],
  );
  await client.query(
    `insert into app.audit_events
       (tenant_id, actor_type, actor_portal_user_id, action, subject_type, subject_id, detail)
     values ($1, 'portal_user', $2, 'lead.replied', 'lead', $3, $4)`,
    [
      tenantId,
      portalUserId,
      leadId,
      JSON.stringify({ templateKey, templateVersion: templates.version, messageId }),
    ],
  );
  return { ok: true };
}
