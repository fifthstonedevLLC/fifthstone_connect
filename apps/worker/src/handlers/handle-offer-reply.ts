import { formatSlot, holdExpiry, OFFER_LEAD_MINUTES, parseChoice } from '@fsc/conversation';
import { BusinessHoursListSchema } from '@fsc/core';
import { afterOpenMinutes } from '@fsc/scheduling';
import type { LeadState } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { queueTemplateText } from './texts.js';

/**
 * `handle_offer_reply:<message id>` for a customer's text while times are on offer (queued by the
 * inbound text step). A plain number from the offer becomes a request, not a booking: the time is
 * held on the calendar until someone approves it, the customer is told it is requested, and the
 * lead appears in the Approve queue. If that time was taken meanwhile (MOCK_DATA.md RB-20), fresh
 * times are offered. Anything other than a number goes to a person; a reply is never guessed.
 */

interface Slot {
  start: Date;
  end: Date;
}

interface Offer {
  id: string;
  choice: number;
  slot_start: Date;
  slot_end: Date;
}

/**
 * Fresh times instead of a taken one. The calendar just said the time is busy, which the last
 * sync did not know, so it is recorded as busy now (the next sync replaces it), and the new offer
 * cannot repeat it.
 */
function reoffer(
  tenantId: string,
  leadId: string,
  messageId: string,
  /** The calendar said this time is busy: recorded so the new offer cannot repeat it. */
  busy?: { connectionId: string; slot: Slot },
) {
  return async (client: DbClient) => {
    if (busy) {
      await client.query(
        `insert into app.calendar_busy (tenant_id, connection_id, starts_at, ends_at)
         values ($1, $2, $3, $4)`,
        [tenantId, busy.connectionId, busy.slot.start, busy.slot.end],
      );
    }
    await client.query(
      `update app.slot_offers set state = 'withdrawn'
        where tenant_id = $1 and lead_id = $2 and state = 'open'`,
      [tenantId, leadId],
    );
    await client.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'send_slot_offer', $3)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, leadId, `send_slot_offer:${messageId}`],
    );
  };
}

