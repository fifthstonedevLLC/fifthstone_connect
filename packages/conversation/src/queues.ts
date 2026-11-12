import type { Need } from './next-step.js';
import { priorityOf, type PriorityFacts } from './priority.js';

/**
 * Work queues: leads grouped by what they need, so a person can work one kind of task at a
 * time. "Act now" comes first: every lead at the red priority level (someone may be at risk, a
 * time is about to be lost, or it has waited longer than the business allows), whatever its task.
 * Each lead also sits in exactly one task queue. A lead's need comes from `nextStep`, so the
 * queues always agree with the action the server will accept.
 */

export const QUEUES = [
  { key: 'act_now', needs: [], owner: true },
  { key: 'approve', needs: ['approve'], owner: true },
  { key: 'reply', needs: ['reply'], owner: true },
  { key: 'call_back', needs: ['call_now', 'call_back'], owner: true },
  { key: 'reschedule', needs: ['reschedule', 'cancel'], owner: true },
  { key: 'listen', needs: ['listen'], owner: true },
  { key: 'review', needs: ['review'], owner: true },
  { key: 'follow_up', needs: ['follow_up'], owner: true },
  { key: 'waiting', needs: ['their_move', 'nudged'], owner: false },
  { key: 'booked', needs: ['confirming', 'booked'], owner: false },
] as const satisfies readonly { key: string; needs: readonly Need[]; owner: boolean }[];

export type QueueKey = (typeof QUEUES)[number]['key'];

export const DEFAULT_QUEUE: QueueKey = 'act_now';

export function isQueueKey(value: string | null): value is QueueKey {
  return QUEUES.some((q) => q.key === value);
}

/** Whether a queue's next move belongs to the business rather than the customer. */
export function isOwnerQueue(queue: QueueKey): boolean {
  return QUEUES.find((q) => q.key === queue)?.owner ?? false;
}

/** Whether a lead belongs in a queue. Act now depends on the clock, so `now` comes in. */
export function inQueue(queue: QueueKey, lead: PriorityFacts, now: Date = new Date()): boolean {
  if (queue === 'act_now') return priorityOf(lead, now).level === 'now';
  const found = QUEUES.find((q) => q.key === queue);
  return (found?.needs as readonly Need[] | undefined)?.includes(lead.need) ?? false;
}

/** The task queue a need belongs to, never the Act now roll-up. */
export function queueFor(need: Need): QueueKey {
  return (
    QUEUES.find((q) => q.key !== 'act_now' && (q.needs as readonly Need[]).includes(need))?.key ??
    'waiting'
  );
}

export interface Queueable {
  urgent: boolean;
  /** When the lead entered its current state (ISO 8601). */
  waitingSince: string;
  /** The held or booked slot, if any (ISO 8601). */
  slotStart: string | null;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/**
 * The order to work a queue in. Business queues: anyone at risk first, then whoever has waited
 * longest. Waiting on the customer: the most recent first. Booked: the soonest appointment first.
 */
export function orderForQueue<T>(
  queue: QueueKey,
  items: readonly T[],
  get: (item: T) => Queueable,
): T[] {
  const sorted = [...items];
  if (queue === 'booked') {
    return sorted.sort((a, b) => time(get(a).slotStart) - time(get(b).slotStart));
  }
  if (queue === 'waiting') {
    return sorted.sort((a, b) => time(get(b).waitingSince) - time(get(a).waitingSince));
  }
  return sorted.sort(
    (a, b) =>
      Number(get(b).urgent) - Number(get(a).urgent) ||
      time(get(a).waitingSince) - time(get(b).waitingSince),
  );
}
