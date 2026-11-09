import {
  clarifyInput,
  compileClarifyPrompt,
  parseClarifyOutput,
  type ClarifyOutput,
} from '@fsc/ai';
import type { LanguageModel, ModelResponse } from '@fsc/connectors';
import { askedIndexes, planClarify, type ClarifyPlan } from '@fsc/conversation';
import { AiSettingsSchema, type AiSettings } from '@fsc/core';
import type { DbClient } from '../db.js';
import { queueQuestionText } from './texts.js';

/**
 * Reading a customer's words with the language model, shared by the clarify step (texts) and
 * voicemail transcription. The model sees the customer's words only as fenced data inside the
 * locked safety layer; its output is validated before anything uses it (CLAUDE.md rule 10).
 */

const MAX_OUTPUT_TOKENS = 400;

export function aiSettings(raw: unknown): AiSettings | null {
  const parsed = AiSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export type Reading =
  | { ok: true; response: ModelResponse; output: ClarifyOutput | null }
  | { ok: false; error: { kind: 'transient' | 'permanent'; code: string; message: string } };

/** Asks the model about the customer's words. A malformed answer is `output: null`. */
export async function readCustomer(
  model: LanguageModel,
  input: { tenantId: string; businessName: string; settings: AiSettings; words: string[] },
): Promise<Reading> {
  const reply = await model.complete({
    tenantId: input.tenantId,
    system: compileClarifyPrompt({ businessName: input.businessName, settings: input.settings }),
    input: clarifyInput(input.words),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!reply.ok) return { ok: false, error: reply.error };
  const questions = input.settings.questions ?? [];
  return {
    ok: true,
    response: reply.value,
    output: parseClarifyOutput(reply.value.text, questions.length),
  };
}

/** Stores the reading in `app.ai_analyses`, and its validated facts on the lead. */
export async function storeReading(
  client: DbClient,
  tenantId: string,
  leadId: string,
  inputKind: 'text' | 'voicemail',
  reading: Extract<Reading, { ok: true }>,
): Promise<void> {
  const { response, output } = reading;
  await client.query(
    `insert into app.ai_analyses
       (tenant_id, lead_id, input_kind, model, valid, output, input_tokens, output_tokens)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tenantId,
      leadId,
      inputKind,
      response.model,
      output !== null,
      output ? JSON.stringify(output) : null,
      response.inputTokens,
      response.outputTokens,
    ],
  );
  if (output) {
    await client.query(
      `update app.leads
          set summary = coalesce($3, summary), category = coalesce($4, category),
              urgency = coalesce($5, urgency), address = coalesce($6, address)
        where tenant_id = $1 and id = $2`,
      [tenantId, leadId, output.summary, output.category, output.urgency, output.address],
    );
  }
}

/** What to do next, from a reading and the questions already sent. */
export function planFromReading(
  output: ClarifyOutput | null,
  questions: readonly string[],
  sentBodies: readonly string[],
): ClarifyPlan {
  if (!output) return { kind: 'person', reason: 'unsure' };
  return planClarify({
    questionCount: questions.length,
    answered: output.answered,
    asked: askedIndexes(sentBodies, questions),
    emergency: output.emergency || output.urgency === 'emergency',
    outOfScope: output.out_of_scope,
    priceQuestion: output.price_question,
  });
}

export async function toPerson(
  client: DbClient,
  tenantId: string,
  leadId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `update app.leads set state = 'needs_attention', state_reason = $3, state_changed_at = now()
      where tenant_id = $1 and id = $2 and state in ('new', 'clarifying')`,
    [tenantId, leadId, reason],
  );
}

/**
 * Carries out a plan: ask the owner's next question word for word, queue the offer, or hand the
 * lead to a person. `offerKey` makes the offer job unique to what prompted it.
 */
export async function applyPlan(
  client: DbClient,
  tenantId: string,
  leadId: string,
  plan: ClarifyPlan,
  questions: readonly string[],
  offerKey: string,
): Promise<void> {
  if (plan.kind === 'person') {
    await toPerson(client, tenantId, leadId, plan.reason);
    return;
  }
  if (plan.kind === 'offer') {
    await client.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'send_slot_offer', $3)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, leadId, `send_slot_offer:${offerKey}`],
    );
    return;
  }
  const queued = await queueQuestionText(client, tenantId, leadId, questions[plan.question]!);
  if (queued.ok) {
    await client.query(
      `update app.leads set state = 'clarifying', state_reason = null, state_changed_at = now()
        where tenant_id = $1 and id = $2`,
      [tenantId, leadId],
    );
  } else if (queued.reason !== 'opted_out') {
    await toPerson(client, tenantId, leadId, queued.reason);
  }
}
