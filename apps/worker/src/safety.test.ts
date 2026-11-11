import { MockCalendar, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * Fixed safety and crisis messages against the local stack with labeled mock connectors, on two
 * test-only businesses: an HVAC company (`mock-test-safety`) and a tattoo studio
 * (`mock-test-safety-studio`). Removed afterwards (and before starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const HVAC = 'bb000000-0000-4000-8000-000000000001';
const STUDIO = 'bb000000-0000-4000-8000-000000000002';
const tenants = [HVAC, STUDIO];
const ids = (t: number, kind: string, n: number) =>
  `bb000000-0000-4000-8${kind}-000000000${t}0${n}`;
const lead = (t: number, n: number) => ids(t, '001', n);
const contact = (t: number, n: number) => ids(t, '002', n);
const conversation = (t: number, n: number) => ids(t, '003', n);
const message = (t: number, n: number) => ids(t, '004', n);
const approverAuth = (t: number) => ids(t, '005', 1);
const approver = (t: number) => ids(t, '006', 1);
const APPROVER_MOBILE = ['+13195550175', '+13195550174'];
const NUMBER = ['+13195550173', '+13195550172'];

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query(`insert into app.approver_texts (tenant_id, portal_user_id, direction, kind, body, status)
      select null, null, 'out', 'alert', 'x', 'queued' where false`);
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
if (!ready) console.warn('safety tests skipped: local Supabase stack is not running');

async function removeTestTenants(pool: pg.Pool) {
  for (const [i, t] of tenants.entries()) {
    await pool.query(
      `delete from app.job_attempts where tenant_id = $1;
       delete from app.jobs where tenant_id = $1;
       delete from app.approver_texts where tenant_id = $1;
       delete from app.opt_outs where tenant_id = $1;
       delete from app.messages where tenant_id = $1;
       delete from app.conversations where tenant_id = $1;
       delete from app.leads where tenant_id = $1;
       delete from app.contacts where tenant_id = $1;
       delete from app.service_registrations where tenant_id = $1;
       delete from app.tenant_config where tenant_id = $1;
       delete from app.portal_users where tenant_id = $1;
       delete from auth.users where id = '${approverAuth(i + 1)}';
       delete from app.tenants where id = $1;`.replaceAll('$1', `'${t}'`),
    );
  }
}

describe.skipIf(!ready)('safety and crisis messages (local stack, mocks)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const log = pino({ level: 'silent' });
  const drain = async (tenantId: string) => {
    for (let i = 0; i < 4; i++) {
      const reports = await runOnce(
        { pool, connectors: { sms, calendar: new MockCalendar() }, now: () => new Date() },
        { handlers: HANDLERS, tenantId, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
    }
  };
  const textsTo = (phone: string) => sms.sent.filter((s) => s.to === phone).map((s) => s.body);
  const queue = (t: number, n: number, action: string, id: string) =>
    pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key) values ($1, $2, $3, $4)`,
      [tenants[t - 1], lead(t, n), action, `${action}:${id}`],
    );
  const leadRow = async (t: number, n: number) =>
    (
      await pool.query<{ state: string; state_reason: string | null; urgency: string | null }>(
        `select state, state_reason, urgency from app.leads where id = $1`,
        [lead(t, n)],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenants(pool);
    // Customer words: 1 gas (HVAC), 2 a quiet "might be at risk" (HVAC, via the clarify step),
    // 3 crisis language (studio), 4 gas from someone who opted out (HVAC).
    const said = [
      [1, 1, "There's a strong gas smell by the furnace"],
      [1, 2, 'My elderly mom has no heat'],
      [2, 3, "I don't know if I can keep going."],
      [1, 4, 'I smell gas'],
    ] as const;
    const setup = tenants
      .map(
        (t, i) => `
      insert into app.tenants (id, slug, name) values
        ('${t}', '${i === 0 ? 'mock-test-safety' : 'mock-test-safety-studio'}', '${i === 0 ? 'Safety Heating' : 'Safety Ink'}');
      insert into auth.users (id, email, aud, role)
        values ('${approverAuth(i + 1)}', 'owner${i}@safety.example.com', 'authenticated', 'authenticated');
      insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile, approves_requests)
        values ('${approver(i + 1)}', '${t}', '${approverAuth(i + 1)}', 'owner', 'Owner', '${APPROVER_MOBILE[i]}', true);
      insert into app.tenant_config
        (tenant_id, playbook_key, business_hours, default_job_minutes, connect_number)
        values ('${t}', '${i === 0 ? 'service_call' : 'studio_appointment'}', '[]', 60, '${NUMBER[i]}');
      insert into app.service_registrations (tenant_id, service, state) values ('${t}', 'texting', 'approved');`,
      )
      .join('\n');
    const people = said
      .map(
        ([t, n, words]) => `
      insert into app.contacts (id, tenant_id, display_name, phone)
        values ('${contact(t, n)}', '${tenants[t - 1]}', 'Caller ${n}', '+1319555016${n}');
      insert into app.leads (id, tenant_id, contact_id, source, state)
        values ('${lead(t, n)}', '${tenants[t - 1]}', '${contact(t, n)}', 'text', 'new');
      insert into app.conversations (id, tenant_id, lead_id, channel)
        values ('${conversation(t, n)}', '${tenants[t - 1]}', '${lead(t, n)}', 'sms');
      insert into app.messages (id, tenant_id, conversation_id, direction, author, body, delivery_status)
        values ('${message(t, n)}', '${tenants[t - 1]}', '${conversation(t, n)}', 'in', 'customer',
                '${words.replaceAll("'", "''")}', 'received');`,
      )
      .join('\n');
    await pool.query(
      `${setup}
       ${people}
       insert into app.opt_outs (tenant_id, phone, source) values ('${HVAC}', '+13195550164', 'stop_keyword');`,
    );
  });

  afterAll(async () => {
    await removeTestTenants(pool);
    await pool.end();
  });

  it('sends the fixed gas message first and alerts the approver with how to call back', async () => {
    await queue(1, 1, 'send_safety_message', message(1, 1));
    await drain(HVAC);
    expect(textsTo('+13195550161')).toEqual([
      'Safety Heating: If you smell gas, leave the building now. Do not use light switches, phones or lighters inside. Once outside, call 911 and your gas company. We will call you as soon as we can.',
    ]);
    expect(textsTo(APPROVER_MOBILE[0]!)).toEqual([
      'Urgent: Caller 1 reported a gas smell. The safety message went out. Call them now at (319) 555-0161.',
    ]);
    expect(await leadRow(1, 1)).toEqual({
      state: 'needs_attention',
      state_reason: 'safety_message_sent',
      urgency: 'emergency',
    });
  });

  it('sends the crisis message pointing to 911 only, and an alert that repeats nothing', async () => {
    await queue(2, 3, 'send_safety_message', message(2, 3));
    await drain(STUDIO);
    const [crisis] = textsTo('+13195550163');
    expect(crisis).toBe(
      'If you are in danger or thinking about hurting yourself, call 911 now. Safety Ink will see your message as soon as someone is available.',
    );
    expect(crisis).not.toContain('988');
    expect(textsTo(APPROVER_MOBILE[1]!)).toEqual([
      'Urgent: a new message needs a person now. The fixed crisis message went out. Open the Front Desk.',
    ]);
    expect(await leadRow(2, 3)).toMatchObject({ state_reason: 'crisis_message_sent' });
  });

  it('still alerts the approver when the customer has opted out, but texts the customer nothing', async () => {
    await queue(1, 4, 'send_safety_message', message(1, 4));
    await drain(HVAC);
    expect(textsTo('+13195550164')).toEqual([]);
    expect(textsTo(APPROVER_MOBILE[0]!).at(-1)).toMatch(/^Urgent: Caller 4 reported a gas smell/);
  });

  it('alerts the approver when the clarify step finds someone may be at risk', async () => {
    await queue(1, 2, 'emergency_alert', lead(1, 2));
    await drain(HVAC);
    expect(textsTo(APPROVER_MOBILE[0]!).at(-1)).toBe(
      'Urgent: Caller 2 may be at risk. Call them now at (319) 555-0162.',
    );
    const kinds = await pool.query<{ kind: string }>(
      `select distinct kind from app.approver_texts where tenant_id = $1`,
      [HVAC],
    );
    expect(kinds.rows).toEqual([{ kind: 'alert' }]);
  });
});
