import { SAFETY_LAYER } from '@fsc/ai';
import { MockCalendar, MockLanguageModel, MockSmsSender } from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * The clarify step against the local stack, with a scripted mock language model and labeled mock
 * connectors, on a test-only business (`mock-test-clarify`). Each lead stands for one customer;
 * the model's answers are scripted by what the customer wrote. Removed afterwards (and before
 * starting). Mock values only; nothing reaches an AI provider.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b8000000-0000-4000-8000-000000000001';
const lead = (n: number) => `b8000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `b8000000-0000-4000-8002-00000000000${n}`;
const QUESTIONS = [
  'What is the problem?',
  'What is the address?',
  'How soon: 1 today, 2 this week, 3 flexible?',
];

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.ai_analyses limit 1');
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
if (!ready) console.warn('clarify tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.slot_offers where tenant_id = $1;
     delete from app.ai_analyses where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.calendar_connections where tenant_id = $1;
     delete from app.ai_settings where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

const answer = (over: Record<string, unknown>) =>
  JSON.stringify({
    answered: [],
    summary: null,
    category: null,
    urgency: null,
    address: null,
    emergency: false,
    out_of_scope: false,
    price_question: false,
    ...over,
  });

describe.skipIf(!ready)('clarify step (local stack, scripted mock model)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const model = new MockLanguageModel();
  const log = pino({ level: 'silent' });
  const drain = async () => {
    for (let i = 0; i < 6; i++) {
      const reports = await runOnce(
        {
          pool,
          connectors: { sms, calendar: new MockCalendar(), ai: model },
          now: () => new Date(),
        },
        { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
    }
  };
  /** The customer texts; intake would record this and queue the job. */
  const says = async (n: number, body: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
       select $1, c.id, 'in', 'customer', $3, 'received'
         from app.conversations c where c.tenant_id = $1 and c.lead_id = $2
       returning id`,
      [T, lead(n), body],
    );
    await pool.query(
      `insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
       values ($1, $2, 'clarify_lead', $3)`,
      [T, lead(n), `clarify_lead:${rows[0]!.id}`],
    );
  };
  const leadRow = async (n: number) =>
    (
      await pool.query<{
        state: string;
        state_reason: string | null;
        summary: string | null;
        address: string | null;
        urgency: string | null;
      }>(`select state, state_reason, summary, address, urgency from app.leads where id = $1`, [
        lead(n),
      ])
    ).rows[0];
  const lastText = async (n: number) =>
    (
      await pool.query<{ body: string; author: string }>(
        `select m.body, m.author from app.messages m join app.conversations c on c.id = m.conversation_id
          where c.lead_id = $1 and m.direction = 'out' order by m.occurred_at desc, m.id desc limit 1`,
        [lead(n)],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    const hours = JSON.stringify([{ days: [1, 2, 3, 4, 5, 6, 7], open: '07:00', close: '19:00' }]);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-clarify', 'Clarify Co');
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '${hours}', 60, '+13195550180');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '{"slot_offer": "Open times: {slots}"}', true);
       insert into app.ai_settings (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({ questions: QUESTIONS, what_we_do: 'AC and furnace repair.' })}', true);
       insert into app.calendar_connections (tenant_id, provider, calendar_id, status, connected_at)
         values ('${T}', 'google', 'MOCK-GCAL-CLARIFY', 'connected', now());
       ${[1, 2, 3, 4]
         .map(
           (n) => `
         insert into app.contacts (id, tenant_id, phone) values ('${contact(n)}', '${T}', '+1319555017${n}');
         insert into app.leads (id, tenant_id, contact_id, source, state)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call', 'clarifying');
         insert into app.conversations (tenant_id, lead_id, channel) values ('${T}', '${lead(n)}', 'sms');`,
         )
         .join('\n')}`,
    );
    // The scripted model, by what the customer wrote.
    const said = (text: string) => (r: { input: string }) => r.input.includes(text);
    model.respondWith(
      answer({
        answered: [0, 1, 2],
        urgency: 'this_week',
        summary: 'AC is warm.',
        address: '9941 Elm St',
      }),
      said('next week works'),
    );
    model.respondWith(
      answer({ answered: [0, 1], summary: 'AC is warm.', address: '9941 Elm St' }),
      said('9941 Elm St'),
    );
    model.respondWith(
      answer({ answered: [0], summary: 'AC is warm.' }),
      said('AC blowing warm air'),
    );
    model.respondWith(answer({ answered: [0], price_question: true }), said('How much'));
    model.respondWith('Sure! Sounds like an AC problem.', said('Weird reply'));
    model.respondWith(answer({ answered: [0], emergency: true }), said('smell gas'));
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it("asks only what is missing, in the owner's words, then offers times", async () => {
    await says(1, 'AC blowing warm air');
    await drain();
    expect(await lastText(1)).toEqual({ body: 'What is the address?', author: 'ai_question' });
    expect(await leadRow(1)).toMatchObject({ state: 'clarifying', summary: 'AC is warm.' });

    await says(1, '9941 Elm St, Cedar Falls');
    await drain();
    expect((await lastText(1))?.body).toBe('How soon: 1 today, 2 this week, 3 flexible?');

    await says(1, 'next week works');
    await drain();
    expect(await leadRow(1)).toMatchObject({
      state: 'offered',
      address: '9941 Elm St',
      urgency: 'this_week',
    });
    expect((await lastText(1))?.body).toMatch(/^Open times: 1\) /);
  });

  it('keeps customer text inside the locked safety layer, as data', () => {
    const request = model.requests[0]!;
    expect(request.system.startsWith(SAFETY_LAYER)).toBe(true);
    expect(request.input).toBe('<customer>\nAC blowing warm air\n</customer>');
  });

  it('records every reading, and stores nothing but the validated fields', async () => {
    const { rows } = await pool.query<{ valid: boolean; model: string }>(
      `select valid, model from app.ai_analyses where lead_id = $1`,
      [lead(1)],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.valid && r.model === 'mock-model')).toBe(true);
  });

  it('hands prices, risk and unreadable answers to a person instead of asking', async () => {
    await says(2, 'How much for a tune-up?');
    await says(3, 'Weird reply');
    await says(4, 'I smell gas in the basement');
    await drain();
    expect(await leadRow(2)).toMatchObject({
      state: 'needs_attention',
      state_reason: 'price_question',
    });
    expect(await leadRow(3)).toMatchObject({ state: 'needs_attention', state_reason: 'unsure' });
    expect(await leadRow(4)).toMatchObject({ state: 'needs_attention', state_reason: 'emergency' });
    const invalid = await pool.query(
      `select 1 from app.ai_analyses where lead_id = $1 and not valid and output is null`,
      [lead(3)],
    );
    expect(invalid.rowCount).toBe(1);
  });

  it('reads two quick texts once, together', async () => {
    const before = model.requests.length;
    await pool.query(
      `update app.leads set state = 'clarifying', state_reason = null where id = $1`,
      [lead(2)],
    );
    await says(2, 'AC blowing warm air');
    await says(2, '9941 Elm St, Cedar Falls');
    await drain();
    expect(model.requests.length - before).toBe(1);
  });
});
