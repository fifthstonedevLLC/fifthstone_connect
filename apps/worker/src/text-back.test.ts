import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * The missed-call text-back against the local stack with labeled mock connectors, on a test-only
 * business (`mock-test-textback`). Removed afterwards (and before starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b5000000-0000-4000-8000-000000000001';
const lead = (n: number) => `b5000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `b5000000-0000-4000-8002-00000000000${n}`;

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.tenants limit 1');
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
if (!ready) console.warn('text-back tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('missed-call text-back (local stack, mock connectors)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const log = pino({ level: 'silent' });
  const drain = async () => {
    for (let i = 0; i < 4; i++) {
      const reports = await runOnce(
        { pool, connectors: { sms, calendar: new MockCalendar() }, now: () => new Date() },
        { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
    }
  };
  const state = async (n: number) =>
    (
      await pool.query<{ state: string; state_reason: string | null }>(
        `select state, state_reason from app.leads where id = $1`,
        [lead(n)],
      )
    ).rows[0];
  const queueTextBack = (n: number) =>
    pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'send_text_back', $3)`,
      [T, lead(n), `send_text_back:${lead(n)}`],
    );

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    const templates = JSON.stringify({
      missed_call_text_back:
        'Sorry we missed your call! This is {business}. Sounds like {need}. {question} Reply STOP to opt out.',
    });
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-textback', 'Text Back Co');
       insert into app.tenant_config
         (tenant_id, playbook_key, clinic_minimum_data, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'hvac', false, '[]', 60, '+13195550194');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${templates}', true);
       ${[1, 2]
         .map(
           (n) => `
         insert into app.contacts (id, tenant_id, phone) values ('${contact(n)}', '${T}', '+1319555016${n}');
         insert into app.leads (id, tenant_id, contact_id, source)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call');`,
         )
         .join('\n')}`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it("texts back in the owner's words, leaving out what needs a voicemail analysis", async () => {
    await queueTextBack(1);
    await drain();
    expect(sms.sent.filter((s) => s.tenantId === T).map((s) => s.body)).toEqual([
      'Sorry we missed your call! This is Text Back Co. Reply STOP to opt out.',
    ]);
    expect(await state(1)).toEqual({ state: 'clarifying', state_reason: null });
  });

  it('sends the lead to a person to call when texting is not live', async () => {
    await pool.query(
      `update app.service_registrations set state = 'submitted' where tenant_id = $1`,
      [T],
    );
    await queueTextBack(2);
    await drain();
    expect(await state(2)).toEqual({ state: 'needs_attention', state_reason: 'texting_not_live' });
    expect(sms.sent.filter((s) => s.tenantId === T)).toHaveLength(1);
  });
});
