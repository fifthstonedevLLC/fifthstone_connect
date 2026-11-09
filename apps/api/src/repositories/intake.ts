import type { PhoneEvent } from '@fsc/connectors';
import { isOptIn, isOptOut, planInbound } from '@fsc/conversation';
import type { LeadState } from '@fsc/core';
import type { DbClient } from '../db.js';

/**
 * Records one inbound phone event for a business and does what `planInbound` says, inside the
 * caller's tenant transaction, so the API answers the provider only once everything is stored
 * (CLAUDE.md rule 1). A provider retry of the same event changes nothing (rule 2). Texts to
 * customers and calendar work are queued jobs, never done here.
 */

export type IntakeOutcome = 'recorded' | 'duplicate';

type CallEvent = Extract<PhoneEvent, { kind: 'missed_call' | 'voicemail' }>;
type TextEvent = Extract<PhoneEvent, { kind: 'text_received' }>;

/** The provider's ID for this event. A voicemail shares its call's ID, so it gets its own. */
function externalId(event: CallEvent | TextEvent): string {
  if (event.kind === 'text_received') return event.messageId;
  return event.kind === 'voicemail' ? `${event.callId}:voicemail` : event.callId;
}

export async function recordPhoneEvent(
  client: DbClient,
  tenantId: string,
  event: CallEvent | TextEvent,
  payloadSha256: string,
): Promise<IntakeOutcome> {
  const inserted = await client.query<{ id: string }>(
    `insert into app.inbound_events (tenant_id, source, kind, external_event_id, payload_sha256)
     values ($1, 'phone', $2, $3, $4)
     on conflict (tenant_id, source, external_event_id) do nothing
     returning id`,
    [tenantId, event.kind, externalId(event), payloadSha256],
  );
  const eventId = inserted.rows[0]?.id;
  if (!eventId) return 'duplicate';

  const contact = await client.query<{ id: string }>(
    `insert into app.contacts (tenant_id, phone) values ($1, $2)
     on conflict (tenant_id, phone) where phone is not null do update set updated_at = now()
     returning id`,
    [tenantId, event.from],
  );
  const contactId = contact.rows[0]!.id;
  const open = await client.query<{ id: string; state: LeadState }>(
    `select id, state from app.leads
      where tenant_id = $1 and contact_id = $2 and state not in ('closed', 'spam', 'opted_out')
      order by created_at desc limit 1`,
    [tenantId, contactId],
  );
  let lead = open.rows[0] ?? null;

  // STOP and START are honored before anything else, and start no lead (rule 12).
  if (event.kind === 'text_received' && (isOptOut(event.body) || isOptIn(event.body))) {
    if (isOptOut(event.body)) {
      await client.query(
        `insert into app.opt_outs (tenant_id, phone, source) values ($1, $2, 'stop_keyword')
         on conflict (tenant_id, phone)
         do update set opted_out_at = now(), opted_in_at = null, source = 'stop_keyword'`,
        [tenantId, event.from],
      );
    } else {
      await client.query(
        `update app.opt_outs set opted_in_at = now()
          where tenant_id = $1 and phone = $2 and opted_in_at is null`,
        [tenantId, event.from],
      );
    }
    if (lead) {
      await recordText(client, tenantId, lead.id, event);
      if (isOptOut(event.body)) {
        await client.query(
          `update app.leads set state = 'opted_out', state_reason = 'stop_keyword',
                  state_changed_at = now()
            where tenant_id = $1 and id = $2`,
          [tenantId, lead.id],
        );
      }
    }
    return 'recorded';
  }

  const plan = planInbound(event.kind, lead?.state ?? null);
  if (plan.create) {
    const created = await client.query<{ id: string; state: LeadState }>(
      `insert into app.leads (tenant_id, contact_id, source, first_event_id)
       values ($1, $2, $3, $4) returning id, state`,
      [tenantId, contactId, plan.create, eventId],
    );
    lead = created.rows[0]!;
  }
  if (!lead) return 'recorded';

  let messageId: string | null = null;
  if (event.kind === 'text_received') {
    messageId = await recordText(client, tenantId, lead.id, event);
  } else {
    // Calls are append-only: a voicemail for a call already recorded finds that call.
    await client.query(
      `insert into app.calls (tenant_id, lead_id, provider_call_id, from_number, to_number, started_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, provider_call_id) do nothing`,
      [tenantId, lead.id, event.callId, event.from, event.to, event.at],
    );
    const call = await client.query<{ id: string }>(
      `select id from app.calls where tenant_id = $1 and provider_call_id = $2`,
      [tenantId, event.callId],
    );
    if (event.kind === 'voicemail') {
      // Kept as a recording; transcribing it is the clarify step's job (and never for clinics).
      await client.query(
        `insert into app.voicemails (tenant_id, call_id, recording_ref, duration_seconds)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, call_id) do nothing`,
        [tenantId, call.rows[0]!.id, event.recordingRef, event.durationSeconds],
      );
    }
  }

  if (plan.move && plan.move.state !== lead.state) {
    await client.query(
      `update app.leads set state = $3, state_reason = $4, state_changed_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, lead.id, plan.move.state, plan.move.reason],
    );
  }
  const key =
    plan.job === 'send_text_back'
      ? `send_text_back:${lead.id}`
      : plan.job === 'handle_offer_reply' && messageId
        ? `handle_offer_reply:${messageId}`
        : null;
  if (plan.job && key) {
    await client.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, $3, $4)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, lead.id, plan.job, key],
    );
  }
  return 'recorded';
}

/** The customer's text in the lead's thread. A picture-only text gets a plain placeholder. */
async function recordText(
  client: DbClient,
  tenantId: string,
  leadId: string,
  event: TextEvent,
): Promise<string> {
  await client.query(
    `insert into app.conversations (tenant_id, lead_id, channel) values ($1, $2, 'sms')
     on conflict (tenant_id, lead_id, channel) do nothing`,
    [tenantId, leadId],
  );
  const body = event.body.trim() || '(a picture or file, not shown)';
  const message = await client.query<{ id: string }>(
    `insert into app.messages
       (tenant_id, conversation_id, direction, author, body, provider_message_id,
        delivery_status, occurred_at)
     select $1, c.id, 'in', 'customer', $3, $4, 'received', $5
       from app.conversations c
      where c.tenant_id = $1 and c.lead_id = $2 and c.channel = 'sms'
     returning id`,
    [tenantId, leadId, body, event.messageId, event.at],
  );
  return message.rows[0]!.id;
}
