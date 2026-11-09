import type { PhoneEvent } from '@fsc/connectors';
import { approverAnswer, approverChoice, formatSlot, type ApproverAnswer } from '@fsc/conversation';
import type { DbClient } from '../db.js';
import { applyAction } from './actions.js';

/**
 * An approver's text reply (SCOPE.md v0.2, step 4). A bare number answers the latest approval
 * request texted to that approver that is still waiting: 1 approves, 2 suggests another time,
 * 3 sends them the customer's number. The decision goes through `applyAction`, exactly as from
 * the portal, recorded as decided by text. Every reply gets a short answer back. Runs inside the
 * intake transaction (CLAUDE.md rule 1); the answer is sent by a queued job.
 */

type TextEvent = Extract<PhoneEvent, { kind: 'text_received' }>;

/** "(319) 555-0142" for a US number; anything else as it is. */
function phoneLabel(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export async function recordApproverReply(
  client: DbClient,
  tenantId: string,
  approverId: string,
  event: TextEvent,
): Promise<void> {
  const waiting = await client.query<{
    request_id: string;
    lead_id: string;
    slot_start: Date;
    name: string | null;
    phone: string | null;
    timezone: string;
  }>(
    `select a.request_id, r.lead_id, r.slot_start, c.display_name as name, c.phone, t.timezone
       from app.approver_texts a
       join app.requests r on r.tenant_id = a.tenant_id and r.id = a.request_id
       join app.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
       join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
       join app.tenants t on t.id = a.tenant_id
      where a.tenant_id = $1 and a.portal_user_id = $2 and a.kind = 'approval_request'
        and r.state = 'pending'
      order by a.occurred_at desc
      limit 1`,
    [tenantId, approverId],
  );
  const request = waiting.rows[0] ?? null;

  await client.query(
    `insert into app.approver_texts
       (tenant_id, portal_user_id, request_id, direction, kind, body, provider_message_id, status,
        occurred_at)
     values ($1, $2, $3, 'in', 'reply', $4, $5, 'received', $6)`,
    [
      tenantId,
      approverId,
      request?.request_id ?? null,
      event.body.trim() || '(a picture or file, not shown)',
      event.messageId,
      event.at,
    ],
  );

  let answer: ApproverAnswer;
  if (!request) {
    answer = { kind: 'nothing_waiting' };
  } else {
    const name = request.name ?? (request.phone ? phoneLabel(request.phone) : 'the customer');
    const choice = approverChoice(event.body);
    if (choice === 'approve' || choice === 'suggest_time') {
      const done = await applyAction(client, tenantId, approverId, request.lead_id, choice, 'text');
      answer = !done.ok
        ? { kind: 'refused', error: done.error === 'not_found' ? 'no_pending_request' : done.error }
        : choice === 'approve'
          ? { kind: 'approved', name, slot: formatSlot(request.slot_start, request.timezone) }
          : { kind: 'suggested', name };
    } else if (choice === 'call') {
      answer = { kind: 'call', name, phone: request.phone ? phoneLabel(request.phone) : null };
    } else {
      answer = { kind: 'help', name };
    }
  }

  const answered = await client.query<{ id: string }>(
    `insert into app.approver_texts
       (tenant_id, portal_user_id, request_id, direction, kind, body, status)
     values ($1, $2, $3, 'out', 'answer', $4, 'queued') returning id`,
    [tenantId, approverId, request?.request_id ?? null, approverAnswer(answer)],
  );
  await client.query(
    `insert into app.jobs (tenant_id, action_type, idempotency_key)
     values ($1, 'send_approver_text', $2)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [tenantId, `send_approver_text:${answered.rows[0]!.id}`],
  );
}
