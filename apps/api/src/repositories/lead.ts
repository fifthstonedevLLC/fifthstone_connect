import type { HoldState, LeadSource, LeadState, RequestState, Urgency } from '@fsc/core';
import {
  nextStep,
  replyAllowed,
  replyOptions,
  type Need,
  type NextAction,
} from '@fsc/conversation';
import type { DbClient } from '../db.js';
import { activeTemplates, contactOptedOut } from './replies.js';

/** Everything the lead page shows for one lead. Runs inside `withTenant`. */

export interface LeadDetail {
  id: string;
  source: LeadSource;
  state: LeadState;
  reason: string | null;
  urgency: Urgency | null;
  category: string | null;
  /** Written by AI from the voicemail and texts; the portal labels it as such. */
  summary: string | null;
  address: string | null;
  createdAt: string;
  /** What it needs from a person and the one action that fits (`nextStep`), as on the list. */
  next: { need: Need; action: NextAction | null; urgent: boolean };
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    /** Earlier leads from the same person at this business. */
    earlierLeads: number;
  };
  voicemail: {
    durationSeconds: number;
    /** Null when not transcribed (clinic minimum-data playbook, or not yet processed). */
    transcript: string | null;
    confidence: number | null;
    receivedAt: string;
  } | null;
  messages: {
    id: string;
    direction: 'in' | 'out';
    author: 'customer' | 'template' | 'staff' | 'ai_question';
    templateKey: string | null;
    body: string;
    deliveryStatus: 'received' | 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
    occurredAt: string;
  }[];
  request: {
    state: RequestState;
    slotStart: string;
    slotEnd: string;
    decidedAt: string | null;
    decidedVia: 'text' | 'portal' | null;
    decidedByName: string | null;
    hold: { state: HoldState; expiresAt: string } | null;
  } | null;
  /** Work queued for this lead and not finished yet, so the page can say what is in progress. */
  pendingWork: { actionType: string; status: 'queued' | 'running' | 'failed' | 'dead' }[];
  /** Template replies that can be sent to this lead now, rendered (decision 26). Empty when none. */
  replyOptions: { key: string; body: string }[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Null when the lead does not exist in this tenant (another tenant's lead looks the same). */
export async function getLead(
  client: DbClient,
  tenantId: string,
  leadId: string,
): Promise<LeadDetail | null> {
  const lead = await client.query<{
    id: string;
    source: LeadSource;
    state: LeadState;
    state_reason: string | null;
    urgency: Urgency | null;
    category: string | null;
    summary: string | null;
    address: string | null;
    created_at: Date;
    contact_id: string;
    display_name: string | null;
    phone: string | null;
    email: string | null;
    earlier_leads: string;
    nudged: boolean;
  }>(
    `select l.id, l.source, l.state, l.state_reason, l.urgency, l.category, l.summary, l.address,
            l.created_at, c.id as contact_id, c.display_name, c.phone, c.email,
            (select count(*) from app.leads e
              where e.tenant_id = l.tenant_id and e.contact_id = l.contact_id
                and e.created_at < l.created_at) as earlier_leads,
            exists (select 1 from app.jobs j
                     where j.tenant_id = l.tenant_id and j.lead_id = l.id
                       and j.action_type = 'send_nudge' and j.status <> 'skipped') as nudged
       from app.leads l
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
      where l.tenant_id = $1 and l.id = $2`,
    [tenantId, leadId],
  );
  const row = lead.rows[0];
  if (!row) return null;

  const [voicemail, messages, request, work] = await Promise.all([
    client.query<{
      duration_seconds: number;
      transcript: string | null;
      transcript_confidence: string | null;
      created_at: Date;
    }>(
      `select v.duration_seconds, v.transcript, v.transcript_confidence, v.created_at
         from app.voicemails v
         join app.calls k on k.tenant_id = v.tenant_id and k.id = v.call_id
        where v.tenant_id = $1 and k.lead_id = $2
        order by v.created_at desc
        limit 1`,
      [tenantId, leadId],
    ),
    client.query<{
      id: string;
      direction: 'in' | 'out';
      author: LeadDetail['messages'][number]['author'];
      template_key: string | null;
      body: string;
      delivery_status: LeadDetail['messages'][number]['deliveryStatus'];
      occurred_at: Date;
    }>(
      `select m.id, m.direction, m.author, m.template_key, m.body, m.delivery_status, m.occurred_at
         from app.messages m
         join app.conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
        where m.tenant_id = $1 and c.lead_id = $2
        order by m.occurred_at, m.id`,
      [tenantId, leadId],
    ),
    client.query<{
      state: RequestState;
      slot_start: Date;
      slot_end: Date;
      decided_at: Date | null;
      decided_via: 'text' | 'portal' | null;
      decided_by_name: string | null;
      hold_state: HoldState | null;
      hold_expires_at: Date | null;
    }>(
      `select r.state, r.slot_start, r.slot_end, r.decided_at, r.decided_via,
              pu.display_name as decided_by_name, h.state as hold_state,
              h.expires_at as hold_expires_at
         from app.requests r
         left join app.portal_users pu on pu.tenant_id = r.tenant_id and pu.id = r.decided_by
         left join app.calendar_holds h on h.tenant_id = r.tenant_id and h.request_id = r.id
        where r.tenant_id = $1 and r.lead_id = $2
        order by r.created_at desc
        limit 1`,
      [tenantId, leadId],
    ),
    client.query<{ action_type: string; status: 'queued' | 'running' | 'failed' | 'dead' }>(
      `select action_type, status from app.jobs
        where tenant_id = $1 and lead_id = $2 and status in ('queued', 'running', 'failed', 'dead')
        order by created_at`,
      [tenantId, leadId],
    ),
  ]);

  const optedOut = await contactOptedOut(client, tenantId, row.phone);
  const templates = replyAllowed(row.state, optedOut).ok
    ? await activeTemplates(client, tenantId)
    : null;

  const v = voicemail.rows[0];
  const r = request.rows[0];
  return {
    id: row.id,
    source: row.source,
    state: row.state,
    reason: row.state_reason,
    urgency: row.urgency,
    category: row.category,
    summary: row.summary,
    address: row.address,
    createdAt: row.created_at.toISOString(),
    next: nextStep({
      state: row.state,
      reason: row.state_reason,
      urgency: row.urgency,
      requestState:
        r?.state === 'pending' || r?.state === 'approved' || r?.state === 'changed'
          ? r.state
          : null,
      hasPhone: row.phone !== null,
      hasVoicemail: v !== undefined,
      nudged: row.nudged,
    }),
    contact: {
      name: row.display_name,
      phone: row.phone,
      email: row.email,
      earlierLeads: Number(row.earlier_leads),
    },
    voicemail: v
      ? {
          durationSeconds: v.duration_seconds,
          transcript: v.transcript,
          confidence: v.transcript_confidence === null ? null : Number(v.transcript_confidence),
          receivedAt: v.created_at.toISOString(),
        }
      : null,
    messages: messages.rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      author: m.author,
      templateKey: m.template_key,
      body: m.body,
      deliveryStatus: m.delivery_status,
      occurredAt: m.occurred_at.toISOString(),
    })),
    request: r
      ? {
          state: r.state,
          slotStart: r.slot_start.toISOString(),
          slotEnd: r.slot_end.toISOString(),
          decidedAt: iso(r.decided_at),
          decidedVia: r.decided_via,
          decidedByName: r.decided_by_name,
          hold:
            r.hold_state && r.hold_expires_at
              ? { state: r.hold_state, expiresAt: r.hold_expires_at.toISOString() }
              : null,
        }
      : null,
    pendingWork: work.rows.map((w) => ({ actionType: w.action_type, status: w.status })),
    replyOptions: templates
      ? replyOptions(templates.content, { name: row.display_name, business: templates.business })
      : [],
  };
}
