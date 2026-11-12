import { countSegments } from '@fsc/connectors';
import {
  checkFreeText,
  renderReply,
  replyAllowed,
  type FreeTextError,
  type ReplyError,
} from '@fsc/conversation';
import type { DbClient } from '../db.js';
import { permissionSettings } from './permissions.js';

/**
 * Replies from the portal: owner-approved templates (decision 26) and, where the owner allows it,
 * a person's own words (decision 39). Runs inside `withTenant`. The message is
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

export type ReplyResult =
  { ok: true } | { ok: false; error: ReplyError | FreeTextError | 'not_found' | 'free_text_off' };

/** A template the owner approved (decision 26), or a person's own words (decision 39). */
export type ReplyInput = { kind: 'template'; templateKey: string } | { kind: 'text'; text: string };

/**
 * Records a reply as queued and queues its send job in the same transaction. Who may send which
 * kind is checked by the route (decision 40); whether free text is switched on, and its rules, are
 * checked here, before anything is written.
 */
export async function sendReply(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  leadId: string,
  reply: ReplyInput,
  messageId: string,
): Promise<ReplyResult> {
  const lead = await client.query<{
    state: Parameters<typeof replyAllowed>[0];
    name: string | null;
    phone: string | null;
    contact_id: string;
  }>(
    `select l.state, c.display_name as name, c.phone, c.id as contact_id
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
  let body: string;
  let segments: number;
  let detail: Record<string, unknown>;
  if (reply.kind === 'template') {
    if (!templates) return { ok: false, error: 'template_not_found' };
    const rendered = renderReply(templates.content, reply.templateKey, {
      name: row.name,
      business: templates.business,
    });
    if (!rendered.ok) return rendered;
    body = rendered.body;
    segments = countSegments(body).segments;
    detail = { templateKey: reply.templateKey, templateVersion: templates.version };
  } else {
    const { freeTextChannels } = await permissionSettings(client, tenantId);
    if (!freeTextChannels.includes('sms')) return { ok: false, error: 'free_text_off' };
    const business = await client.query<{ name: string; texted: boolean }>(
      `select t.name,
              exists (select 1 from app.messages m
                        join app.conversations cv
                          on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
                        join app.leads l on l.tenant_id = cv.tenant_id and l.id = cv.lead_id
                       where m.tenant_id = t.id and l.contact_id = $2 and m.direction = 'out'
                         and cv.channel = 'sms') as texted
         from app.tenants t where t.id = $1`,
      [tenantId, row.contact_id],
    );
    const facts = business.rows[0]!;
    const checked = checkFreeText(reply.text, {
      businessName: facts.name,
      firstText: !facts.texted,
    });
    if (!checked.ok) return checked;
    body = checked.body;
    segments = checked.segments;
    // The audit names what was sent, never the words (they are in the message itself).
    detail = { freeText: true, segments };
  }

  await client.query(
    `insert into app.conversations (tenant_id, lead_id, channel) values ($1, $2, 'sms')
     on conflict (tenant_id, lead_id, channel) do nothing`,
    [tenantId, leadId],
  );
  const inserted = await client.query(
    `insert into app.messages
       (id, tenant_id, conversation_id, direction, author, template_key, body, segments,
        delivery_status)
     select $1, $2, c.id, 'out', $4, $5, $6, $7, 'queued'
       from app.conversations c
      where c.tenant_id = $2 and c.lead_id = $3 and c.channel = 'sms'
     on conflict (id) do nothing
     returning id`,
    [
      messageId,
      tenantId,
      leadId,
      reply.kind === 'template' ? 'template' : 'staff',
      reply.kind === 'template' ? reply.templateKey : null,
      body,
      segments,
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
    [tenantId, portalUserId, leadId, JSON.stringify({ ...detail, messageId })],
  );
  return { ok: true };
}
