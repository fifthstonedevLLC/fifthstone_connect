/**
 * @fsc/workflow — durable job queue, retries, idempotency.
 *
 * Phase 0 placeholder. Phase 3 adds lease-based job claiming (FOR UPDATE SKIP LOCKED),
 * capped attempts, exponential backoff with jitter, and dead-letter status.
 */
export const MODULE = 'workflow' as const;
