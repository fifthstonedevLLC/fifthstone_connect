import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce, type RunReport } from './runner.js';

/**
 * The approval text against the local stack with labeled mock connectors, on a test-only
 * business (`mock-test-approval-text`). Removed afterwards (and before starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b7000000-0000-4000-8000-000000000001';
const NUMBER = '+13195550183';
const APPROVER_MOBILE = '+13195550184';
const AUTH = (n: number) => `b7000000-0000-4000-8000-0000000000a${n}`;
const USER = (n: number) => `b7000000-0000-4000-8000-0000000000b${n}`;
const LEAD = 'b7000000-0000-4000-8001-000000000001';
const CONTACT = 'b7000000-0000-4000-8002-000000000001';
const request = (n: number) => `b7000000-0000-4000-8003-00000000000${n}`;

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    const { rowCount } = await client.query(
      `select 1 from information_schema.tables where table_schema = 'app' and table_name = 'approver_texts'`,
    );
    return rowCount === 1;
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
if (!ready) console.warn('approval text tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.approver_texts where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id in ('${AUTH(1)}', '${AUTH(2)}');
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('approval text (local stack, mock connectors)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const log = pino({ level: 'silent' });
  const drain = async () => {
    const all: RunReport[] = [];
    for (let i = 0; i < 4; i++) {
      const reports = await runOnce(
        { pool, connectors: { sms, calendar: new MockCalendar() }, now: () => new Date() },
        { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
      all.push(...reports);
    }
    return all;
  };
  const queue = (n: number) =>
    pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'send_approval_request', $3)`,
      [T, LEAD, `send_approval_request:${request(n)}`],
    );

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    const templates = JSON.stringify({
      approval_request:
        'New request: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
    });
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-approval-text', 'Approval Text Co');
       insert into auth.users (id, email, aud, role) values
         ('${AUTH(1)}', 'owner@approvaltext.example.com', 'authenticated', 'authenticated'),
         ('${AUTH(2)}', 'staff@approvaltext.example.com', 'authenticated', 'authenticated');
       -- The owner approves; staff do not, so only the owner gets the text.
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile,
                                     approves_requests) values
         ('${USER(1)}', '${T}', '${AUTH(1)}', 'owner', 'Owner', '${APPROVER_MOBILE}', true),
         ('${USER(2)}', '${T}', '${AUTH(2)}', 'staff', 'Staff', '+13195550182', false);
       insert into app.tenant_config
         (tenant_id, playbook_key, clinic_minimum_data, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'hvac', false, '[]', 60, '${NUMBER}');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${templates}', true);
       insert into app.contacts (id, tenant_id, display_name, phone)
         values ('${CONTACT}', '${T}', 'Marcus T.', '+13195550181');
       insert into app.leads (id, tenant_id, contact_id, source, state, summary)
         values ('${LEAD}', '${T}', '${CONTACT}', 'missed_call', 'requested',
                 'AC tune-up on a ten-year-old unit.');
       insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end)
         values ('${request(1)}', '${T}', '${LEAD}', '2026-11-12T20:00:00Z', '2026-11-12T21:00:00Z');
       insert into app.requests
         (id, tenant_id, lead_id, slot_start, slot_end, state, decided_by, decided_via, decided_at)
         values ('${request(2)}', '${T}', '${LEAD}', '2026-11-13T20:00:00Z', '2026-11-13T21:00:00Z',
                 'declined', '${USER(1)}', 'portal', now());`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it("texts each approver the owner's approval request, from the business number", async () => {
    await queue(1);
    await drain();
    const sent = sms.sent.filter((s) => s.tenantId === T);
    expect(sent.map((s) => [s.from, s.to, s.body])).toEqual([
      [
        NUMBER,
        APPROVER_MOBILE,
        'New request: AC tune-up on a ten-year-old unit. Marcus T. picked Thu, Nov 12 at 2:00 PM. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      ],
    ]);
    const { rows } = await pool.query<{ status: string; request_id: string }>(
      `select status, request_id from app.approver_texts where tenant_id = $1`,
      [T],
    );
    expect(rows).toEqual([{ status: 'sent', request_id: request(1) }]);
  });

  it('names a caller with no name by their number, so the time is never left out', async () => {
    await pool.query(
      `update app.contacts set display_name = null where id = $1;
       update app.requests set state = 'expired' where id = '${request(1)}';
       insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end)
         values ('${request(3)}', '${T}', '${LEAD}', '2026-11-16T15:00:00Z', '2026-11-16T16:00:00Z');`.replace(
        '$1',
        `'${CONTACT}'`,
      ),
    );
    await queue(3);
    await drain();
    expect(sms.sent.filter((s) => s.tenantId === T).at(-1)?.body).toContain(
      '(319) 555-0181 picked Mon, Nov 16 at 9:00 AM.',
    );
  });

  it('sends nothing for a request already decided', async () => {
    await queue(2);
    const reports = await drain();
    expect(reports.map((r) => [r.status, r.error])).toEqual([['skipped', 'already_decided']]);
  });
});
