import { TRADES, WORKFLOWS } from '@fsc/conversation';
import type { InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { createPool } from './db.js';

/**
 * Onboarding routes against the local stack. Writes run on a test-only business
 * (`mock-test-onboarding`) with an owner and a staff login, removed afterwards (and before
 * starting, in case an earlier run was interrupted). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'a9000000-0000-4000-8000-000000000001';
const OWNER_AUTH = 'a9000000-0000-4000-8000-0000000000a1';
const STAFF_AUTH = 'a9000000-0000-4000-8000-0000000000a2';
const OWNER = 'a9000000-0000-4000-8000-0000000000b1';
const STAFF = 'a9000000-0000-4000-8000-0000000000b2';
const BUSINESS = 'Onboarding Test Co';

const DETAILS = {
  legalName: 'Onboarding Test Co LLC',
  ein: '009876543',
  street: '9990 Test Rd',
  city: 'Cedar Falls',
  region: 'ia',
  postalCode: '50613',
  website: 'https://onboarding.example.com',
  contactName: 'Onboarding Owner',
  contactEmail: 'Owner@Onboarding.Example.com',
  contactPhone: '(319) 555-0191',
};

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.onboarding_progress limit 1');
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
if (!ready) console.warn('apps/api onboarding tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.business_profiles where tenant_id = $1;
     delete from app.onboarding_progress where tenant_id = $1;
     delete from app.calendar_connections where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.ai_settings where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id in ('${OWNER_AUTH}', '${STAFF_AUTH}');
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('portal onboarding (local stack, test tenant)', () => {
  let pool: pg.Pool;
  const tokens = new Map<string, string>([
    ['owner', OWNER_AUTH],
    ['staff', STAFF_AUTH],
  ]);
  const verify: TokenVerifier = async (token) => tokens.get(token) ?? null;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    const { rows } = await pool.query<{ email: string; id: string }>(
      `select email, id from auth.users
        where email = 'rhett@riverbend.example.com'`,
    );
    for (const r of rows) tokens.set(r.email, r.id);

    await pool.query(
      `insert into app.tenants (id, slug, name, status)
         values ('${T}', 'mock-test-onboarding', '${BUSINESS}', 'onboarding');
       insert into auth.users (id, email, aud, role) values
         ('${OWNER_AUTH}', 'owner@onboarding.example.com', 'authenticated', 'authenticated'),
         ('${STAFF_AUTH}', 'staff@onboarding.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile) values
         ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Onboarding Owner', '+13195550191'),
         ('${STAFF}', '${T}', '${STAFF_AUTH}', 'staff', 'Onboarding Staff', null);
       insert into app.tenant_config
         (tenant_id, playbook_key, business_hours, default_job_minutes,
          connect_number)
         values ('${T}', 'service_call', '[]', 60, '+13195550190');`,
    );
  });

  afterAll(async () => {
    await removeTestTenant(pool);
    await pool.end();
  });

  const call = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: object) => {
    const options: InjectOptions = { method, url, headers: { authorization: `Bearer ${token}` } };
    if (payload !== undefined) options.payload = payload;
    return buildApp({ pool, verifyToken: verify, logger: false }).inject(options);
  };
  const done = (body: { steps: { key: string; done: boolean }[] }, key: string) =>
    body.steps.find((s) => s.key === key)?.done;
  const audits = async () =>
    (
      await pool.query<{ action: string; detail: Record<string, unknown> }>(
        `select action, detail from app.audit_events where tenant_id = $1 order by occurred_at, id`,
        [T],
      )
    ).rows;

  it('shows a new business its setup with nothing done, and staff cannot change it', async () => {
    const res = await call('GET', '/portal/onboarding', 'staff');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.canEdit).toBe(false);
    expect(body.steps.every((s: { done: boolean }) => !s.done)).toBe(true);
    expect(body.businessType).toMatchObject({
      key: 'service_call',
      trade: null,
      jobMinutes: 60,
      confirmedAt: null,
    });

    const write = await call('POST', '/portal/onboarding/business-type', 'staff');
    expect(write.statusCode).toBe(403);
    expect(write.json()).toEqual({ error: 'owner_only' });
  });

  // Decision 35: a business that is not live can sign in, but only setup is open.
  it('keeps the working pages locked while the business is onboarding', async () => {
    const me = await call('GET', '/portal/me', 'owner');
    expect(me.statusCode).toBe(200);
    expect(me.json().stage).toBe('setting_up');
    for (const url of ['/portal/today', '/portal/calendar']) {
      for (const who of ['owner', 'staff']) {
        const res = await call('GET', url, who);
        expect({ url, who, status: res.statusCode, body: res.json() }).toEqual({
          url,
          who,
          status: 403,
          body: { error: 'not_live' },
        });
      }
    }
    expect((await call('GET', '/portal/settings', 'owner')).statusCode).toBe(200);
  });

  it('refuses the texting application until every other step is done', async () => {
    const res = await call('POST', '/portal/onboarding/application', 'owner', { confirmed: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'setup_incomplete' });
  });

  it('confirms the business type', async () => {
    const res = await call('POST', '/portal/onboarding/business-type', 'owner');
    expect(res.statusCode).toBe(200);
    expect(done(res.json(), 'business_type')).toBe(true);
  });

  it('names the fields that need fixing, and refuses a Social Security number', async () => {
    const res = await call('PUT', '/portal/onboarding/details', 'owner', {
      ...DETAILS,
      ein: '123-45-6789',
      region: 'XX',
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe('invalid_fields');
    expect(Object.keys(body.fields).sort()).toEqual(['ein', 'region']);
  });

  it('saves business details normalized, auditing field names but never values', async () => {
    const res = await call('PUT', '/portal/onboarding/details', 'owner', DETAILS);
    expect(res.statusCode).toBe(200);
    expect(res.json().details).toMatchObject({
      ein: '00-9876543',
      region: 'IA',
      contactEmail: 'owner@onboarding.example.com',
      contactPhone: '+13195550191',
    });
    expect(done(res.json(), 'details')).toBe(true);
    const saved = (await audits()).find((a) => a.action === 'onboarding.details_saved');
    expect(saved?.detail.changed).toContain('ein');
    expect(JSON.stringify(saved?.detail)).not.toContain('9876543');
  });

  it('saves hours, and the step waits for a connected calendar', async () => {
    const overlap = await call('PUT', '/portal/onboarding/hours', 'owner', {
      hours: [
        { days: [1, 2], open: '08:00', close: '12:00' },
        { days: [2], open: '11:00', close: '15:00' },
      ],
    });
    expect(overlap.statusCode).toBe(422);

    const res = await call('PUT', '/portal/onboarding/hours', 'owner', {
      hours: [{ days: [1, 2, 3, 4, 5], open: '07:00', close: '17:00' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hours).toHaveLength(1);
    expect(done(res.json(), 'hours')).toBe(false);

    await pool.query(
      `insert into app.calendar_connections (tenant_id, provider, calendar_id, status, connected_at)
       values ($1, 'google', 'MOCK-GCAL-ONBOARDING', 'connected', now())`,
      [T],
    );
    expect(done((await call('GET', '/portal/onboarding', 'owner')).json(), 'hours')).toBe(true);
  });

  it('marks templates reviewed only once templates exist', async () => {
    const none = await call('POST', '/portal/onboarding/templates-reviewed', 'owner');
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'no_templates' });

    await pool.query(
      `insert into app.tenant_templates (tenant_id, version, content, active) values ($1, 1, $2, true)`,
      [
        T,
        JSON.stringify({
          missed_call_text_back:
            'Sorry we missed your call! This is {business}. Reply STOP to opt out.',
          slot_offer: 'Reply with a number: {slots}',
          request_received: 'Got it, {slot} is requested.',
          approval_request: 'New request: {summary}. {name} picked {slot}. Reply 1 to approve.',
          confirmation: "You're booked with {business} for {slot}. Reply STOP to opt out.",
        }),
      ],
    );
    const res = await call('POST', '/portal/onboarding/templates-reviewed', 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json().templates.version).toBe(1);
    expect(done(res.json(), 'templates')).toBe(true);
  });

  it('chooses approvers from this business only', async () => {
    const none = await call('PUT', '/portal/onboarding/approvers', 'owner', { approverIds: [] });
    expect(none.json()).toEqual({ error: 'no_approver' });

    const { rows } = await pool.query<{ id: string }>(
      `select pu.id from app.portal_users pu join auth.users u on u.id = pu.auth_user_id
        where u.email = 'rhett@riverbend.example.com'`,
    );
    const foreign = await call('PUT', '/portal/onboarding/approvers', 'owner', {
      approverIds: [OWNER, rows[0]!.id],
    });
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json()).toEqual({ error: 'unknown_person' });

    const res = await call('PUT', '/portal/onboarding/approvers', 'owner', {
      approverIds: [OWNER],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().team).toMatchObject([
      { name: 'Onboarding Owner', approvesRequests: true },
      { name: 'Onboarding Staff', approvesRequests: false },
    ]);
    expect(done(res.json(), 'team')).toBe(true);
  });

  it('runs the test call as a labeled simulation that sends and creates nothing', async () => {
    const res = await call('POST', '/portal/onboarding/test-call', 'owner');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulated).toBe(true);
    expect(body.steps[0]).toEqual({
      kind: 'missed_call',
      to: '+13195550190',
      from: '+13195550191',
    });
    expect(body.steps[1].body).toBe(
      `Sorry we missed your call! This is ${BUSINESS}. Reply STOP to opt out.`,
    );
    expect(body.steps[6]).toMatchObject({ kind: 'approval_request', channel: 'text' });
    expect(
      body.onboarding.steps
        .filter((s: { done: boolean }) => !s.done)
        .map((s: { key: string }) => s.key),
    ).toEqual(['apply']);
    expect(body.onboarding.application.ready).toBe(true);

    const { rows } = await pool.query<{ n: string }>(
      `select (select count(*) from app.leads where tenant_id = $1)
            + (select count(*) from app.messages where tenant_id = $1)
            + (select count(*) from app.jobs where tenant_id = $1) as n`,
      [T],
    );
    expect(rows[0]?.n).toBe('0');
    expect((await audits()).at(-1)).toMatchObject({
      action: 'onboarding.test_simulated',
      detail: { simulated: true },
    });
  });

  it('shows what goes to the carriers, built from the live templates', async () => {
    const res = await call('GET', '/portal/onboarding', 'owner');
    const { preview } = res.json().application;
    expect(preview.useCase).toContain(BUSINESS);
    expect(preview.optIn).toContain('Reply STOP to opt out.');
    expect(preview.sampleMessages[0]).toBe(
      `Sorry we missed your call! This is ${BUSINESS}. Reply STOP to opt out.`,
    );
  });

  it('sends the application only when the owner confirms it, then waits for go-live', async () => {
    const unconfirmed = await call('POST', '/portal/onboarding/application', 'owner', {
      confirmed: false,
    });
    expect(unconfirmed.json()).toEqual({ error: 'not_confirmed' });
    expect(
      (await call('POST', '/portal/onboarding/application', 'staff', { confirmed: true }))
        .statusCode,
    ).toBe(403);

    const res = await call('POST', '/portal/onboarding/application', 'owner', { confirmed: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe('applied');
    expect(res.json().application.submittedAt).not.toBeNull();
    expect(res.json().steps.every((s: { done: boolean }) => s.done)).toBe(true);
    expect((await audits()).at(-1)).toMatchObject({
      action: 'onboarding.application_submitted',
      detail: { resubmitted: false },
    });

    // Sent is not live: the working pages stay locked until Fifth Stone Dev turns it on.
    expect((await call('GET', '/portal/me', 'staff')).json().stage).toBe('applied');
    expect((await call('GET', '/portal/today', 'owner')).statusCode).toBe(403);
  });

  it('a live business has nothing to apply for', async () => {
    const res = await call(
      'POST',
      '/portal/onboarding/application',
      'rhett@riverbend.example.com',
      {
        confirmed: true,
      },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already_live' });
  });

  it('opens the working pages once the business is live', async () => {
    await pool.query(`update app.tenants set status = 'active' where id = $1`, [T]);
    expect((await call('GET', '/portal/me', 'owner')).json().stage).toBe('live');
    expect((await call('GET', '/portal/today', 'staff')).statusCode).toBe(200);
    await pool.query(`update app.tenants set status = 'onboarding' where id = $1`, [T]);
  });

  // Decision 34: the owner picks a workflow and trade; its starter settings become live versions.
  describe('choosing a business type', () => {
    const live = async (table: 'tenant_templates' | 'ai_settings') =>
      (
        await pool.query<{ version: number; content: Record<string, unknown> }>(
          `select version, content from app.${table} where tenant_id = $1 and active`,
          [T],
        )
      ).rows[0];

    it('staff cannot choose, and an unknown trade is refused', async () => {
      expect(
        (await call('PUT', '/portal/onboarding/business-type', 'staff', { trade: 'lawn_care' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call('PUT', '/portal/onboarding/business-type', 'owner', { trade: 'clinic' }))
          .statusCode,
      ).toBe(400);
    });

    it('applies the trade: workflow, job length, starter wording and questions', async () => {
      const before = await live('tenant_templates');
      const res = await call('PUT', '/portal/onboarding/business-type', 'owner', {
        trade: 'house_cleaning',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.businessType).toMatchObject({
        key: 'recurring_service',
        name: 'Recurring service',
        approverChannel: 'text',
        trade: { key: 'house_cleaning', name: 'House cleaning' },
        jobMinutes: 120,
      });
      expect(body.templates.questions[0]).toBe('How many bedrooms and bathrooms?');
      // New wording reaches customers, so the template review is asked for again.
      expect(body.templates.reviewedAt).toBeNull();
      expect(done(body, 'templates')).toBe(false);

      const templates = await live('tenant_templates');
      expect(templates?.version).toBe((before?.version ?? 0) + 1);
      expect(templates?.content.confirmation).toContain('first visit');
      expect((await audits()).map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'settings.templates_starter_applied',
          'settings.ai_starter_applied',
          'onboarding.business_type_chosen',
        ]),
      );
    });

    it('choosing the same trade again writes no new versions', async () => {
      const before = [await live('tenant_templates'), await live('ai_settings')];
      const res = await call('PUT', '/portal/onboarding/business-type', 'owner', {
        trade: 'house_cleaning',
      });
      expect(res.statusCode).toBe(200);
      expect([await live('tenant_templates'), await live('ai_settings')]).toEqual(before);
    });

    it('switching workflows keeps the earlier wording restorable', async () => {
      const res = await call('PUT', '/portal/onboarding/business-type', 'owner', {
        trade: 'auto_repair',
      });
      expect(res.json().businessType).toMatchObject({
        key: 'shop_dropoff',
        trade: { key: 'auto_repair' },
        jobMinutes: 30,
      });
      const { rows } = await pool.query<{ version: number }>(
        `select version from app.tenant_templates where tenant_id = $1 order by version`,
        [T],
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect((await live('tenant_templates'))?.content.slot_offer).toContain('drop-off');

      const call2 = await call('POST', '/portal/onboarding/test-call', 'owner');
      expect(call2.json().steps[2]).toEqual({
        kind: 'caller_replies',
        body: '2016 Civic, brakes are grinding.',
      });
    });

    it('the code catalog matches the database catalog', async () => {
      const flows = await pool.query<{ key: string; name: string; channel: string }>(
        `select key, name, default_approver_channel as channel from app.playbooks order by key`,
      );
      expect(flows.rows).toEqual(
        WORKFLOWS.map((w) => ({ key: w.key, name: w.name, channel: w.approverChannel })).sort(
          (a, b) => a.key.localeCompare(b.key),
        ),
      );
      const trades = await pool.query<{
        key: string;
        workflow: string;
        name: string;
        minutes: number;
      }>(
        `select key, playbook_key as workflow, name, default_job_minutes as minutes
           from app.trades order by key`,
      );
      expect(trades.rows).toEqual(
        TRADES.map((t) => ({
          key: t.key,
          workflow: t.workflow,
          name: t.name,
          minutes: t.jobMinutes,
        })).sort((a, b) => a.key.localeCompare(b.key)),
      );
    });
  });
});
