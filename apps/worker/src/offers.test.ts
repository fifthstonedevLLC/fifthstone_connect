import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce, type RunReport } from './runner.js';

/**
 * The offer step against the local stack with labeled mock connectors: times offered by text, a
 * numbered reply held as a request, an unclear reply sent to a person, a taken time re-offered,
 * and an emergency never offered times. Runs on a test-only business (`mock-test-offers`) and
 * claims only its jobs; the business is removed afterwards. Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b3000000-0000-4000-8000-000000000001';
const OWNER_AUTH = 'b3000000-0000-4000-8000-0000000000a1';
const OWNER = 'b3000000-0000-4000-8000-0000000000b1';
const CALENDAR_ID = 'MOCK-GCAL-OFFERS';
const lead = (n: number) => `b3000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `b3000000-0000-4000-8002-00000000000${n}`;

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    const { rowCount } = await client.query(
      `select 1 from information_schema.tables where table_schema = 'app' and table_name = 'slot_offers'`,
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
if (!ready) console.warn('offer tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.slot_offers where tenant_id = $1;
     delete from app.calendar_holds where tenant_id = $1;
     delete from app.requests where tenant_id = $1;
     delete from app.calendar_busy where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.calendar_connections where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id = '${OWNER_AUTH}';
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('offer step (local stack, mock connectors, test tenant)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const calendar = new MockCalendar();
  const log = pino({ level: 'silent' });
  const pass = () =>
    runOnce(
      { pool, connectors: { sms, calendar }, now: () => new Date() },
      { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
    );
  /** Passes until no job is left: an offer queues its text, a pick queues another. */
  const drain = async () => {
    const all: RunReport[] = [];
    for (let i = 0; i < 6; i++) {
      const reports = await pass();
      if (reports.length === 0) break;
      all.push(...reports);
    }
    return all;
  };
  const queueJob = (n: number, actionType: string, key: string) =>
    pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, $3, $4)`,
      [T, lead(n), actionType, key],
    );
  const leadRow = async (n: number) =>
    (
      await pool.query<{ state: string; state_reason: string | null }>(
        `select state, state_reason from app.leads where id = $1`,
        [lead(n)],
      )
    ).rows[0];
  const openOffers = async (n: number) =>
    (
      await pool.query<{ choice: number; slot_start: Date; slot_end: Date }>(
        `select choice, slot_start, slot_end from app.slot_offers
          where lead_id = $1 and state = 'open' order by choice`,
        [lead(n)],
      )
    ).rows;
  /** The customer texts back; the inbound step will record this and queue the job. */
  const reply = async (n: number, body: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
       select $1, c.id, 'in', 'customer', $3, 'received'
         from app.conversations c where c.tenant_id = $1 and c.lead_id = $2
       returning id`,
      [T, lead(n), body],
    );
    await queueJob(n, 'handle_offer_reply', `handle_offer_reply:${rows[0]!.id}`);
  };

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    // Open every day 07:00–19:00, so there are always times to offer whenever this runs.
    const hours = JSON.stringify([{ days: [1, 2, 3, 4, 5, 6, 7], open: '07:00', close: '19:00' }]);
    const templates = JSON.stringify({
      slot_offer: 'Here are open times. Reply with a number: {slots}',
      request_received: 'Got it, {slot} is requested. We will confirm shortly.',
    });
    // 1 picks a time, 2 asks a question, 3 picks a time that was just taken, 4 is an emergency.
    const urgencies = ['this_week', 'flexible', 'flexible', 'emergency'];
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-offers', 'Offers Test Co');
       insert into auth.users (id, email, aud, role)
         values ('${OWNER_AUTH}', 'owner@offers.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name)
         values ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Offers Owner');
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '${hours}', 60, '+13195550197');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${templates}', true);
       insert into app.calendar_connections (tenant_id, provider, calendar_id, status, connected_at)
         values ('${T}', 'google', '${CALENDAR_ID}', 'connected', now());
       ${urgencies
         .map(
           (urgency, i) => `
         insert into app.contacts (id, tenant_id, display_name, phone)
           values ('${contact(i + 1)}', '${T}', 'Customer ${i + 1}', '+1319555018${i + 1}');
         insert into app.leads (id, tenant_id, contact_id, source, state, urgency, category)
           values ('${lead(i + 1)}', '${T}', '${contact(i + 1)}', 'missed_call', 'clarifying',
                   '${urgency}', 'furnace_repair');`,
         )
         .join('\n')}`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('offers three numbered times by text, spread across days, and never an emergency', async () => {
    for (const n of [1, 2, 3, 4])
      await queueJob(n, 'send_slot_offer', `send_slot_offer:${lead(n)}`);
    const reports = await drain();
    const offers = reports.filter((r) => r.actionType === 'send_slot_offer');
    expect(offers.map((r) => r.status).sort()).toEqual([
      'skipped',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(offers.find((r) => r.status === 'skipped')?.error).toBe('emergency');

    for (const n of [1, 2, 3]) {
      expect((await leadRow(n))?.state).toBe('offered');
      const open = await openOffers(n);
      expect(open.map((o) => o.choice)).toEqual([1, 2, 3]);
      // Every time is at least two hours away and on a different day for the business (Chicago).
      for (const o of open) expect(o.slot_start.getTime()).toBeGreaterThan(Date.now() + 7_100_000);
      const chicagoDay = (d: Date) =>
        d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      expect(new Set(open.map((o) => chicagoDay(o.slot_start))).size).toBe(3);
    }
    expect((await leadRow(4))?.state).toBe('clarifying');

    const sent = sms.sent.filter((s) => s.tenantId === T);
    expect(sent).toHaveLength(3);
    for (const text of sent)
      expect(text.body).toMatch(/^Here are open times\. Reply with a number: 1\) .+ 2\) .+ 3\) /);
  });

  it('turns a numbered reply into a held request, not a booking', async () => {
    const picked = (await openOffers(1))[1]!;
    await reply(1, ' 2 ');
    await drain();

    expect(await leadRow(1)).toEqual({ state: 'requested', state_reason: null });
    const { rows } = await pool.query<{
      state: string;
      slot_start: Date;
      hold_state: string;
      expires_at: Date;
    }>(
      `select r.state, r.slot_start, h.state as hold_state, h.expires_at
         from app.requests r join app.calendar_holds h on h.request_id = r.id
        where r.lead_id = $1`,
      [lead(1)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'pending', hold_state: 'active' });
    expect(rows[0]?.slot_start.toISOString()).toBe(picked.slot_start.toISOString());
    expect(rows[0]!.expires_at.getTime()).toBeLessThan(picked.slot_start.getTime());
    expect(await openOffers(1)).toEqual([]);
    expect(calendar.entriesFor(T).filter((e) => e.kind === 'hold')).toHaveLength(1);
    expect(sms.sent.filter((s) => s.tenantId === T).at(-1)?.body).toMatch(
      /^Got it, .+ is requested\./,
    );
    // If nobody decides: a reminder after the approval window, and expiry when the hold runs out.
    const timers = await pool.query<{ action_type: string; run_at: Date; status: string }>(
      `select action_type, run_at, status from app.jobs
        where lead_id = $1 and action_type in ('approval_reminder', 'expire_hold')
        order by run_at`,
      [lead(1)],
    );
    const expiry = timers.rows.find((j) => j.action_type === 'expire_hold');
    expect(expiry?.run_at.getTime()).toBe(rows[0]!.expires_at.getTime());
    expect(expiry?.status).toBe('queued');
    for (const j of timers.rows.filter((r) => r.action_type === 'approval_reminder')) {
      expect(j.run_at.getTime()).toBeLessThan(rows[0]!.expires_at.getTime());
    }
  });

  it('sends anything but a number to a person', async () => {
    await reply(2, 'Do you have anything Saturday?');
    await drain();
    expect(await leadRow(2)).toEqual({ state: 'needs_attention', state_reason: 'unclear_reply' });
  });

  it('offers fresh times when the picked one was taken, and not that time again', async () => {
    const first = (await openOffers(3))[0]!;
    // Something new on the owner's calendar since the offer, not yet synced.
    calendar.addEvent(T, CALENDAR_ID, { start: first.slot_start, end: first.slot_end }, 'Dentist');
    await reply(3, '1');
    await drain();

    expect((await leadRow(3))?.state).toBe('offered');
    const fresh = await openOffers(3);
    expect(fresh).toHaveLength(3);
    expect(fresh.some((o) => o.slot_start.getTime() === first.slot_start.getTime())).toBe(false);
    const requests = await pool.query(`select 1 from app.requests where lead_id = $1`, [lead(3)]);
    expect(requests.rowCount).toBe(0);
  });

  it('offers fresh times for an answer that came too late for its time', async () => {
    // The customer took days to answer: the first time has passed.
    await pool.query(
      `update app.slot_offers set slot_start = now() - interval '2 hours',
              slot_end = now() - interval '1 hour'
        where lead_id = $1 and state = 'open' and choice = 1`,
      [lead(3)],
    );
    await reply(3, '1');
    await drain();
    expect((await leadRow(3))?.state).toBe('offered');
    const fresh = await openOffers(3);
    expect(fresh).toHaveLength(3);
    expect(fresh.every((o) => o.slot_start.getTime() > Date.now())).toBe(true);
    const requests = await pool.query(`select 1 from app.requests where lead_id = $1`, [lead(3)]);
    expect(requests.rowCount).toBe(0);
  });

  it('never holds a time another customer already picked, even if the calendar would', async () => {
    // Customer 1 holds a time; customer 3 was offered the same one in their own text.
    const held = await pool.query<{ slot_start: Date; slot_end: Date }>(
      `select slot_start, slot_end from app.requests where lead_id = $1`,
      [lead(1)],
    );
    await pool.query(
      `update app.slot_offers set slot_start = $2, slot_end = $3
        where lead_id = $1 and state = 'open' and choice = 2`,
      [lead(3), held.rows[0]!.slot_start, held.rows[0]!.slot_end],
    );
    const holdsBefore = calendar.entriesFor(T).filter((e) => e.kind === 'hold').length;
    await reply(3, '2');
    await drain();
    expect((await leadRow(3))?.state).toBe('offered');
    expect(calendar.entriesFor(T).filter((e) => e.kind === 'hold')).toHaveLength(holdsBefore);
    const requests = await pool.query(`select 1 from app.requests where lead_id = $1`, [lead(3)]);
    expect(requests.rowCount).toBe(0);
  });
});
