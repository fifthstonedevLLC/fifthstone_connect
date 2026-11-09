import type { LeadState } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import {
  aiSettings,
  applyPlan,
  planFromReading,
  readCustomer,
  storeReading,
  toPerson,
} from './reading.js';

/**
 * `clarify_lead:<message id>`, queued by intake for a customer's text while a lead is being
 * clarified (SCOPE.md v0.2, step 2). The language model reads the customer's words (as data,
 * inside the locked safety layer) and says which of the owner's questions are answered; its
 * output is validated and stored in `app.ai_analyses`. Then the plan: ask the next question in
 * the owner's words, offer times, or hand the lead to a person. A clinic's messages never reach
 * the model (CLAUDE.md rule 13), and a model that is missing, failing or answering out of shape
 * puts the lead in front of a person rather than guessing. A voicemail's transcript, when there
 * is one, is read with the texts.
 */
export const clarifyLead: JobHandler = async (job, ctx) => {
  const messageId = keyId(job.idempotencyKey);
  if (!messageId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      lead_id: string;
      state: LeadState;
      clinic: boolean;
      business: string;
      latest_in: string | null;
      settings: unknown;
    }>(
      `select l.id as lead_id, l.state, cfg.clinic_minimum_data as clinic, t.name as business,
              (select m2.id from app.messages m2
                where m2.tenant_id = m.tenant_id and m2.conversation_id = m.conversation_id
                  and m2.direction = 'in'
                order by m2.occurred_at desc, m2.id desc limit 1) as latest_in,
              (select a.content from app.ai_settings a
                where a.tenant_id = m.tenant_id and a.active) as settings
         from app.messages m
         join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
         join app.leads l on l.tenant_id = cv.tenant_id and l.id = cv.lead_id
         join app.tenants t on t.id = m.tenant_id
         join app.tenant_config cfg on cfg.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.id = $2 and m.direction = 'in'`,
      [job.tenantId, messageId],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, ...(await leadWords(client, job.tenantId, row.lead_id)) };
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'message_not_found' } };
  const leadId = facts.lead_id;
  if (facts.state !== 'new' && facts.state !== 'clarifying') {
    return { outcome: { kind: 'skipped', reason: 'not_clarifying' } };
  }
  // Two texts in a row are read together, once, by the job for the later one.
  if (facts.latest_in !== messageId) return { outcome: { kind: 'skipped', reason: 'superseded' } };

  const person = (reason: string) => ({
    outcome: { kind: 'succeeded' as const },
    apply: (client: DbClient) => toPerson(client, job.tenantId, leadId, reason),
  });
  if (facts.clinic) return person('new_message');
  const settings = aiSettings(facts.settings);
  const model = ctx.connectors.ai;
  if (!settings || !model) return person('new_message');
  const questions = settings.questions ?? [];

  const reading = await readCustomer(model, {
    tenantId: job.tenantId,
    businessName: facts.business,
    settings,
    words: facts.words,
  });
  if (!reading.ok) {
    return {
      outcome: { kind: 'failed', error: reading.error },
      apply: async (client, settled) => {
        if (settled.status === 'dead') await toPerson(client, job.tenantId, leadId, 'unsure');
      },
    };
  }
  const plan = planFromReading(reading.output, questions, facts.sent);

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await storeReading(client, job.tenantId, leadId, 'text', reading);
      await applyPlan(client, job.tenantId, leadId, plan, questions, messageId);
    },
  };
};

/**
 * The customer's words on a lead, oldest first (voicemail transcripts, then their texts), and
 * every text that went out to them.
 */
export async function leadWords(
  client: DbClient,
  tenantId: string,
  leadId: string,
): Promise<{ words: string[]; sent: string[] }> {
  const transcripts = await client.query<{ transcript: string }>(
    `select v.transcript from app.voicemails v
       join app.calls c on c.tenant_id = v.tenant_id and c.id = v.call_id
      where v.tenant_id = $1 and c.lead_id = $2 and v.transcript is not null
      order by v.created_at`,
    [tenantId, leadId],
  );
  const thread = await client.query<{ direction: 'in' | 'out'; body: string }>(
    `select m.direction, m.body from app.messages m
       join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
      where m.tenant_id = $1 and cv.lead_id = $2
      order by m.occurred_at, m.id`,
    [tenantId, leadId],
  );
  return {
    words: [
      ...transcripts.rows.map((t) => t.transcript),
      ...thread.rows.filter((m) => m.direction === 'in').map((m) => m.body),
    ],
    sent: thread.rows.filter((m) => m.direction === 'out').map((m) => m.body),
  };
}
