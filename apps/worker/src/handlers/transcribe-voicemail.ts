import { detectHazard } from '@fsc/conversation';
import type { LeadState } from '@fsc/core';
import { withTenant, type DbClient } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { leadWords } from './clarify-lead.js';
import {
  aiSettings,
  applyPlan,
  planFromReading,
  queueEmergencyAlert,
  readCustomer,
  storeReading,
  toPerson,
  type Reading,
} from './reading.js';

/**
 * `transcribe_voicemail:<voicemail id>`, queued by intake for a voicemail. The recording is transcribed, then read with the customer's texts by the
 * same model step as the clarify step, inside the locked safety layer. Then:
 *
 * - a new caller gets the text-back, which can now say what they need ("Sounds like …") and ask
 *   only what the voicemail did not answer; if the voicemail answered everything, times are
 *   offered right after;
 * - a caller who already got the text-back is asked the next question, offered times, or handed
 *   to a person, exactly as for a text.
 *
 * If the recording cannot be transcribed, or the transcript is unclear, the caller still gets
 * the plain text-back and the recording stays on the lead page to listen to.
 */

/** Below this, a transcript is kept for the lead page but not read. */
export const MIN_TRANSCRIPT_CONFIDENCE = 0.6;

async function queueTextBack(client: DbClient, tenantId: string, leadId: string): Promise<void> {
  await client.query(
    `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
     values ($1, $2, 'send_text_back', $3)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, leadId, `send_text_back:${leadId}`],
  );
}

export const transcribeVoicemail: JobHandler = async (job, ctx) => {
  const voicemailId = keyId(job.idempotencyKey);
  if (!voicemailId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      recording_ref: string;
      transcript: string | null;
      lead_id: string;
      state: LeadState;
      business: string;
      settings: unknown;
    }>(
      `select v.recording_ref, v.transcript, c.lead_id, l.state, t.name as business,
              (select a.content from app.ai_settings a
                where a.tenant_id = v.tenant_id and a.active) as settings
         from app.voicemails v
         join app.calls c on c.tenant_id = v.tenant_id and c.id = v.call_id
         join app.leads l on l.tenant_id = c.tenant_id and l.id = c.lead_id
         join app.tenants t on t.id = v.tenant_id
        where v.tenant_id = $1 and v.id = $2`,
      [job.tenantId, voicemailId],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, ...(await leadWords(client, job.tenantId, row.lead_id)) };
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'voicemail_not_found' } };
  if (facts.transcript !== null)
    return { outcome: { kind: 'skipped', reason: 'already_transcribed' } };
  const leadId = facts.lead_id;
  const textBackWhenNew = async (client: DbClient) => {
    if (facts.state === 'new') await queueTextBack(client, job.tenantId, leadId);
  };

  const transcriber = ctx.connectors.transcriber;
  if (!transcriber) {
    return {
      outcome: {
        kind: 'failed',
        error: { kind: 'permanent', code: 'no_transcriber', message: 'No transcription provider' },
      },
      apply: textBackWhenNew,
    };
  }
  const heard = await transcriber.transcribe({
    tenantId: job.tenantId,
    recordingRef: facts.recording_ref,
    idempotencyKey: job.idempotencyKey,
  });
  if (!heard.ok) {
    return {
      outcome: { kind: 'failed', error: heard.error },
      apply: async (client, settled) => {
        if (settled.status === 'dead') await textBackWhenNew(client);
      },
    };
  }
  const transcript = heard.value;
  const saveTranscript = (client: DbClient) =>
    client.query(
      `update app.voicemails set transcript = $3, transcript_confidence = $4
        where tenant_id = $1 and id = $2 and transcript is null`,
      [job.tenantId, voicemailId, transcript.text.slice(0, 10_000), transcript.confidence],
    );

  const settings = aiSettings(facts.settings);
  const model = ctx.connectors.ai;
  const clear = transcript.confidence >= MIN_TRANSCRIPT_CONFIDENCE && transcript.text.trim() !== '';

  // A hazard in what they said comes first: the fixed safety or crisis message and an alert to the
  // approvers (`send_safety_message`), instead of the text-back and questions.
  if (clear && detectHazard(transcript.text)) {
    return {
      outcome: { kind: 'succeeded' },
      apply: async (client, settled) => {
        if (settled.status !== 'succeeded') return;
        await saveTranscript(client);
        await client.query(
          `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
           values ($1, $2, 'send_safety_message', $3)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [job.tenantId, leadId, `send_safety_message:${voicemailId}`],
        );
      },
    };
  }
  const reading: Reading | null =
    clear && settings && model
      ? await readCustomer(model, {
          tenantId: job.tenantId,
          businessName: facts.business,
          settings,
          words: [transcript.text, ...facts.words],
        })
      : null;

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await saveTranscript(client);
      if (!reading?.ok || !settings) {
        await textBackWhenNew(client);
        return;
      }
      await storeReading(client, job.tenantId, leadId, 'voicemail', reading);
      const questions = settings.questions ?? [];
      const plan = planFromReading(reading.output, questions, facts.sent);
      if (facts.state === 'new') {
        // Risk goes in front of a person now; the caller still gets the text-back.
        if (plan.kind === 'person') {
          await toPerson(client, job.tenantId, leadId, plan.reason);
          if (plan.reason === 'emergency') await queueEmergencyAlert(client, job.tenantId, leadId);
        }
        await queueTextBack(client, job.tenantId, leadId);
        if (plan.kind === 'offer') {
          await applyPlan(client, job.tenantId, leadId, plan, questions, voicemailId);
        }
        return;
      }
      if (facts.state === 'clarifying') {
        await applyPlan(client, job.tenantId, leadId, plan, questions, voicemailId);
      }
    },
  };
};
