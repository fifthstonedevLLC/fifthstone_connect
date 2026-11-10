import type { ActionError } from './actions.js';
import { parseChoice } from './offers.js';

/**
 * Approving by text (SCOPE.md v0.2, step 4). Each approver gets one text per request from the
 * owner's `approval_request` template ("Reply 1 to approve, 2 to suggest another time, 3 to
 * call"). Their numbered reply takes the same action as the Front Desk; nothing is guessed from
 * other words. The short answers back to the approver are fixed wording here: they go to the
 * business's own people, never to a customer.
 */

export const APPROVER_CHOICES = { 1: 'approve', 2: 'suggest_time', 3: 'call' } as const;
export type ApproverChoice = (typeof APPROVER_CHOICES)[keyof typeof APPROVER_CHOICES];

/** What a reply from an approver asks for, or null when it is not 1, 2 or 3. */
export function approverChoice(body: string): ApproverChoice | null {
  const n = parseChoice(body, 3);
  return n === null ? null : APPROVER_CHOICES[n as 1 | 2 | 3];
}

export type ApproverAnswer =
  | { kind: 'approved'; name: string; slot: string }
  | { kind: 'suggested'; name: string }
  | { kind: 'call'; name: string; phone: string | null }
  | { kind: 'help'; name: string }
  | { kind: 'nothing_waiting' }
  /** Sent once after the approval window, while the request still waits. */
  | { kind: 'reminder'; name: string; slot: string }
  /** The hold ran out with nobody approving; the request is on the Front Desk. */
  | { kind: 'lapsed'; name: string; slot: string }
  | { kind: 'refused'; error: ActionError };

/** One period at the end, even after an initial ("Marcus T."). */
const end = (text: string) => (text.endsWith('.') ? text : `${text}.`);

/** The text back to an approver after their reply, or a reminder or notice from the engine. */
export function approverAnswer(answer: ApproverAnswer): string {
  switch (answer.kind) {
    case 'approved':
      return `Approved. ${answer.name} is being booked for ${answer.slot}.`;
    case 'suggested':
      return `OK. ${answer.name} will be offered other times.`;
    case 'call':
      return answer.phone
        ? `Call ${answer.name} at ${answer.phone}.`
        : `${answer.name} has no phone number on file. Open the Front Desk.`;
    case 'help':
      return end(`Reply 1 to approve, 2 to suggest another time, or 3 to call ${answer.name}`);
    case 'nothing_waiting':
      return 'Nothing is waiting for your approval right now.';
    case 'reminder':
      return `Reminder: ${answer.name} is still waiting on ${answer.slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.`;
    case 'lapsed':
      return `The hold on ${answer.slot} for ${answer.name} ran out with no approval, so the time was released. It is on the Front Desk.`;
    case 'refused':
      return answer.error === 'hold_expired'
        ? 'That time is no longer held. Open the Front Desk to sort it out.'
        : 'That request was already handled. Open the Front Desk to see where it stands.';
  }
}
