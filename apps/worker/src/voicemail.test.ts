import {
  MockCalendar,
  MockRulesModel,
  MockSmsSender,
  MockTranscriptionProvider,
} from '@fsc/connectors/mock';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * Voicemail transcription against the local stack, with the mock transcriber and the rules mock
 * standing in for a model, on a test-only business (`mock-test-voicemail`). Removed afterwards (and
 * before starting). Mock values only; nothing reaches a transcription or AI provider.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'b9000000-0000-4000-8000-000000000001';
const NUMBER = '+13195550179';
const lead = (n: number) => `b9000000-0000-4000-8001-00000000000${n}`;
const contact = (n: number) => `b9000000-0000-4000-8002-00000000000${n}`;
const call = (n: number) => `b9000000-0000-4000-8003-00000000000${n}`;
const voicemail = (n: number) => `b9000000-0000-4000-8004-00000000000${n}`;
const QUESTIONS = [
  'What is the problem?',
  'What is the address?',
  'How soon: 1 today, 2 this week, 3 flexible?',
];
const TEXT_BACK =
  'Sorry we missed your call! This is {business}. Sounds like {need}. {question} Reply STOP to opt out.';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.voicemails limit 1');
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
if (!ready) console.warn('voicemail tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.ai_analyses where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.voicemails where tenant_id = $1;
     delete from app.calls where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.ai_settings where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('voicemail transcription (local stack, mock transcriber and model)', () => {
  let pool: pg.Pool;
  const sms = new MockSmsSender();
  const model = new MockRulesModel();
  const transcriber = new MockTranscriptionProvider();
  const log = pino({ level: 'silent' });
  const drain = async () => {
    for (let i = 0; i < 6; i++) {
      const reports = await runOnce(
        {
          pool,
          connectors: { sms, calendar: new MockCalendar(), ai: model, transcriber },
          now: () => new Date(),
        },
        { handlers: HANDLERS, tenantId: T, log, random: () => 0.5 },
      );
      if (reports.length === 0) break;
    }
  };
  const textTo = (n: number) =>
    sms.sent.filter((s) => s.tenantId === T && s.to === `+1319555016${n}`).map((s) => s.body);
  const leadRow = async (n: number) =>
    (
      await pool.query<{ state: string; state_reason: string | null; address: string | null }>(
        `select state, state_reason, address from app.leads where id = $1`,
        [lead(n)],
      )
    ).rows[0];
  const transcriptOf = async (n: number) =>
    (
      await pool.query<{ transcript: string | null }>(
        `select transcript from app.voicemails where id = $1`,
        [voicemail(n)],
      )
    ).rows[0]?.transcript;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    transcriber.setTranscript('MOCK-REC-VM-1', {
      text: "My furnace isn't heating. I'm at 9941 Elm St, Cedar Falls.",
      confidence: 0.94,
      durationSeconds: 9,
    });
    transcriber.setTranscript('MOCK-REC-VM-2', {
      text: 'mumble static',
      confidence: 0.3,
      durationSeconds: 4,
    });
    // MOCK-REC-VM-3 has no transcript: transcription fails.
    transcriber.setTranscript('MOCK-REC-VM-4', {
      text: 'I smell gas in the basement, please call',
      confidence: 0.9,
      durationSeconds: 6,
    });
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-voicemail', 'Voicemail Co');
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '[]', 60, '${NUMBER}');
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({ missed_call_text_back: TEXT_BACK }).replaceAll("'", "''")}', true);
       insert into app.ai_settings (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({ questions: QUESTIONS, emergency: 'Gas smell.' })}', true);
       ${[1, 2, 3, 4]
         .map(
           (n) => `
         insert into app.contacts (id, tenant_id, phone) values ('${contact(n)}', '${T}', '+1319555016${n}');
         insert into app.leads (id, tenant_id, contact_id, source)
           values ('${lead(n)}', '${T}', '${contact(n)}', 'missed_call');
         insert into app.calls (id, tenant_id, lead_id, provider_call_id, from_number, to_number, started_at)
           values ('${call(n)}', '${T}', '${lead(n)}', 'MOCK-CA-VM-${n}', '+1319555016${n}', '${NUMBER}', now());
         insert into app.voicemails (id, tenant_id, call_id, recording_ref, duration_seconds)
           values ('${voicemail(n)}', '${T}', '${call(n)}', 'MOCK-REC-VM-${n}', 9);
         insert into app.jobs (tenant_id, lead_id, action_type, idempotency_key)
           values ('${T}', '${lead(n)}', 'transcribe_voicemail', 'transcribe_voicemail:${voicemail(n)}');`,
         )
         .join('\n')}`,
    );
    await drain();
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  it('texts back what they need, asking only what the voicemail did not answer', async () => {
    expect(textTo(1)).toEqual([
      "Sorry we missed your call! This is Voicemail Co. Sounds like your furnace isn't heating. How soon: 1 today, 2 this week, 3 flexible? Reply STOP to opt out.",
    ]);
    expect(await transcriptOf(1)).toBe(
      "My furnace isn't heating. I'm at 9941 Elm St, Cedar Falls.",
    );
    expect(await leadRow(1)).toMatchObject({
      state: 'clarifying',
      address: '9941 Elm St, Cedar Falls.',
    });
  });

  it('keeps an unclear transcript but does not read it; the plain text-back goes out', async () => {
    expect(textTo(2)).toEqual([
      'Sorry we missed your call! This is Voicemail Co. What is the problem? Reply STOP to opt out.',
    ]);
    expect(await transcriptOf(2)).toBe('mumble static');
    const readings = await pool.query(`select 1 from app.ai_analyses where lead_id = $1`, [
      lead(2),
    ]);
    expect(readings.rowCount).toBe(0);
  });

  it('still texts back when the recording cannot be transcribed', async () => {
    expect(textTo(3)).toEqual([
      'Sorry we missed your call! This is Voicemail Co. What is the problem? Reply STOP to opt out.',
    ]);
    expect(await transcriptOf(3)).toBeNull();
  });

  it('sends the fixed gas safety message instead of the text-back, and puts it before a person', async () => {
    expect(await leadRow(4)).toMatchObject({
      state: 'needs_attention',
      state_reason: 'safety_message_sent',
    });
    const texts = textTo(4);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^Voicemail Co: If you smell gas, leave the building now\./);
  });

  it('sends nothing but the recording reference to the transcriber', () => {
    expect(transcriber.requests.map((r) => r.recordingRef).sort()).toEqual([
      'MOCK-REC-VM-1',
      'MOCK-REC-VM-2',
      'MOCK-REC-VM-3',
      'MOCK-REC-VM-4',
    ]);
  });
});
