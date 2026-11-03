/**
 * @fsc/api — HTTP entry point.
 *
 * Phase 0 placeholder. Phase 2 adds the public form endpoint (Turnstile + rate limits),
 * the signed webhook endpoint, and health checks. The API returns success only after the
 * inbound event and its jobs are durably persisted — never after third-party calls.
 */
export const MODULE = 'api' as const;
