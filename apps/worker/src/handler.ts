import type {
  CalendarProvider,
  LanguageModel,
  SmsSender,
  TranscriptionProvider,
} from '@fsc/connectors';
import type { JobOutcome, JobSettlement } from '@fsc/workflow';
import type pg from 'pg';
import type { DbClient } from './db.js';

/** A job the worker has claimed and leased (`app.claim_jobs`). */
export interface ClaimedJob {
  id: string;
  tenantId: string;
  leadId: string | null;
  actionType: string;
  idempotencyKey: string;
  /** This run's attempt number, 1-based. */
  attempt: number;
  correlationId: string;
}

/** Until Phase 4 these are the labeled mocks from `@fsc/connectors/mock` (CLAUDE.md rule 5). */
export interface Connectors {
  sms: SmsSender;
  calendar: CalendarProvider;
  /** The clarify step's model. Without one, customer texts go to a person. */
  ai?: LanguageModel;
  /** Voicemail transcription. Without one, a voicemail's caller gets the plain text-back. */
  transcriber?: TranscriptionProvider;
}

export interface HandlerContext {
  pool: pg.Pool;
  connectors: Connectors;
  now: () => Date;
}

/**
 * What a handler did. `apply` writes its results in the same transaction that settles the job,
 * so a lead is never marked booked by a job that is not marked done, and the other way round.
 * It sees the settlement, so it can act on a job that just died (and do nothing on a retry).
 */
export interface HandlerResult {
  outcome: JobOutcome;
  apply?: (client: DbClient, settlement: JobSettlement) => Promise<void>;
}

/**
 * One job type. A handler reads what it needs in its own short transaction, makes the provider
 * call outside any transaction, and returns its result. Provider calls carry the job's
 * idempotency key, so a job run twice (an expired lease) has its effect once.
 */
export type JobHandler = (job: ClaimedJob, ctx: HandlerContext) => Promise<HandlerResult>;

/** The ID a job's key carries: `send_text:<message id>`, `release_hold:<request id>`. */
export function keyId(idempotencyKey: string): string | null {
  const id = idempotencyKey.split(':')[1] ?? '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
