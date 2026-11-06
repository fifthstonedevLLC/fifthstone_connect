import { describe, expect, it } from 'vitest';
import { backoffSeconds, errorCode, settleJob } from './settle.js';

const now = new Date('2026-11-05T12:00:00Z');
const noJitter = () => 0.5; // random() * 2 - 1 === 0

describe('backoffSeconds', () => {
  it('doubles from 30 seconds and stops at an hour', () => {
    expect([1, 2, 3, 4].map((a) => backoffSeconds(a, undefined, noJitter))).toEqual([
      30, 60, 120, 240,
    ]);
    expect(backoffSeconds(20, undefined, noJitter)).toBe(3600);
  });

  it('spreads retries by up to the jitter fraction', () => {
    expect(backoffSeconds(1, undefined, () => 0)).toBe(24);
    expect(backoffSeconds(1, undefined, () => 1)).toBe(36);
  });
});

describe('settleJob', () => {
  it('finishes a job that succeeded, keeping the provider reference', () => {
    expect(settleJob({ kind: 'succeeded', externalRef: 'MOCK-CAL-0001' }, 1, 5, now)).toEqual({
      status: 'succeeded',
      runAt: null,
      lastError: null,
      externalRef: 'MOCK-CAL-0001',
      attempt: { outcome: 'succeeded', errorCode: null },
    });
  });

  it('records a skipped job with its reason, not as a failure', () => {
    expect(settleJob({ kind: 'skipped', reason: 'opted_out' }, 1, 5, now)).toMatchObject({
      status: 'skipped',
      lastError: 'opted_out',
      attempt: { outcome: 'succeeded', errorCode: 'opted_out' },
    });
  });

  it('retries a transient failure after the backoff, or the provider wait if longer', () => {
    const error = { kind: 'transient' as const, code: 'rate_limited', message: 'Slow down' };
    const first = settleJob({ kind: 'failed', error }, 1, 5, now, undefined, noJitter);
    expect(first.status).toBe('failed');
    expect(first.runAt?.toISOString()).toBe('2026-11-05T12:00:30.000Z');
    expect(first.lastError).toBe('rate_limited: Slow down');

    const waited = settleJob(
      { kind: 'failed', error: { ...error, retryAfterSeconds: 300 } },
      1,
      5,
      now,
      undefined,
      noJitter,
    );
    expect(waited.runAt?.toISOString()).toBe('2026-11-05T12:05:00.000Z');
  });

  it('dead-letters a permanent failure at once, and a transient one on the last attempt', () => {
    const permanent = settleJob(
      { kind: 'failed', error: { kind: 'permanent', code: 'hold_not_found', message: 'Gone' } },
      1,
      5,
      now,
    );
    expect(permanent).toMatchObject({
      status: 'dead',
      runAt: null,
      lastError: 'hold_not_found: Gone',
    });

    const exhausted = settleJob(
      { kind: 'failed', error: { kind: 'transient', code: 'timeout', message: 'No answer' } },
      5,
      5,
      now,
    );
    expect(exhausted).toMatchObject({ status: 'dead', lastError: 'timeout: retries exhausted' });
  });
});

describe('errorCode', () => {
  it('makes any provider code safe to store', () => {
    expect(errorCode('Rate-Limited 429')).toBe('rate_limited_429');
    expect(errorCode('!')).toBe('error');
  });
});