export const handleOfferReply: JobHandler = async (job, ctx) => {
  const messageId = keyId(job.idempotencyKey);
  if (!messageId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };
  const now = ctx.now();

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      direction: 'in' | 'out';
      body: string;
      lead_id: string;
      state: LeadState;
      timezone: string;
      hold_minutes: number;
      approval_window_minutes: number;
      business_hours: unknown;
    }>(
      `select m.direction, m.body, l.id as lead_id, l.state, t.timezone, cfg.hold_minutes,
              cfg.approval_window_minutes, cfg.business_hours
         from app.messages m
         join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
         join app.leads l on l.tenant_id = cv.tenant_id and l.id = cv.lead_id
         join app.tenants t on t.id = m.tenant_id
         join app.tenant_config cfg on cfg.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.id = $2`,
      [job.tenantId, messageId],
    );
    const message = rows[0];
    if (!message) return null;
    const offers = await client.query<Offer>(
      `select id, choice, slot_start, slot_end from app.slot_offers
        where tenant_id = $1 and lead_id = $2 and state = 'open' order by choice`,
      [job.tenantId, message.lead_id],
    );
    const calendar = await client.query<{ id: string; calendar_id: string; status: string }>(
      `select id, calendar_id, status from app.calendar_connections
        where tenant_id = $1 order by updated_at desc limit 1`,
      [job.tenantId],
    );
    return { ...message, offers: offers.rows, calendar: calendar.rows[0] ?? null };
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'message_not_found' } };
  if (facts.direction !== 'in') return { outcome: { kind: 'skipped', reason: 'not_inbound' } };
  if (facts.state !== 'offered' || facts.offers.length === 0) {
    return { outcome: { kind: 'skipped', reason: 'no_open_offer' } };
  }
  const leadId = facts.lead_id;

  const choice = parseChoice(facts.body, facts.offers.length);
  const offer = facts.offers.find((o) => o.choice === choice);
  if (!offer) {
    return {
      outcome: { kind: 'succeeded' },
      apply: async (client) => {
        await client.query(
          `update app.leads set state = 'needs_attention', state_reason = 'unclear_reply',
                  state_changed_at = now()
            where tenant_id = $1 and id = $2 and state = 'offered'`,
          [job.tenantId, leadId],
        );
      },
    };
  }

  if (facts.calendar?.status !== 'connected') {
    return {
      outcome: { kind: 'succeeded' },
      apply: async (client) => {
        await client.query(
          `update app.leads set state = 'needs_attention', state_reason = 'calendar_unavailable',
                  state_changed_at = now()
            where tenant_id = $1 and id = $2 and state = 'offered'`,
          [job.tenantId, leadId],
        );
      },
    };
  }

  const slot = { start: offer.slot_start, end: offer.slot_end };
  // An offer answered late can point at a time that has passed, or is too soon to approve and
  // reach: fresh times instead.
  if (slot.start.getTime() <= now.getTime() + OFFER_LEAD_MINUTES * 60_000) {
    return { outcome: { kind: 'succeeded' }, apply: reoffer(job.tenantId, leadId, messageId) };
  }
  // Another customer may have picked the same time from their own offer. This service's records
  // say so before the calendar does (a calendar may accept overlapping holds; the database never
  // does), so check them first rather than leave a stray hold on the calendar.
  const taken = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rowCount } = await client.query(
      `select 1 from app.requests r
        where r.tenant_id = $1 and r.state in ('pending', 'approved')
          and r.slot_start < $3 and r.slot_end > $2`,
      [job.tenantId, slot.start, slot.end],
    );
    return (rowCount ?? 0) > 0;
  });
  if (taken) {
    return { outcome: { kind: 'succeeded' }, apply: reoffer(job.tenantId, leadId, messageId) };
  }

  // The calendar has the final say: a time taken there since the offer fails here, not later.
  const held = await ctx.connectors.calendar.placeHold({
    tenantId: job.tenantId,
    calendarId: facts.calendar.calendar_id,
    slot,
    title: 'HOLD: requested time (awaiting approval)',
    idempotencyKey: `place_hold:${messageId}`,
  });
  if (!held.ok) {
    if (held.error.code === 'slot_unavailable') {
      return {
        outcome: { kind: 'succeeded' },
        apply: reoffer(job.tenantId, leadId, messageId, {
          connectionId: facts.calendar.id,
          slot,
        }),
      };
    }
    return { outcome: { kind: 'failed', error: held.error } };
  }

  return {
    outcome: { kind: 'succeeded', externalRef: held.value.holdRef },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      const request = await client.query<{ id: string }>(
        `insert into app.requests (tenant_id, lead_id, slot_start, slot_end)
         values ($1, $2, $3, $4) returning id`,
        [job.tenantId, leadId, slot.start, slot.end],
      );
      const requestId = request.rows[0]?.id;
      const expiresAt = holdExpiry(now, slot.start, facts.hold_minutes);
      await client.query(
        `insert into app.calendar_holds
           (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          job.tenantId,
          requestId,
          facts.calendar!.calendar_id,
          held.value.holdRef,
          slot.start,
          slot.end,
          expiresAt,
        ],
      );
      await client.query(
        `update app.slot_offers set state = case when id = $3 then 'picked' else 'withdrawn' end
          where tenant_id = $1 and lead_id = $2 and state = 'open'`,
        [job.tenantId, leadId, offer.id],
      );
      await client.query(
        `update app.leads set state = 'requested', state_reason = null, state_changed_at = now()
          where tenant_id = $1 and id = $2`,
        [job.tenantId, leadId],
      );
      await client.query(
        `insert into app.audit_events
           (tenant_id, actor_type, action, subject_type, subject_id, detail)
         values ($1, 'system', 'request.created', 'request', $2, $3)`,
        [job.tenantId, requestId, JSON.stringify({ choice: offer.choice, via: 'text' })],
      );
      // The approvers get their text (or, for portal approvals, the Approve queue is enough).
      await client.query(
        `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
         values ($1, $2, 'send_approval_request', $3)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [job.tenantId, leadId, `send_approval_request:${requestId}`],
      );
      // If nobody decides: one reminder after the approval window (in business hours, decision
      // 10), as long as the hold is still running; then the hold runs out (decision 19).
      const hours = BusinessHoursListSchema.safeParse(facts.business_hours);
      const remindAt = afterOpenMinutes(
        now,
        facts.approval_window_minutes,
        hours.success ? hours.data : [],
        facts.timezone,
      );
      if (remindAt < expiresAt) {
        await client.query(
          `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key, run_at)
           values ($1, $2, 'approval_reminder', $3, $4)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [job.tenantId, leadId, `approval_reminder:${requestId}`, remindAt],
        );
      }
      await client.query(
        `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key, run_at)
         values ($1, $2, 'expire_hold', $3, $4)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [job.tenantId, leadId, `expire_hold:${requestId}`, expiresAt],
      );
      await queueTemplateText(client, job.tenantId, leadId, 'request_received', {
        slot: formatSlot(slot.start, facts.timezone),
      });
    },
  };
};
