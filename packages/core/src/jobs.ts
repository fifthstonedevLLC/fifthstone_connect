/**
 * Action jobs: the side effects queued for each lead. Executed by the worker.
 * The idempotency key is unique per tenant so a lead gets each action at most once.
 */

export const ACTION_TYPES = [
  'send_acknowledgment',
  'send_owner_alert',
  'append_sheet_row',
  'send_staff_reminder',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const JOB_STATUSES = [
  'queued', // waiting for runAt
  'running', // claimed by a worker under a lease
  'succeeded',
  'failed', // last attempt failed; will retry at runAt
  'dead', // attempts exhausted or permanent error; needs operator review
  'skipped', // no longer applicable (tenant disabled, lead resolved)
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['succeeded', 'dead', 'skipped'];

export interface ActionJob {
  id: string;
  tenantId: string;
  leadId: string;
  type: ActionType;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  /** Provider reference (SES message ID, Sheets row range) once known. */
  externalRef: string | null;
  correlationId: string;
}

/** Stable key: one action of each type per lead. Reminders are one per lead in MVP. */
export function actionKey(leadId: string, type: ActionType): string {
  return `${type}:${leadId}`;
}

/** Actions queued at intake. The reminder is scheduled separately at its due time. */
export const INTAKE_ACTIONS: readonly ActionType[] = [
  'send_acknowledgment',
  'send_owner_alert',
  'append_sheet_row',
];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}
