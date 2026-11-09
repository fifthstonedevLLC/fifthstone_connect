import { canOffer, chooseOffer, offerHorizonDays, slotList } from '@fsc/conversation';
import type { LeadState, Urgency } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import type { JobHandler } from '../handler.js';
import { openingsFor } from './openings.js';
import { queueTemplateText } from './texts.js';

/**
 * `send_slot_offer:<id>` for the job's lead: queued when someone suggests another time, when a
 * picked time turns out to be taken, and (with the clarify step) once a lead has what it needs.
 * Chooses two or three open times (`chooseOffer`), records them as numbered choices, and queues
 * the `slot_offer` text, in the transaction that settles the job. The lead waits on the customer
 * as `offered`. When nothing can be offered (no calendar, no open time, texting not live) the
 * lead goes to a person instead; times are never invented.
 */

const toPerson = (tenantId: string, leadId: string, reason: string) => async (client: DbClient) => {
  await client.query(
    `update app.leads set state = 'needs_attention', state_reason = $3, state_changed_at = now()
      where tenant_id = $1 and id = $2 and state not in ('booked', 'closed', 'spam', 'opted_out')`,
    [tenantId, leadId, reason],
  );
};

export const sendSlotOffer: JobHandler = async (job, ctx) => {
  const leadId = job.leadId;
  if (!leadId) return { outcome: { kind: 'skipped', reason: 'no_lead' } };
  const now = ctx.now();

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      state: LeadState;
      urgency: Urgency | null;
      pending: boolean;
      opted_out: boolean;
    }>(
      `select l.state, l.urgency,
              exists (select 1 from app.requests r
                       where r.tenant_id = l.tenant_id and r.lead_id = l.id
                         and r.state = 'pending') as pending,
              exists (select 1 from app.opt_outs o
                       where o.tenant_id = l.tenant_id and o.phone = c.phone
                         and o.opted_in_at is null) as opted_out
         from app.leads l
         join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
        where l.tenant_id = $1 and l.id = $2`,
      [job.tenantId, leadId],
    );
    const lead = rows[0];
    if (!lead) return null;
    const horizon = offerHorizonDays(lead.urgency);
    const openings =
      horizon === null ? null : await openingsFor(client, job.tenantId, now, horizon);
    return { lead, horizon, openings };
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'lead_not_found' } };
  const { lead, openings } = facts;
  if (lead.opted_out) return { outcome: { kind: 'skipped', reason: 'opted_out' } };
  if (!canOffer(lead.state, lead.pending)) {
    return { outcome: { kind: 'skipped', reason: 'not_offerable' } };
  }
  // An emergency is called, never offered times; it is already in front of a person.
  if (facts.horizon === null) return { outcome: { kind: 'skipped', reason: 'emergency' } };
  if (!openings || openings.calendar?.status !== 'connected') {
    return {
      outcome: { kind: 'succeeded' },
      apply: toPerson(job.tenantId, leadId, 'calendar_unavailable'),
    };
  }
  const chosen = chooseOffer(openings.slots);
  if (chosen.length === 0) {
    return {
      outcome: { kind: 'succeeded' },
      apply: toPerson(job.tenantId, leadId, 'no_open_times'),
    };
  }

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      const queued = await queueTemplateText(client, job.tenantId, leadId, 'slot_offer', {
        slots: slotList(chosen, openings.timeZone),
      });
      if (!queued.ok) {
        if (queued.reason !== 'opted_out') {
          await toPerson(job.tenantId, leadId, queued.reason)(client);
        }
        return;
      }
      // The new numbers replace any earlier offer, so "2" always means the latest text's 2.
      await client.query(
        `update app.slot_offers set state = 'withdrawn'
          where tenant_id = $1 and lead_id = $2 and state = 'open'`,
        [job.tenantId, leadId],
      );
      await client.query(
        `insert into app.slot_offers (tenant_id, lead_id, message_id, choice, slot_start, slot_end)
         select $1, $2, $3, t.choice, t.s, t.e
           from unnest($4::smallint[], $5::timestamptz[], $6::timestamptz[]) as t (choice, s, e)`,
        [
          job.tenantId,
          leadId,
          queued.messageId,
          chosen.map((_, i) => i + 1),
          chosen.map((c) => c.start),
          chosen.map((c) => c.end),
        ],
      );
      await client.query(
        `update app.leads set state = 'offered', state_reason = null, state_changed_at = now()
          where tenant_id = $1 and id = $2`,
        [job.tenantId, leadId],
      );
    },
  };
};
