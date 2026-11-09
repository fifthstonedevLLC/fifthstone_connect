import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * The calendar sync against the local stack with a labeled mock calendar. Runs on a test-only
 * business (`mock-test-sync`) and claims only its jobs; the business is removed afterwards (and
 * before starting, in case an earlier run was interrupted). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b2000000-0000-4000-8000-000000000001';
const CONNECTED = 'b2000000-0000-4000-8000-0000000000c1';
const DISCONNECTED = 'b2000000-0000-4000-8000-0000000000c2';
const CALENDAR_ID = 'MOCK-GCAL-SYNC';
const OWNER_AUTH = 'b2000000-0000-4000-8000-0000000000a1';
const OWNER = 'b2000000-0000-4000-8000-0000000000b1';
const CONTACT = 'b2000000-0000-4000-8002-000000000001';
const LEAD = 'b2000000-0000-4000-8001-000000000001';
const REQUEST = 'b2000000-0000-4000-8003-000000000001';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    const { rowCount } = await client.query(
      `select 1 from pg_proc where proname = 'schedule_calendar_syncs'`,
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
if (!ready) console.warn('calendar sync tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.calendar_busy where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.calendar_connections where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${OWNER_AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('calendar sync (local stack, mock calendar, test tenant)', () => {
  let pool: pg.Pool;
  let calendar: MockCalendar;
  const log = pino({ level: 'silent' });
  const hour = 3_600_000;
  // Whole hours from the start of this hour, so ranges compare exactly.
  const base = new Date(Math.floor(Date.now() / hour) * hour);
  const at = (hours: number) => new Date(base.getTime() + hours * hour);

  const schedule = async () =>
    (await pool.query<{ n: number }>(`select app.schedule_calendar_syncs(15, $1) as n`, [T]))
      .rows[0]?.n;
  const pass = () =>
    runOnce(
      { pool, connectors: { sms: new MockSmsSender(), calendar }, now: () => new Date() },
      { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
    );
  const stored = async () =>
    (
      await pool.query<{ s: Date; e: Date }>(
        `select starts_at as s, ends_at as e from app.calendar_busy
          where tenant_id = $1 order by starts_at`,
        [T],
      )
    ).rows.map((r) => [r.s.toISOString(), r.e.toISOString()]);

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-sync', 'Sync Test Co');
       insert into auth.users (id, email, aud, role)
         values ('${OWNER_AUTH}', 'owner@sync.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name)
         values ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Sync Owner');
       insert into app.tenant_config
         (tenant_id, playbook_key, clinic_minimum_data, business_hours, default_job_minutes)
         values ('${T}', 'hvac', false, '[]', 60);
       insert into app.calendar_connections (id, tenant_id, provider, calendar_id, status, connected_at)
         values ('${CONNECTED}', '${T}', 'google', '${CALENDAR_ID}', 'connected', now()),
                ('${DISCONNECTED}', '${T}', 'microsoft', 'MOCK-OUTLOOK-SYNC', 'disconnected', null);
       insert into app.contacts (id, tenant_id, display_name, phone)
         values ('${CONTACT}', '${T}', 'Customer 1', '+13195550196');
       insert into app.leads (id, tenant_id, contact_id, source, state, category)
         values ('${LEAD}', '${T}', '${CONTACT}', 'missed_call', 'requested', 'furnace_repair');`,
    );
    // This service's approved job, tomorrow from hour 26 to 27.
    await pool.query(
      `insert into app.requests
         (id, tenant_id, lead_id, slot_start, slot_end, state, decided_by, decided_via, decided_at)
       values ($1, $2, $3, $4, $5, 'approved', $6, 'portal', now())`,
      [REQUEST, T, LEAD, at(26), at(27), OWNER],
    );
  });

  beforeEach(async () => {
    calendar = new MockCalendar();
    await pool.query(
      `delete from app.job_attempts where tenant_id = '${T}'; delete from app.jobs where tenant_id = '${T}';`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('queues one sync per connected calendar per period, never doubled', async () => {
    expect(await schedule()).toBe(1);
    expect(await schedule()).toBe(0);
    const { rows } = await pool.query<{ key: string }>(
      `select idempotency_key as key from app.jobs where tenant_id = $1`,
      [T],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key.startsWith(`sync_calendar:${CONNECTED}:`)).toBe(true);
  });

  it("stores the owner's busy time, not this service's own job, and replaces the last read", async () => {
    // A stale busy time from an earlier read, no longer on the calendar.
    await pool.query(
      `insert into app.calendar_busy (tenant_id, connection_id, starts_at, ends_at)
       values ($1, $2, $3, $4)`,
      [T, CONNECTED, at(50), at(51)],
    );
    // On the calendar: a personal event tomorrow 24–25, and our job's event right after it,
    // touching a second personal event 27–28 (a free/busy read may report these merged).
    calendar.addEvent(T, CALENDAR_ID, { start: at(24), end: at(25) }, 'Dentist');
    calendar.addEvent(T, CALENDAR_ID, { start: at(26), end: at(27) }, 'Furnace repair');
    calendar.addEvent(T, CALENDAR_ID, { start: at(27), end: at(28) }, 'School pickup');

    await schedule();
    const reports = await pass();
    expect(reports.map((r) => [r.actionType, r.status])).toEqual([['sync_calendar', 'succeeded']]);
    expect(await stored()).toEqual([
      [at(24).toISOString(), at(25).toISOString()],
      [at(27).toISOString(), at(28).toISOString()],
    ]);
    const { rows } = await pool.query<{ synced: Date | null }>(
      `select last_synced_at as synced from app.calendar_connections where id = $1`,
      [CONNECTED],
    );
    expect(rows[0]?.synced).not.toBeNull();
  });

  it('marks the calendar revoked when the business withdraws access, and stops', async () => {
    calendar.revokeAccess(T);
    await schedule();
    const reports = await pass();
    expect(reports.map((r) => [r.status, r.error])).toEqual([['dead', 'auth_revoked']]);
    const { rows } = await pool.query<{ status: string }>(
      `select status from app.calendar_connections where id = $1`,
      [CONNECTED],
    );
    expect(rows[0]?.status).toBe('revoked');
    const audit = await pool.query(
      `select 1 from app.audit_events where tenant_id = $1 and action = 'calendar.revoked'`,
      [T],
    );
    expect(audit.rowCount).toBe(1);
    // No more syncs are queued for a revoked calendar.
    expect(await schedule()).toBe(0);
  });

  it("never touches another business's busy times", async () => {
    const others = async () =>
      (
        await pool.query<{ n: string }>(
          `select count(*) as n from app.calendar_busy where tenant_id <> $1`,
          [T],
        )
      ).rows[0]?.n;
    const before = await others();
    await pool.query(`update app.calendar_connections set status = 'connected' where id = $1`, [
      CONNECTED,
    ]);
    await schedule();
    await pass();
    expect(await others()).toBe(before);
  });
});
