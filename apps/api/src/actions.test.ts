import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { createPool } from './db.js';

/**
 * Portal actions against the local stack. Actions write, so these tests never touch the seeded
 * tenants: they create a test-only business (`mock-test-actions`) with one staff login and a lead
 * in each situation, and remove all of it afterwards (also before starting, in case an earlier
 * run was interrupted). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'a7000000-0000-4000-8000-000000000001';
const STAFF_AUTH = 'a7000000-0000-4000-8000-0000000000a1';
const STAFF = 'a7000000-0000-4000-8000-0000000000b1';
const id = (n: number, kind: string) => `a7000000-0000-4000-8${kind}-00000000000${n}`;
const lead = (n: number) => id(n, '001');
const contact = (n: number) => id(n, '002');
const request = (n: number) => id(n, '003');

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
if (!ready) console.warn('apps/api action tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.calendar_holds where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.opt_outs where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${STAFF_AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('portal actions (local stack, test tenant)', () => {
  let pool: pg.Pool;
  const tokens = new Map<string, string>();
  const verify: TokenVerifier = async (token) => tokens.get(token) ?? null;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    const { rows } = await pool.query<{ id: string; email: string }>(
      `select id, email from auth.users where email = 'mara@northline.example.com'`,
    );
    for (const row of rows) tokens.set(row.email, row.id);
    tokens.set('staff@actions.example.com', STAFF_AUTH);

    const leads: [number, string][] = [
      [1, 'requested'], // approve
      [2, 'requested'], // suggest another time
      [3, 'quiet'], // nudge
      [4, 'needs_attention'], // close
      [5, 'booked'], // close refused
      [6, 'requested'], // approve refused: hold lapsed
      [7, 'needs_attention'], // replies refused: opted out
      [8, 'needs_attention'], // replies
    ];
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-actions', 'Actions Test Co');
       insert into auth.users (id, email, aud, role)
         values ('${STAFF_AUTH}', 'staff@actions.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name)
         values ('${STAFF}', '${T}', '${STAFF_AUTH}', 'staff', 'Action Staff');
       ${leads
         .map(
           ([n, state]) => `
         insert into app.contacts (id, tenant_id, display_name, phone)
           values ('${contact(n)}', '${T}', 'Customer ${n}', '+1319555017${n}');
         insert into app.leads (id, tenant_id, contact_id, source, state)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call', '${state}');`,
         )
         .join('\n')}
       ${[1, 2, 6]
         .map(
           (n) => `
         insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end)
           values ('${request(n)}', '${T}', '${lead(n)}', now() + interval '${n * 2} days',
                   now() + interval '${n * 2} days 1 hour');
         insert into app.calendar_holds
           (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at)
           values ('${T}', '${request(n)}', 'MOCK-GCAL-ACTIONS', 'MOCK-CAL-ACT-${n}',
                   now() + interval '${n * 2} days', now() + interval '${n * 2} days 1 hour',
                   now() + interval '${n === 6 ? '-1 hour' : '1 day'}');`,
         )
         .join('\n')}
       insert into app.opt_outs (tenant_id, phone, source)
         values ('${T}', '+13195550177', 'stop_keyword');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({
           missed_call_text_back: 'Sorry we missed your call! Reply STOP to opt out.',
           reply_will_call: 'Thanks, {name}. Someone will call you shortly.',
           reply_need_address: 'Thanks, {name}. Could you text us the address?',
         })}', true);
       insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key, run_at)
         values ('${T}', '${lead(1)}', 'approval_reminder', 'approval_reminder:${lead(1)}',
                 now() + interval '30 minutes');`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  const act = (leadId: string, action: unknown, token = 'staff@actions.example.com') =>
    buildApp({ pool, verifyToken: verify, logger: false }).inject({
      method: 'POST',
      url: `/portal/leads/${leadId}/actions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action },
    });

  it('approve records the decision, queues the calendar event and keeps the lead truthful', async () => {
    const res = await act(lead(1), 'approve');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      state: 'requested',
      request: { state: 'approved', decidedVia: 'portal', decidedByName: 'Action Staff' },
    });
    expect(body.pendingWork).toContainEqual({
      actionType: 'confirm_calendar_event',
      status: 'queued',
    });

    const { rows } = await pool.query(
      `select action_type, status from app.jobs where tenant_id = $1 and lead_id = $2 order by 1`,
      [T, lead(1)],
    );
    expect(rows).toEqual([
      { action_type: 'approval_reminder', status: 'skipped' },
      { action_type: 'confirm_calendar_event', status: 'queued' },
    ]);
    const audit = await pool.query(
      `select action, actor_portal_user_id from app.audit_events where tenant_id = $1`,
      [T],
    );
    expect(audit.rows).toEqual([{ action: 'request.approved', actor_portal_user_id: STAFF }]);
  });

  it('refuses a second approval with 409 and writes nothing', async () => {
    const res = await act(lead(1), 'approve');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'no_pending_request' });
    const audit = await pool.query(
      `select count(*)::int as n from app.audit_events where tenant_id = $1`,
      [T],
    );
    expect(audit.rows[0]).toEqual({ n: 1 });
  });

  it('refuses to approve once the hold has lapsed', async () => {
    const res = await act(lead(6), 'approve');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'hold_expired' });
    const { rows } = await pool.query(`select state from app.requests where id = $1`, [request(6)]);
    expect(rows).toEqual([{ state: 'pending' }]);
  });

  it('suggest another time releases the hold and queues a new offer', async () => {
    const res = await act(lead(2), 'suggest_time');
    expect(res.statusCode).toBe(200);
    expect(res.json().request.state).toBe('changed');
    expect(res.json().pendingWork.map((w: { actionType: string }) => w.actionType)).toEqual([
      'release_hold',
      'send_slot_offer',
    ]);
  });

  it('nudges a quiet lead once', async () => {
    const first = await act(lead(3), 'nudge');
    expect(first.statusCode).toBe(200);
    expect(first.json().pendingWork).toContainEqual({ actionType: 'send_nudge', status: 'queued' });
    const second = await act(lead(3), 'nudge');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'already_nudged' });
  });

  it('closes a lead, but not a booked one', async () => {
    const closed = await act(lead(4), 'close');
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ state: 'closed', reason: 'closed_in_portal' });
    const booked = await act(lead(5), 'close');
    expect(booked.statusCode).toBe(409);
    expect(booked.json()).toEqual({ error: 'booked' });
  });

  it("answers 404 for another business's lead and writes nothing", async () => {
    const res = await act(lead(2), 'close', 'mara@northline.example.com');
    expect(res.statusCode).toBe(404);
    const { rows } = await pool.query(`select state from app.leads where id = $1`, [lead(2)]);
    expect(rows).toEqual([{ state: 'requested' }]);
  });

  it('rejects an unknown action', async () => {
    const res = await act(lead(2), 'reschedule');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('shows decided requests where they now belong on Today', async () => {
    const res = await buildApp({ pool, verifyToken: verify, logger: false }).inject({
      method: 'GET',
      url: '/portal/today',
      headers: { authorization: 'Bearer staff@actions.example.com' },
    });
    const { lanes } = res.json() as {
      lanes: Record<string, { id: string; requestState: string | null }[]>;
    };
    expect(lanes.booked?.find((c) => c.id === lead(1))).toMatchObject({ requestState: 'approved' });
    expect(lanes.waitingOnCustomer?.find((c) => c.id === lead(2))).toMatchObject({
      requestState: 'changed',
    });
    expect(lanes.needsYou?.find((c) => c.id === lead(1))).toBeUndefined();
  });

  const send = (leadId: string, templateKey: string, messageId: string) =>
    buildApp({ pool, verifyToken: verify, logger: false }).inject({
      method: 'POST',
      url: `/portal/leads/${leadId}/replies`,
      headers: { authorization: 'Bearer staff@actions.example.com' },
      payload: { templateKey, messageId },
    });

  const MESSAGE = 'a7000000-0000-4000-8099-000000000001';

  it('offers the reply templates, filled in for this customer', async () => {
    const res = await buildApp({ pool, verifyToken: verify, logger: false }).inject({
      method: 'GET',
      url: `/portal/leads/${lead(8)}`,
      headers: { authorization: 'Bearer staff@actions.example.com' },
    });
    expect(res.json().replyOptions).toEqual([
      { key: 'reply_need_address', body: 'Thanks, Customer. Could you text us the address?' },
      { key: 'reply_will_call', body: 'Thanks, Customer. Someone will call you shortly.' },
    ]);
  });

  it('records a template reply as queued, with its send job and audit event', async () => {
    const res = await send(lead(8), 'reply_will_call', MESSAGE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.at(-1)).toMatchObject({
      id: MESSAGE,
      direction: 'out',
      author: 'template',
      templateKey: 'reply_will_call',
      body: 'Thanks, Customer. Someone will call you shortly.',
      deliveryStatus: 'queued',
    });
    expect(body.pendingWork).toContainEqual({ actionType: 'send_text', status: 'queued' });
    const audit = await pool.query(
      `select detail->>'templateKey' as key from app.audit_events
        where tenant_id = $1 and action = 'lead.replied'`,
      [T],
    );
    expect(audit.rows).toEqual([{ key: 'reply_will_call' }]);
  });

  it('records one message when the same reply is submitted twice', async () => {
    expect((await send(lead(8), 'reply_will_call', MESSAGE)).statusCode).toBe(200);
    const { rows } = await pool.query(
      `select count(*)::int as n from app.messages where tenant_id = $1`,
      [T],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('refuses templates that are not replies', async () => {
    const res = await send(
      lead(8),
      'missed_call_text_back',
      'a7000000-0000-4000-8099-000000000002',
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_reply_template' });
  });

  it('never queues a reply to someone who opted out, and offers none', async () => {
    const res = await send(lead(7), 'reply_will_call', 'a7000000-0000-4000-8099-000000000003');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'opted_out' });
    const page = await buildApp({ pool, verifyToken: verify, logger: false }).inject({
      method: 'GET',
      url: `/portal/leads/${lead(7)}`,
      headers: { authorization: 'Bearer staff@actions.example.com' },
    });
    expect(page.json().replyOptions).toEqual([]);
  });

  it('refuses replies on a closed lead', async () => {
    // Lead 4 was closed earlier in this file.
    const res = await send(lead(4), 'reply_will_call', 'a7000000-0000-4000-8099-000000000004');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'lead_closed' });
  });
});
