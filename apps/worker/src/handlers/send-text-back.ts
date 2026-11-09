import type { LeadState } from '@fsc/core';
import { withTenant } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { queueTemplateText } from './texts.js';

/**
 * `send_text_back:<lead id>`, queued by intake when a missed call starts a lead. Every missed
 * call gets a text (SCOPE.md v0.2): the business's `missed_call_text_back` template, queued
 * through `send_text`. Sentences that need a voicemail analysis that has not happened (`{need}`,
 * `{question}`) are left out, never filled with guesses. The lead then waits on the customer as
 * `clarifying`. If texting is not live, the lead goes to a person to call.
 */
export const sendTextBack: JobHandler = async (job, ctx) => {
  const leadId = keyId(job.idempotencyKey);
  if (!leadId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const state = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{ state: LeadState }>(
      `select state from app.leads where tenant_id = $1 and id = $2`,
      [job.tenantId, leadId],
    );
    return rows[0]?.state ?? null;
  });
  if (!state) return { outcome: { kind: 'skipped', reason: 'lead_not_found' } };
  // Only the first contact gets the text-back; anything later is already a conversation.
  if (state !== 'new') return { outcome: { kind: 'skipped', reason: 'already_answered' } };

  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      const queued = await queueTemplateText(
        client,
        job.tenantId,
        leadId,
        'missed_call_text_back',
        {},
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
