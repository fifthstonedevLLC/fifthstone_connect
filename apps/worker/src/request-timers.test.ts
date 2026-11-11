import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce, type RunReport } from './runner.js';

/**
 * Approval reminders and hold expiry against the local stack with labeled mock connectors, on a
 * test-only business (`mock-test-timers`) that approves by text. Removed afterwards (and before
 * starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'ba000000-0000-4000-8000-000000000001';
const NUMBER = '+13195550178';
const APPROVER = '+13195550177';
const AUTH = 'ba000000-0000-4000-8000-0000000000a1';
const OWNER = 'ba000000-0000-4000-8000-0000000000b1';
const lead = (n: number) => `ba000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `ba000000-0000-4000-8002-00000000000${n}`;
const request = (n: number) => `ba000000-0000-4000-8003-00000000000${n}`;

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.approver_texts limit 1');
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
if (!ready) console.warn('request timer tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.approver_texts where tenant_id = $1;
     delete from app.calendar_holds where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('approval reminders and hold expiry (local stack, mocks)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const calendar = new MockCalendar();
  const log = pino({ level: 'silent' });
  const drain = async () => {
    const all: RunReport[] = [];
    for (let i = 0; i < 4; i++) {
      const reports = await runOnce(
        { pool, connectors: { sms, calendar }, now: () => new Date() },
        { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
      all.push(...reports);
    }
    return all;
  };
  const queue = (n: number, action: string) =>
    pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, $3, $4)`,
      [T, lead(n), action, `${action}:${request(n)}`],
    );
  const toApprover = () =>
    sms.sent.filter((s) => s.tenantId === T && s.to === APPROVER).map((s) => s.body);

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    // 1 waits (reminder), 2 was approved, 3's hold has run out, 4's hold runs out later. Each is
    // on its own day: two active holds can never overlap on one calendar.
    const requests: [number, string, string][] = [
      [1, 'pending', `now() + interval '1 day'`],
      [2, 'approved', `now() + interval '1 day'`],
      [3, 'pending', `now() - interval '1 minute'`],
      [4, 'pending', `now() + interval '1 hour'`],
    ];
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-timers', 'Timers Co');
       insert into auth.users (id, email, aud, role)
         values ('${AUTH}', 'owner@timers.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile,
                                     approves_requests)
         values ('${OWNER}', '${T}', '${AUTH}', 'owner', 'Timers Owner', '${APPROVER}', true);
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '[]', 60, '${NUMBER}');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       ${requests
         .map(
           ([n, state, expires]) => `
         insert into app.contacts (id, tenant_id, display_name, phone)
           values ('${contact(n)}', '${T}', 'Customer ${n}', '+1319555017${n}');
         insert into app.leads (id, tenant_id, contact_id, source, state)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call', 'requested');
         insert into app.requests
           (id, tenant_id, lead_id, slot_start, slot_end, state, decided_by, decided_via, decided_at)
           values ('${request(n)}', '${T}', '${lead(n)}', '2026-11-${19 + n}T15:00:00Z', '2026-11-${19 + n}T16:00:00Z',
                   '${state}', ${state === 'approved' ? `'${OWNER}', 'portal', now()` : 'null, null, null'});
         insert into app.calendar_holds
           (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at)
           values ('${T}', '${request(n)}', 'MOCK-GCAL-TIMERS', 'MOCK-HOLD-TIMERS-${n}',
                   '2026-11-${19 + n}T15:00:00Z', '2026-11-${19 + n}T16:00:00Z', ${expires});`,
         )
         .join('\n')}`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('reminds the approvers once while a request waits, and a bare "1" still answers it', async () => {
    await queue(1, 'approval_reminder');
    await drain();
    expect(toApprover()).toEqual([
      'Reminder: Customer 1 is still waiting on Fri, Nov 20 at 9:00 AM. Reply 1 to approve, 2 to suggest another time, 3 to call.',
    ]);
    const { rows } = await pool.query<{ kind: string; request_id: string }>(
      `select kind, request_id from app.approver_texts where tenant_id = $1`,
      [T],
    );
    expect(rows).toEqual([{ kind: 'approval_request', request_id: request(1) }]);
  });

  it('does nothing once someone has decided', async () => {
    await queue(2, 'approval_reminder');
    const reports = await drain();
    expect(reports.map((r) => [r.status, r.error])).toEqual([['skipped', 'already_decided']]);
  });

  it('releases a hold that ran out, and puts the lead in front of a person', async () => {
    await queue(3, 'approval_reminder'); // overtaken by the expiry
    await queue(3, 'expire_hold');
    await drain();
    const state = await pool.query<{ request: string; hold: string; lead: string; reason: string }>(
      `select r.state as request, h.state as hold, l.state as lead, l.state_reason as reason
         from app.requests r
         join app.calendar_holds h on h.request_id = r.id
         join app.leads l on l.id = r.lead_id
        where r.id = $1`,
      [request(3)],
    );
    expect(state.rows[0]).toEqual({
      request: 'expired',
      hold: 'released',
      lead: 'needs_attention',
      reason: 'hold_expired',
    });
    expect(calendar.entriesFor(T).some((e) => e.ref === 'MOCK-HOLD-TIMERS-3')).toBe(false);
    expect(toApprover().at(-1)).toBe(
      'The hold on Sun, Nov 22 at 9:00 AM for Customer 3 ran out with no approval, so the time was released. It is on the Front Desk.',
    );
    const audit = await pool.query(
      `select 1 from app.audit_events where tenant_id = $1 and action = 'request.expired'`,
      [T],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('leaves a hold that has not run out yet', async () => {
    await queue(4, 'expire_hold');
    const reports = await drain();
    expect(reports.map((r) => [r.status, r.error])).toEqual([['skipped', 'not_due']]);
  });
});
