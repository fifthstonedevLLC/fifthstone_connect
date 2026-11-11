import { MockPhoneEvents } from '@fsc/connectors/mock';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createPool } from './db.js';

/**
 * The phone webhook against the local stack with the labeled mock adapter: signed mock events
 * for a test-only business (`mock-test-intake`, number 555-0198). The business is removed
 * afterwards (and before starting, in case an earlier run was interrupted). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b4000000-0000-4000-8000-000000000001';
const NUMBER = '+13195550198';
const caller = (n: number) => `+1319555017${n}`;

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
if (!ready) console.warn('webhook tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.jobs where tenant_id = $1;
     delete from app.slot_offers where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.voicemails where tenant_id = $1;
     delete from app.calls where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.inbound_events where tenant_id = $1;
     delete from app.opt_outs where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('phone webhook (local stack, mock adapter, test tenant)', () => {
  let pool: pg.Pool;
  const phone = new MockPhoneEvents();
  let seq = 0;
  const id = (prefix: string) => `${prefix}-INTAKE-${Date.now()}-${(seq += 1)}`;

  const post = async (request: { headers: Record<string, string | undefined>; body: string }) =>
    buildApp({ pool, verifyToken: async () => null, phoneEvents: phone, logger: false }).inject({
      method: 'POST',
      url: '/webhooks/phone',
      headers: request.headers as Record<string, string>,
      payload: request.body,
    });
  const missedCall = (from: string, callId = id('MOCK-CA')) =>
    post(phone.request({ kind: 'missed_call', callId, from, to: NUMBER, at: new Date() }));
  const text = (from: string, body: string) =>
    post(
      phone.request({
        kind: 'text_received',
        messageId: id('MOCK-SM'),
        from,
        to: NUMBER,
        body,
        mediaCount: 0,
        at: new Date(),
      }),
    );
  const leadOf = async (from: string) =>
    (
      await pool.query<{ id: string; state: string; state_reason: string | null; source: string }>(
        `select l.id, l.state, l.state_reason, l.source from app.leads l
           join app.contacts c on c.id = l.contact_id
          where l.tenant_id = $1 and c.phone = $2 order by l.created_at desc`,
        [T, from],
      )
    ).rows;
  const jobsOf = async (leadId: string) =>
    (
      await pool.query<{ action_type: string; idempotency_key: string }>(
        `select action_type, idempotency_key from app.jobs where lead_id = $1 order by created_at`,
        [leadId],
      )
    ).rows;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-intake', 'Intake Test Co');
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '[]', 60, '${NUMBER}');`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('rejects an unsigned request and a malformed event, storing nothing', async () => {
    const signed = phone.request({
      kind: 'missed_call',
      callId: id('MOCK-CA'),
      from: caller(1),
      to: NUMBER,
      at: new Date(),
    });
    const unsigned = await post({ ...signed, headers: { 'content-type': 'application/json' } });
    expect(unsigned.statusCode).toBe(403);
    const malformed = await post({ ...signed, body: '{"kind":"missed_call"}' });
    expect(malformed.statusCode).toBe(400);
    expect(await leadOf(caller(1))).toEqual([]);
  });

  it('answers a call to a number that is not a business the same way, storing nothing', async () => {
    const res = await post(
      phone.request({
        kind: 'missed_call',
        callId: id('MOCK-CA'),
        from: caller(1),
        to: '+13195550189',
        at: new Date(),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(await leadOf(caller(1))).toEqual([]);
  });

  it('starts a lead from a missed call and queues the text-back, once per call', async () => {
    const callId = id('MOCK-CA');
    expect((await missedCall(caller(1), callId)).statusCode).toBe(200);
    expect((await missedCall(caller(1), callId)).statusCode).toBe(200); // a provider retry
    const leads = await leadOf(caller(1));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ state: 'new', source: 'missed_call' });
    expect(await jobsOf(leads[0]!.id)).toEqual([
      { action_type: 'send_text_back', idempotency_key: `send_text_back:${leads[0]!.id}` },
    ]);
    const calls = await pool.query(`select 1 from app.calls where lead_id = $1`, [leads[0]!.id]);
    expect(calls.rowCount).toBe(1);
  });

  it('joins a second call and a voicemail to the open lead, transcribing the voicemail', async () => {
    const callId = id('MOCK-CA');
    await missedCall(caller(1), callId);
    await post(
      phone.request({
        kind: 'voicemail',
        callId,
        from: caller(1),
        to: NUMBER,
        recordingRef: 'MOCK-RECORDING-1',
        durationSeconds: 22,
        at: new Date(),
      }),
    );
    const leads = await leadOf(caller(1));
    expect(leads).toHaveLength(1);
    // The second call texts nothing; the voicemail is queued to be transcribed and read.
    expect((await jobsOf(leads[0]!.id)).map((j) => j.action_type)).toEqual([
      'send_text_back',
      'transcribe_voicemail',
    ]);
    const voicemails = await pool.query(
      `select v.transcript from app.voicemails v join app.calls c on c.id = v.call_id
        where c.lead_id = $1`,
      [leads[0]!.id],
    );
    expect(voicemails.rows).toEqual([{ transcript: null }]);
  });

  it('puts a text on a booked lead in front of a person', async () => {
    const lead = (await leadOf(caller(1)))[0]!;
    await pool.query(`update app.leads set state = 'booked' where id = $1`, [lead.id]);
    await text(caller(1), 'Running ten minutes late');
    expect((await leadOf(caller(1)))[0]).toMatchObject({
      state: 'needs_attention',
      state_reason: 'new_message',
    });
    await pool.query(`update app.leads set state = 'clarifying' where id = $1`, [lead.id]);
  });

  it('sends a reply to open times to the offer step', async () => {
    const lead = (await leadOf(caller(1)))[0]!;
    await pool.query(`update app.leads set state = 'offered' where id = $1`, [lead.id]);
    await text(caller(1), '2');
    const jobs = await jobsOf(lead.id);
    expect(jobs.at(-1)?.action_type).toBe('handle_offer_reply');
    expect((await leadOf(caller(1)))[0]?.state).toBe('offered');
  });

  it('starts a lead from a first text and sends it to the clarify step', async () => {
    await text(caller(2), 'Do you service heat pumps?');
    const lead = (await leadOf(caller(2)))[0]!;
    expect(lead).toMatchObject({ state: 'new', state_reason: null, source: 'text' });
    expect((await jobsOf(lead.id)).map((j) => j.action_type)).toEqual(['clarify_lead']);
    const thread = await pool.query<{ body: string; direction: string }>(
      `select m.body, m.direction from app.messages m
         join app.conversations c on c.id = m.conversation_id
         join app.leads l on l.id = c.lead_id
         join app.contacts ct on ct.id = l.contact_id
        where ct.phone = $1 and ct.tenant_id = $2`,
      [caller(2), T],
    );
    expect(thread.rows).toEqual([{ body: 'Do you service heat pumps?', direction: 'in' }]);
  });

  it('puts a gas smell in front of a person before anything else, with no AI step', async () => {
    await text(caller(4), 'I smell gas in the basement, what do I do');
    const lead = (await leadOf(caller(4)))[0]!;
    expect(lead).toMatchObject({ state: 'needs_attention', state_reason: 'safety_message_sent' });
    expect((await jobsOf(lead.id)).map((j) => j.action_type)).toEqual(['send_safety_message']);
  });

  it('honors STOP at once and START after it, without starting a lead', async () => {
    await text(caller(2), 'Stop');
    expect((await leadOf(caller(2)))[0]).toMatchObject({ state: 'opted_out' });
    const optOut = async () =>
      (
        await pool.query<{ opted_in_at: Date | null }>(
          `select opted_in_at from app.opt_outs where tenant_id = $1 and phone = $2`,
          [T, caller(2)],
        )
      ).rows[0];
    expect(await optOut()).toEqual({ opted_in_at: null });

    await text(caller(3), 'STOP');
    expect(await leadOf(caller(3))).toEqual([]);

    await text(caller(2), 'START');
    expect((await optOut())?.opted_in_at).not.toBeNull();
    expect(await leadOf(caller(2))).toHaveLength(1);
  });
});
