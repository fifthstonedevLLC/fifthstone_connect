import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import type { JobHandler } from './handler.js';
import { runOnce } from './runner.js';

/**
 * A job whose result cannot be saved must not stop the worker: the rest of the pass still runs,
 * and the failed job stays leased so it is retried later. Local stack, test-only business
 * (`mock-test-resilience`), removed afterwards. Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'bc000000-0000-4000-8000-000000000001';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.jobs limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const ready = await reachable();
if (process.env.FSC_REQUIRE_LOCAL_STACK === '1' && !ready) {
  throw new Error('FSC_REQUIRE_LOCAL_STACK is set but the local stack is not reachable');
}
if (!ready) console.warn('runner resilience tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('worker resilience (local stack)', () => {
  let pool: pg.Pool;

  // Test-only job types: one whose result the database refuses, one that works.
  const handlers: Record<string, JobHandler> = {
    test_unsaveable: async () => ({
      outcome: { kind: 'succeeded' },
      apply: async (client) => {
        await client.query(`select 1 / 0`);
      },
    }),
    test_fine: async () => ({ outcome: { kind: 'succeeded' } }),
  };

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-resilience', 'Resilience Co');
       insert into app.jobs (tenant_id, action_type, idempotency_key, run_at) values
         ('${T}', 'test_unsaveable', 'test_unsaveable:1', now() - interval '2 minutes'),
         ('${T}', 'test_fine', 'test_fine:1', now() - interval '1 minute');`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('carries on with the next job, and leaves the failed one leased to retry', async () => {
    const reports = await runOnce(
      {
        pool,
        connectors: { sms: new MockSmsSender(), calendar: new MockCalendar() },
        now: () => new Date(),
      },
      { handlers, tenantId: T, log: pino({ level: 'silent' }) },
    );
    expect(reports.map((r) => [r.actionType, r.status, r.error])).toEqual([
      ['test_unsaveable', 'failed', 'settle_error'],
      ['test_fine', 'succeeded', null],
    ]);
    const { rows } = await pool.query<{ action_type: string; status: string }>(
      `select action_type, status from app.jobs where tenant_id = $1 order by action_type`,
      [T],
    );
    expect(rows).toEqual([
      { action_type: 'test_fine', status: 'succeeded' },
      { action_type: 'test_unsaveable', status: 'running' },
    ]);
  });
});
