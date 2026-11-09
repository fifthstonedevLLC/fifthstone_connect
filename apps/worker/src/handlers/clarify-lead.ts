import { clarifyInput, compileClarifyPrompt, parseClarifyOutput } from '@fsc/ai';
import { askedIndexes, planClarify, type ClarifyPlan } from '@fsc/conversation';
import { AiSettingsSchema, type LeadState } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { queueQuestionText } from './texts.js';

/**
 * `clarify_lead:<message id>`, queued by intake for a customer's text while a lead is being
 * clarified (SCOPE.md v0.2, step 2). The language model reads the customer's messages (as data,
 * inside the locked safety layer) and says which of the owner's questions are answered; its
 * output is validated and stored in `app.ai_analyses`. Then `planClarify` decides: ask the next
 * question in the owner's words, offer times, or hand the lead to a person. A clinic's messages
 * never reach the model (CLAUDE.md rule 13), and a model that is missing, failing or answering
 * out of shape puts the lead in front of a person rather than guessing.
 */

const MAX_OUTPUT_TOKENS = 400;

const toPerson = async (client: DbClient, tenantId: string, leadId: string, reason: string) => {
  await client.query(
    `update app.leads set state = 'needs_attention', state_reason = $3, state_changed_at = now()
      where tenant_id = $1 and id = $2 and state in ('new', 'clarifying')`,
    [tenantId, leadId, reason],
  );
};

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
    const thread = await client.query<{ direction: 'in' | 'out'; author: string; body: string }>(
      `select m.direction, m.author, m.body from app.messages m
         join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
        where m.tenant_id = $1 and cv.lead_id = $2
        order by m.occurred_at, m.id`,
      [job.tenantId, row.lead_id],
    );
    return { ...row, thread: thread.rows };
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
  const settings = AiSettingsSchema.safeParse(facts.settings ?? {});
  const model = ctx.connectors.ai;
  if (!settings.success || !model) return person('new_message');
  const questions = settings.data.questions ?? [];

  const reply = await model.complete({
    tenantId: job.tenantId,
    system: compileClarifyPrompt({ businessName: facts.business, settings: settings.data }),
    input: clarifyInput(facts.thread.filter((m) => m.direction === 'in').map((m) => m.body)),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!reply.ok) {
    return {
      outcome: { kind: 'failed', error: reply.error },
      apply: async (client, settled) => {
        if (settled.status === 'dead') await toPerson(client, job.tenantId, leadId, 'unsure');
      },
    };
  }

  const output = parseClarifyOutput(reply.value.text, questions.length);
  const asked = askedIndexes(
    facts.thread.filter((m) => m.author === 'ai_question').map((m) => m.body),
    questions,
  );
  const plan: ClarifyPlan = output
    ? planClarify({
        questionCount: questions.length,
        answered: output.answered,
        asked,
        emergency: output.emergency || output.urgency === 'emergency',
        outOfScope: output.out_of_scope,
        priceQuestion: output.price_question,
      })
    : { kind: 'person', reason: 'unsure' };

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await client.query(
        `insert into app.ai_analyses
           (tenant_id, lead_id, input_kind, model, valid, output, input_tokens, output_tokens)
         values ($1, $2, 'text', $3, $4, $5, $6, $7)`,
        [
          job.tenantId,
          leadId,
          reply.value.model,
          output !== null,
          output ? JSON.stringify(output) : null,
          reply.value.inputTokens,
          reply.value.outputTokens,
        ],
      );
      if (output) {
        await client.query(
          `update app.leads
              set summary = coalesce($3, summary), category = coalesce($4, category),
                  urgency = coalesce($5, urgency), address = coalesce($6, address)
            where tenant_id = $1 and id = $2`,
          [job.tenantId, leadId, output.summary, output.category, output.urgency, output.address],
        );
      }
      if (plan.kind === 'person') {
        await toPerson(client, job.tenantId, leadId, plan.reason);
        return;
      }
      if (plan.kind === 'offer') {
        await client.query(
          `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
           values ($1, $2, 'send_slot_offer', $3)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [job.tenantId, leadId, `send_slot_offer:${messageId}`],
        );
        return;
      }
      const queued = await queueQuestionText(
        client,
        job.tenantId,
        leadId,
        questions[plan.question]!,
      );
      if (queued.ok) {
        await client.query(
          `update app.leads set state = 'clarifying', state_reason = null, state_changed_at = now()
            where tenant_id = $1 and id = $2`,
          [job.tenantId, leadId],
        );
      } else if (queued.reason !== 'opted_out') {
        await toPerson(client, job.tenantId, leadId, queued.reason);
      }
    },
  };
};
