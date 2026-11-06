/**
 * How one run of a job settles it. Pure: the worker passes in the handler's outcome, the attempt
 * number and the clock, and writes back what this returns. A transient failure retries with
 * capped exponential backoff and jitter; a permanent failure, or the last allowed attempt,
 * dead-letters the job for an operator (SYSTEM_OVERVIEW.md, error behavior).
 */

export interface HandlerError {
  kind: 'transient' | 'permanent';
  /** Stable machine-readable code, e.g. "rate_limited", "hold_not_found". */
  code: string;
  /** Operator-facing detail. Never message bodies, tokens or other PII. */
  message: string;
  retryAfterSeconds?: number;
}

export type JobOutcome =
  | { kind: 'succeeded'; externalRef?: string }
  /** Nothing to do any more (already done, lead closed, opted out): not an error. */
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: HandlerError };

export interface RetryPolicy {
  baseSeconds: number;
  maxSeconds: number;
  /** Fraction of the delay added or removed at random, so retries do not arrive together. */
  jitter: number;
}

export const DEFAULT_RETRY: RetryPolicy = { baseSeconds: 30, maxSeconds: 3600, jitter: 0.2 };

/** Seconds to wait after a failed attempt (1-based): 30 s, 60 s, 120 s ... capped at an hour. */
export function backoffSeconds(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  random: () => number = Math.random,
): number {
  const raw = Math.min(policy.baseSeconds * 2 ** (attempt - 1), policy.maxSeconds);
  const spread = raw * policy.jitter * (random() * 2 - 1);
  return Math.max(1, Math.round(raw + spread));
}

export interface JobSettlement {
  status: 'succeeded' | 'skipped' | 'failed' | 'dead';
  /** When a failed job runs next; null once the job is finished. */
  runAt: Date | null;
  lastError: string | null;
  externalRef: string | null;
  attempt: { outcome: 'succeeded' | 'failed'; errorCode: string | null };
}

/** Error codes as the database accepts them: lowercase letters, digits and underscores. */
export function errorCode(code: string): string {
  const cleaned = code
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 60);
  return cleaned.length >= 2 ? cleaned : 'error';
}

const detail = (code: string, message: string) => `${code}: ${message}`.slice(0, 500);

export function settleJob(
  outcome: JobOutcome,
  attempt: number,
  maxAttempts: number,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY,
  random: () => number = Math.random,
): JobSettlement {
  if (outcome.kind === 'succeeded') {
    return {
      status: 'succeeded',
      runAt: null,
      lastError: null,
      externalRef: outcome.externalRef ?? null,
      attempt: { outcome: 'succeeded', errorCode: null },
    };
  }
  if (outcome.kind === 'skipped') {
    const code = errorCode(outcome.reason);
    return {
      status: 'skipped',
      runAt: null,
      lastError: code,
      externalRef: null,
      attempt: { outcome: 'succeeded', errorCode: code },
    };
  }

  const { error } = outcome;
  const code = errorCode(error.code);
  const exhausted = attempt >= maxAttempts;
  if (error.kind === 'permanent' || exhausted) {
    return {
      status: 'dead',
      runAt: null,
      lastError: detail(
        code,
        exhausted && error.kind === 'transient' ? 'retries exhausted' : error.message,
      ),
      externalRef: null,
      attempt: { outcome: 'failed', errorCode: code },
    };
  }
  const wait = Math.max(backoffSeconds(attempt, policy, random), error.retryAfterSeconds ?? 0);
  return {
    status: 'failed',
    runAt: new Date(now.getTime() + wait * 1000),
    lastError: detail(code, error.message),
    externalRef: null,
    attempt: { outcome: 'failed', errorCode: code },
  };
}
