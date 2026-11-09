import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * The worker against the local stack, with labeled mock connectors. Runs on a test-only business
 * (`mock-test-worker`) and claims only its jobs, so other test files' jobs are never touched. The
 * business is removed afterwards (and before starting, in case an earlier run was interrupted).
 * Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b1000000-0000-4000-8000-000000000001';
const BUSINESS = 'Worker Test Co';
const OWNER_AUTH = 'b1000000-0000-4000-8000-0000000000a1';
const OWNER = 'b1000000-0000-4000-8000-0000000000b1';
const id = (n: number, kind: string) => `b1000000-0000-4000-8${kind}-00000000000${n}`;
const lead = (n: number) => id(n, '001');
const contact = (n: number) => id(n, '002');
const request = (n: number) => id(n, '003');
const message = (n: number) => id(n, '004');
const conversation = (n: number) => id(n, '005');

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query(`select 1 from pg_proc where proname = 'claim_jobs' and pronargs = 4`);
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
if (!ready) console.warn('apps/worker tests skipped: local Supabase stack is not running');

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
     delete from app.service_registrations where tenant_id = $1;
     delete from app.calendar_connections where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${OWNER_AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('worker (local stack, mock connectors, test tenant)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const calendar = new MockCalendar();
  const log = pino({ level: 'silent' });
  const pass = () =>
    runOnce(
      { pool, connectors: { sms, calendar }, now: () => new Date() },
      { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
    );
  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await pool.query<T & pg.QueryResultRow>(sql, params)).rows[0];

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    // Leads: 1 approved (confirm), 2 changed (release), 3 opted out (text skipped),
    // 4 a queued reply (text sent), 5 approved but its hold is gone (booking fails).
    const leads: [number, string][] = [
      [1, 'requested'],
      [2, 'offered'],
      [3, 'needs_attention'],
      [4, 'needs_attention'],
      [5, 'requested'],
    ];
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-worker', '${BUSINESS}');
       insert into auth.users (id, email, aud, role)
         values ('${OWNER_AUTH}', 'owner@worker.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name)
         values ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Worker Owner');
       insert into app.tenant_config
         (tenant_id, playbook_key, clinic_minimum_data, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'hvac', false, '[]', 60, '+13195550192');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.calendar_connections (tenant_id, provider, calendar_id, status, connected_at)
         values ('${T}', 'google', 'MOCK-GCAL-WORKER', 'connected', now());
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({
           confirmation: "You''re booked with {business} for {slot}. Reply STOP to opt out.",
         })}', true);
       ${leads
         .map(
           ([n, state]) => `
         insert into app.contacts (id, tenant_id, display_name, phone)
           values ('${contact(n)}', '${T}', 'Customer ${n}', '+1319555019${n + 2}');
         insert into app.leads (id, tenant_id, contact_id, source, state, category)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call', '${state}', 'furnace_repair');`,
         )
         .join('\n')}
       ${[1, 2, 5]
         .map(
           (n) => `
         insert into app.requests
           (id, tenant_id, lead_id, slot_start, slot_end, state, decided_by, decided_via,
            decided_at)
           values ('${request(n)}', '${T}', '${lead(n)}',
                   date_trunc('hour', now()) + interval '${n * 24} hours',
                   date_trunc('hour', now()) + interval '${n * 24 + 1} hours',
                   '${n === 2 ? 'changed' : 'approved'}', '${OWNER}', 'portal', now());
         insert into app.calendar_holds
           (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, state,
            expires_at)
           values ('${T}', '${request(n)}', 'MOCK-GCAL-WORKER', 'MOCK-CAL-WORKER-${n}',
                   date_trunc('hour', now()) + interval '${n * 24} hours',
                   date_trunc('hour', now()) + interval '${n * 24 + 1} hours',
                   '${n === 5 ? 'released' : 'active'}', now() + interval '1 day');`,
         )
         .join('\n')}
       ${[3, 4]
         .map(
           (n) => `
         insert into app.conversations (id, tenant_id, lead_id, channel)
           values ('${conversation(n)}', '${T}', '${lead(n)}', 'sms');
         insert into app.messages
           (id, tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
           values ('${message(n)}', '${T}', '${conversation(n)}', 'out', 'template',
                   'reply_will_call', 'Thanks. Someone will call you shortly.', 'queued');`,
         )
         .join('\n')}
       -- Customer 3 replied STOP after the reply was queued.
       insert into app.opt_outs (tenant_id, phone, source)
         values ('${T}', '+13195550195', 'stop_keyword');
       insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key) values
         ('${T}', '${lead(1)}', 'confirm_calendar_event', 'confirm_calendar_event:${request(1)}'),
         ('${T}', '${lead(2)}', 'release_hold', 'release_hold:${request(2)}'),
         ('${T}', '${lead(3)}', 'send_text', 'send_text:${message(3)}'),
         ('${T}', '${lead(4)}', 'send_text', 'send_text:${message(4)}'),
         ('${T}', '${lead(5)}', 'confirm_calendar_event', 'confirm_calendar_event:${request(5)}'),
         ('${T}', '${lead(1)}', 'approval_reminder', 'approval_reminder:${lead(1)}');`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('runs every due job it has a handler for, and leaves the rest queued', async () => {
    const reports = await pass();
    const byKey = Object.fromEntries(
      await Promise.all(
        reports.map(async (r) => [
          (await one<{ k: string }>(`select idempotency_key as k from app.jobs where id = $1`, [
            r.jobId,
          ]))!.k,
          `${r.status}${r.error ? ` ${r.error}` : ''}`,
        ]),
      ),
    );
    expect(byKey).toEqual({
      [`confirm_calendar_event:${request(1)}`]: 'succeeded',
      [`release_hold:${request(2)}`]: 'succeeded',
      [`send_text:${message(3)}`]: 'skipped opted_out',
      [`send_text:${message(4)}`]: 'succeeded',
      [`confirm_calendar_event:${request(5)}`]: 'dead hold_not_found',
    });
    expect(
      await one(`select status, attempts from app.jobs where idempotency_key = $1`, [
        `approval_reminder:${lead(1)}`,
      ]),
    ).toEqual({ status: 'queued', attempts: 0 });
  });

  it('books an approved lead: hold converted, lead booked, confirmation queued', async () => {
    expect(await one(`select state from app.leads where id = $1`, [lead(1)])).toEqual({
      state: 'booked',
    });
    expect(
      await one(`select state from app.calendar_holds where request_id = $1`, [request(1)]),
    ).toEqual({ state: 'converted' });
    expect(calendar.entriesFor(T).find((e) => e.ref === 'MOCK-CAL-WORKER-1')?.kind).toBe('event');
    const confirmation = await one<{ id: string; body: string; delivery_status: string }>(
      `select m.id, m.body, m.delivery_status from app.messages m
         join app.conversations c on c.id = m.conversation_id
        where c.lead_id = $1 and m.template_key = 'confirmation'`,
      [lead(1)],
    );
    expect(confirmation?.delivery_status).toBe('queued');
    expect(confirmation?.body).toMatch(
      /^You're booked with Worker Test Co for \w{3}, \w{3} \d+ at /,
    );
    expect(
      await one(`select action from app.audit_events where subject_id = $1`, [lead(1)]),
    ).toEqual({ action: 'lead.booked' });
  });

  it('releases a hold, sends a reply, and never texts someone who opted out', async () => {
    expect(
      await one(`select state from app.calendar_holds where request_id = $1`, [request(2)]),
    ).toEqual({ state: 'released' });
    const sent = await one<{ delivery_status: string; provider_message_id: string }>(
      `select delivery_status, provider_message_id from app.messages where id = $1`,
      [message(4)],
    );
    expect(sent?.delivery_status).toBe('sent');
    expect(sent?.provider_message_id).toMatch(/^MOCK-SM-/);
    expect(
      await one(`select delivery_status from app.messages where id = $1`, [message(3)]),
    ).toEqual({ delivery_status: 'failed' });
    expect(sms.sent.map((t) => t.to)).toEqual(['+13195550196']);
  });

  it('sends a person a lead it could not book, and records each attempt', async () => {
    expect(await one(`select state, state_reason from app.leads where id = $1`, [lead(5)])).toEqual(
      { state: 'needs_attention', state_reason: 'booking_failed' },
    );
    expect(
      await one<{ n: string }>(
        `select count(*) as n from app.job_attempts a join app.jobs j on j.id = a.job_id
          where j.tenant_id = $1`,
        [T],
      ),
    ).toEqual({ n: '5' });
  });

  it('sends the confirmation on the next pass, then finds nothing left to do', async () => {
    const reports = await pass();
    expect(reports.map((r) => [r.actionType, r.status])).toEqual([['send_text', 'succeeded']]);
    expect(sms.sent.at(-1)?.body).toMatch(/^You're booked with Worker Test Co/);
    expect(await pass()).toEqual([]);
  });

  it('retries a transient failure later, and succeeds once the provider recovers', async () => {
    await pool.query(
      `update app.messages set delivery_status = 'queued', provider_message_id = null
        where id = $1`,
      [message(4)],
    );
    await pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'send_text', $3)`,
      [T, lead(4), `send_text:${message(4)}:retry`],
    );
    // The key must carry the message ID first; the suffix makes it a new job for this test.
    sms.failNext({ kind: 'transient', code: 'rate_limited', message: 'Slow down' });
    const first = await pass();
    expect(first.map((r) => [r.status, r.error])).toEqual([['failed', 'rate_limited']]);
    const job = await one<{ status: string; due_later: boolean }>(
      `select status, run_at > now() + interval '20 seconds' as due_later from app.jobs
        where idempotency_key = $1`,
      [`send_text:${message(4)}:retry`],
    );
    expect(job).toEqual({ status: 'failed', due_later: true });

    expect(await pass()).toEqual([]); // not due yet
    await pool.query(`update app.jobs set run_at = now() where idempotency_key = $1`, [
      `send_text:${message(4)}:retry`,
    ]);
    const second = await pass();
    expect(second.map((r) => r.status)).toEqual(['succeeded']);
    expect(
      await one(`select attempts from app.jobs where idempotency_key = $1`, [
        `send_text:${message(4)}:retry`,
      ]),
    ).toEqual({ attempts: 2 });
  });
});
