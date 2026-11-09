import { textBackValues } from '@fsc/conversation';
import type { LeadState } from '@fsc/core';
import { withTenant } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { aiSettings } from './reading.js';
import { queueTemplateText } from './texts.js';

/**
 * `send_text_back:<lead id>`: the first text to a new caller (every missed call gets one, SCOPE.md
 * v0.2), from the business's `missed_call_text_back` template through `send_text`. Queued by
 * intake after a missed call, or after a voicemail has been transcribed and read.
 *
 * `{need}` comes from the voicemail reading, when there is one and its phrase passed the guard;
 * `{question}` is the owner's first question not yet answered (`textBackValues`). A sentence
 * whose value is missing is left out, never filled with a guess. The lead then waits on the
 * customer as `clarifying`; a lead a person already has (an emergency) keeps its state but still
 * gets the text. If texting is not live, the lead goes to a person to call.
 */
export const sendTextBack: JobHandler = async (job, ctx) => {
  const leadId = keyId(job.idempotencyKey);
  if (!leadId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{
      state: LeadState;
      texted: boolean;
      clinic: boolean;
      settings: unknown;
      reading: { need?: string | null; answered: number[] } | null;
    }>(
      `select l.state, cfg.clinic_minimum_data as clinic,
              exists (select 1 from app.messages m
                        join app.conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
                       where c.tenant_id = l.tenant_id and c.lead_id = l.id and m.direction = 'out')
                as texted,
              (select a.content from app.ai_settings a
                where a.tenant_id = l.tenant_id and a.active) as settings,
              (select a.output from app.ai_analyses a
                where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.valid
                order by a.created_at desc limit 1) as reading
         from app.leads l
         join app.tenant_config cfg on cfg.tenant_id = l.tenant_id
        where l.tenant_id = $1 and l.id = $2`,
      [job.tenantId, leadId],
    );
    return rows[0] ?? null;
  });
  if (!facts) return { outcome: { kind: 'skipped', reason: 'lead_not_found' } };
  // Only the first contact gets the text-back; anything later is already a conversation.
  if (facts.texted || ['closed', 'spam', 'opted_out', 'booked'].includes(facts.state)) {
    return { outcome: { kind: 'skipped', reason: 'already_answered' } };
  }
  const questions = aiSettings(facts.settings)?.questions ?? [];
  // A clinic's text-back never carries anything read from a voicemail (CLAUDE.md rule 13).
  const values = textBackValues(facts.clinic ? null : facts.reading, questions);

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      const queued = await queueTemplateText(
        client,
        job.tenantId,
        leadId,
        'missed_call_text_back',
        values,
        { leaveOutUnfilled: true },
      );
      if (queued.ok) {
        await client.query(
          `update app.leads set state = 'clarifying', state_changed_at = now()
            where tenant_id = $1 and id = $2 and state = 'new'`,
          [job.tenantId, leadId],
        );
        return;
      }
      if (queued.reason === 'opted_out') return;
      await client.query(
        `update app.leads set state = 'needs_attention', state_reason = $3, state_changed_at = now()
          where tenant_id = $1 and id = $2 and state = 'new'`,
        [job.tenantId, leadId, queued.reason],
      );
    },
  };
};
