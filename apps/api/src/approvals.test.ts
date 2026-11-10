import { MockPhoneEvents } from '@fsc/connectors/mock';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createPool } from './db.js';

/**
 * Approving by text through the phone webhook, against the local stack with the labeled mock
 * adapter, on a test-only business (`mock-test-approvals`, number 555-0185, approver 555-0186).
 * Removed afterwards (and before starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b6000000-0000-4000-8000-000000000001';
const NUMBER = '+13195550185';
const APPROVER_MOBILE = '+13195550186';
const OWNER_AUTH = 'b6000000-0000-4000-8000-0000000000a1';
const OWNER = 'b6000000-0000-4000-8000-0000000000b1';
const lead = (n: number) => `b6000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `b6000000-0000-4000-8002-00000000000${n}`;
const request = (n: number) => `b6000000-0000-4000-8003-00000000000${n}`;

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
if (!ready) console.warn('approval tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.approver_texts where tenant_id = $1;
     delete from app.calendar_holds where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.inbound_events where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${OWNER_AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('approving by text (local stack, mock adapter, test tenant)', () => {
  let pool: pg.Pool;
  const phone = new MockPhoneEvents();
  let seq = 0;

  /** Someone texts the business number. */
  const textFrom = async (from: string, body: string) => {
    seq += 1;
    const res = await buildApp({
      pool,
      verifyToken: async () => null,
      phoneEvents: phone,
      logger: false,
    }).inject({
      method: 'POST',
      url: '/webhooks/phone',
      ...(() => {
        const r = phone.request({
          kind: 'text_received',
          messageId: `MOCK-SM-APPROVE-${Date.now()}-${seq}`,
          from,
          to: NUMBER,
          body,
          mediaCount: 0,
          at: new Date(),
        });
        return { headers: r.headers as Record<string, string>, payload: r.body };
      })(),
    });
    expect(res.statusCode).toBe(200);
  };
  /** The approver texts the business number; returns the answer queued back to them. */
  const approverSays = async (body: string) => {
    await textFrom(APPROVER_MOBILE, body);
    const { rows } = await pool.query<{ body: string }>(
      `select body from app.approver_texts
        where tenant_id = $1 and kind = 'answer' order by occurred_at desc limit 1`,
      [T],
    );
    return rows[0]?.body;
  };
  const requestState = async (n: number) =>
    (
      await pool.query<{ state: string; decided_via: string | null }>(
        `select state, decided_via from app.requests where id = $1`,
        [request(n)],
      )
    ).rows[0];
  const jobKeys = async (n: number) =>
    (
      await pool.query<{ key: string }>(
        `select idempotency_key as key from app.jobs where lead_id = $1 order by created_at`,
        [lead(n)],
      )
    ).rows.map((r) => r.key.split(':')[0]);

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-approvals', 'Approvals Co');
       insert into auth.users (id, email, aud, role)
         values ('${OWNER_AUTH}', 'owner@approvals.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile,
                                     approves_requests)
         values ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Approvals Owner',
                 '${APPROVER_MOBILE}', true);
       insert into app.tenant_config
         (tenant_id, playbook_key, clinic_minimum_data, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'hvac', false, '[]', 60, '${NUMBER}');
       ${[1, 2]
         .map(
           (n) => `
         insert into app.contacts (id, tenant_id, display_name, phone)
           values ('${contact(n)}', '${T}', 'Customer ${n}', '+1319555018${n + 6}');
         insert into app.leads (id, tenant_id, contact_id, source, state)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call', 'requested');
         insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end)
           values ('${request(n)}', '${T}', '${lead(n)}', now() + interval '${n + 1} days',
                   now() + interval '${n + 1} days 1 hour');
         insert into app.calendar_holds
           (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at)
           values ('${T}', '${request(n)}', 'MOCK-GCAL-APPROVALS', 'MOCK-HOLD-APPROVALS-${n}',
                   now() + interval '${n + 1} days', now() + interval '${n + 1} days 1 hour',
                   now() + interval '1 day');
         -- The approval text for request ${n}, sent ${12 - n * 5} minutes ago.
         insert into app.approver_texts
           (tenant_id, portal_user_id, request_id, direction, kind, body, status, occurred_at)
           values ('${T}', '${OWNER}', '${request(n)}', 'out', 'approval_request',
                   'Customer ${n} picked a time. Reply 1 to approve.', 'sent',
                   now() - interval '${12 - n * 5} minutes');`,
         )
         .join('\n')}`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('answers the latest request: 2 suggests another time, by text', async () => {
    expect(await approverSays('2')).toBe('OK. Customer 2 will be offered other times.');
    expect(await requestState(2)).toEqual({ state: 'changed', decided_via: 'text' });
    expect(await jobKeys(2)).toEqual(['release_hold', 'send_slot_offer']);
  });

  it('then the one still waiting: 3 sends the customer number, anything else explains', async () => {
    expect(await approverSays('3')).toBe('Call Customer 1 at (319) 555-0187.');
    expect(await approverSays('yes please')).toBe(
      'Reply 1 to approve, 2 to suggest another time, or 3 to call Customer 1.',
    );
    expect(await requestState(1)).toEqual({ state: 'pending', decided_via: null });
  });

  it('1 approves, the same as the Front Desk, and then nothing is waiting', async () => {
    // The customer texting while they wait does not take the request out of the Approve queue.
    await textFrom('+13195550187', 'Thanks!');
    expect(await requestState(1)).toEqual({ state: 'pending', decided_via: null });
    expect(await approverSays('1')).toMatch(/^Approved\. Customer 1 is being booked for .+\.$/);
    expect(await requestState(1)).toEqual({ state: 'approved', decided_via: 'text' });
    expect(await jobKeys(1)).toEqual(['confirm_calendar_event']);
    expect(await approverSays('1')).toBe('Nothing is waiting for your approval right now.');
  });

  it("records the approver's texts apart from customers, and never starts a lead", async () => {
    const leads = await pool.query(`select 1 from app.leads where tenant_id = $1`, [T]);
    expect(leads.rowCount).toBe(2);
    const contacts = await pool.query(`select 1 from app.contacts where phone = $1`, [
      APPROVER_MOBILE,
    ]);
    expect(contacts.rowCount).toBe(0);
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from app.approver_texts where tenant_id = $1 and kind = 'reply'`,
      [T],
    );
    expect(Number(rows[0]?.n)).toBe(5);
  });
});
