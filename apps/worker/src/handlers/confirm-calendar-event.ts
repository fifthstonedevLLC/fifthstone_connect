import { formatSlot } from '@fsc/conversation';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { holdFor, mirrorHoldIntoMock } from './holds.js';
import { queueTemplateText } from './texts.js';

/**
 * `confirm_calendar_event:<request id>`, queued when someone approves a request (planAction).
 * Turns the tentative hold into a calendar event, then marks the lead booked and queues the
 * confirmation text, in the transaction that settles the job. Until this runs the portal shows
 * the lead as "Confirming" (decision 24). If the event cannot be made, the lead goes back to
 * "Needs you" so a person can sort it out.
 */
export const confirmCalendarEvent: JobHandler = async (job, ctx) => {
  const requestId = keyId(job.idempotencyKey);
  if (!requestId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      lead_id: string;
      request_state: string;
      lead_state: string;
      category: string | null;
      summary: string | null;
      address: string | null;
      display_name: string | null;
      calendar_status: string | null;
    }>(
      `select r.lead_id, r.state as request_state, l.state as lead_state, l.category, l.summary,
              l.address, c.display_name,
              (select status from app.calendar_connections cc
                where cc.tenant_id = r.tenant_id order by cc.updated_at desc limit 1)
                as calendar_status
         from app.requests r
         join app.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
         join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
        where r.tenant_id = $1 and r.id = $2`,
      [job.tenantId, requestId],
    );
    const row = rows[0];
    return row ? { ...row, hold: await holdFor(client, job.tenantId, requestId) } : null;
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'request_not_found' } };
  if (facts.hold?.hold_state === 'converted') {
    return { outcome: { kind: 'skipped', reason: 'already_booked' } };
  }
  if (facts.request_state !== 'approved') {
    return { outcome: { kind: 'skipped', reason: 'request_not_approved' } };
  }

  const needsPerson = (reason: string) => async (client: DbClient, settled: { status: string }) => {
    if (settled.status !== 'dead') return;
    await client.query(
      `update app.leads set state = 'needs_attention', state_reason = $3, state_changed_at = now()
        where tenant_id = $1 and id = $2 and state = 'requested'`,
      [job.tenantId, facts.lead_id, reason],
    );
  };

  if (facts.calendar_status !== 'connected') {
    return {
      outcome: {
        kind: 'failed',
        error: {
          kind: 'permanent',
          code: 'calendar_not_connected',
          message: 'No connected calendar',
        },
      },
      apply: needsPerson('booking_failed'),
    };
  }
  const hold = facts.hold;
  if (!hold || hold.hold_state !== 'active') {
    return {
      outcome: {
        kind: 'failed',
        error: { kind: 'permanent', code: 'hold_not_found', message: 'No active hold to confirm' },
      },
      apply: needsPerson('booking_failed'),
    };
  }

  mirrorHoldIntoMock(ctx.connectors.calendar, job.tenantId, hold);
  const who = facts.display_name ?? 'New customer';
  const confirmed = await ctx.connectors.calendar.confirmHold({
    tenantId: job.tenantId,
    calendarId: hold.calendar_id,
    holdRef: hold.provider_hold_ref,
    title: `${who}: ${(facts.category ?? 'job').replaceAll('_', ' ')}`,
    description: [facts.summary, facts.address].filter(Boolean).join('\n'),
    idempotencyKey: job.idempotencyKey,
  });
  if (!confirmed.ok) {
    return {
      outcome: { kind: 'failed', error: confirmed.error },
      apply: needsPerson('booking_failed'),
    };
  }

  return {
    outcome: { kind: 'succeeded', externalRef: confirmed.value.eventRef },
    apply: async (client) => {
      await client.query(
        `update app.calendar_holds set state = 'converted'
          where tenant_id = $1 and id = $2 and state = 'active'`,
        [job.tenantId, hold.hold_id],
      );
      await client.query(
        `update app.leads set state = 'booked', state_reason = null, state_changed_at = now()
          where tenant_id = $1 and id = $2 and state = 'requested'`,
        [job.tenantId, facts.lead_id],
      );
      await client.query(
        `insert into app.audit_events
           (tenant_id, actor_type, action, subject_type, subject_id, detail)
         values ($1, 'system', 'lead.booked', 'lead', $2, $3)`,
        [job.tenantId, facts.lead_id, JSON.stringify({ eventRef: confirmed.value.eventRef })],
      );
      await queueConfirmationText(client, job.tenantId, facts.lead_id, hold.slot_start);
    },
  };
};

/**
 * The confirmation text, from the owner's `confirmation` template (CLAUDE.md rule 10), recorded
 * as queued with its own `send_text` job. Not queued when texting is not live, the customer opted
 * out (rule 12), or the template cannot be filled; the booking stands either way.
 */
/** The confirmation text, from the business's `confirmation` template (none while texting is off). */
async function queueConfirmationText(
  client: DbClient,
  tenantId: string,
  leadId: string,
  slotStart: Date,
): Promise<void> {
  const tz = await client.query<{ timezone: string }>(
    'select timezone from app.tenants where id = $1',
    [tenantId],
  );
  const timeZone = tz.rows[0]?.timezone;
  if (!timeZone) return;
  await queueTemplateText(client, tenantId, leadId, 'confirmation', {
    slot: formatSlot(slotStart, timeZone),
  });
}
