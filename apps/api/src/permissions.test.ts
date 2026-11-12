import type { InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { createPool } from './db.js';

/**
 * Permissions, free-text replies and the Settings routes (Iteration 1; decisions 37, 39 and 40)
 * against the local stack, on a test-only business (`mock-test-permissions`) with an owner, a
 * staff member and two leads, removed afterwards (and before starting). Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = 'a6000000-0000-4000-8000-000000000001';
const OWNER_AUTH = 'a6000000-0000-4000-8000-0000000000a1';
const STAFF_AUTH = 'a6000000-0000-4000-8000-0000000000a2';
const OWNER = 'a6000000-0000-4000-8000-0000000000b1';
const STAFF = 'a6000000-0000-4000-8000-0000000000b2';
const LEAD = (n: number) => `a6000000-0000-4000-8001-00000000000${n}`;
const CONTACT = (n: number) => `a6000000-0000-4000-8002-00000000000${n}`;
const MESSAGE = (n: number) => `a6000000-0000-4000-8003-00000000000${n}`;
const BUSINESS = 'Permissions Test Co';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select staff_capabilities from app.tenant_config limit 1');
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
if (!ready) console.warn('apps/api permission tests skipped: local Supabase stack is not running');

async function removeTestTenant(pool: pg.Pool) {
  await pool.query(
    `delete from app.audit_events where tenant_id = $1;
     delete from app.job_attempts where tenant_id = $1;
     delete from app.jobs where tenant_id = $1;
     delete from app.messages where tenant_id = $1;
     delete from app.conversations where tenant_id = $1;
     delete from app.tenant_templates where tenant_id = $1;
     delete from app.leads where tenant_id = $1;
     delete from app.contacts where tenant_id = $1;
     delete from app.service_registrations where tenant_id = $1;
     delete from app.tenant_config where tenant_id = $1;
     delete from app.portal_users where tenant_id = $1;
     delete from auth.users where id in ('${OWNER_AUTH}', '${STAFF_AUTH}');
     delete from app.tenants where id = $1;`.replaceAll('$1', `'${T}'`),
  );
}

describe.skipIf(!ready)('permissions, free text and settings (local stack, test tenant)', () => {
  let pool: pg.Pool;
  const tokens = new Map<string, string>([
    ['owner', OWNER_AUTH],
    ['staff', STAFF_AUTH],
  ]);
  const verify: TokenVerifier = async (token) => tokens.get(token) ?? null;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestTenant(pool);
    await pool.query(
      `insert into app.tenants (id, slug, name) values ('${T}', 'mock-test-permissions', '${BUSINESS}');
       insert into auth.users (id, email, aud, role) values
         ('${OWNER_AUTH}', 'owner@permissions.example.com', 'authenticated', 'authenticated'),
         ('${STAFF_AUTH}', 'staff@permissions.example.com', 'authenticated', 'authenticated');
       insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name) values
         ('${OWNER}', '${T}', '${OWNER_AUTH}', 'owner', 'Perm Owner'),
         ('${STAFF}', '${T}', '${STAFF_AUTH}', 'staff', 'Perm Staff');
       insert into app.tenant_config (tenant_id, playbook_key, business_hours, default_job_minutes)
         values ('${T}', 'shop_dropoff', '[]', 30);
       insert into app.service_registrations (tenant_id, service, state)
         values ('${T}', 'texting', 'approved');
       insert into app.contacts (id, tenant_id, display_name, phone) values
         ('${CONTACT(1)}', '${T}', 'Pat Customer', '+13195550165'),
         ('${CONTACT(2)}', '${T}', 'Sam Customer', '+13195550166');
       insert into app.leads (id, tenant_id, contact_id, source, state) values
         ('${LEAD(1)}', '${T}', '${CONTACT(1)}', 'text', 'needs_attention'),
         ('${LEAD(2)}', '${T}', '${CONTACT(2)}', 'text', 'needs_attention');
       insert into app.tenant_templates (tenant_id, version, content, active)
         values ('${T}', 1, '${JSON.stringify({
           reply_will_call: 'Thanks, {name}. Someone from {business} will call you shortly.',
         })}', true);`,
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
  const reply = (token: string, n: number, body: object) =>
    call('POST', `/portal/leads/${LEAD(1)}/replies`, token, { ...body, messageId: MESSAGE(n) });

  it('starts staff with what they had before, and tells the portal', async () => {
    const me = (await call('GET', '/portal/me', 'staff')).json();
    expect(me.capabilities).toEqual(['act_on_leads', 'reply_templates']);
    expect(me.freeTextChannels).toEqual([]);
    expect((await call('GET', '/portal/me', 'owner')).json().capabilities).toHaveLength(4);
  });

  it('refuses free text while the owner has it switched off', async () => {
    const res = await reply('owner', 1, { text: `Hi, this is ${BUSINESS}. Tracking soon.` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'free_text_off' });
  });

  it('lets only the owner change Settings', async () => {
    const staffTry = await call('PUT', '/portal/business/free-text', 'staff', {
      channels: ['sms'],
    });
    expect(staffTry.statusCode).toBe(403);
    const res = await call('PUT', '/portal/business/free-text', 'owner', { channels: ['sms'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().freeTextChannels).toEqual(['sms']);
  });

  it('checks free text: the first text names the business, and stays short', async () => {
    expect((await reply('owner', 2, { text: 'Tracking number to follow.' })).json()).toEqual({
      error: 'needs_business_name',
    });
    expect((await reply('owner', 3, { text: 'word '.repeat(200) })).json()).toEqual({
      error: 'too_long',
    });
    const ok = await reply('owner', 4, { text: `Hi Pat, this is ${BUSINESS}. It shipped today.` });
    expect(ok.statusCode).toBe(200);
    const sent = await pool.query<{ author: string; template_key: string | null; body: string }>(
      `select author, template_key, body from app.messages where tenant_id = $1 and id = $2`,
      [T, MESSAGE(4)],
    );
    expect(sent.rows[0]).toEqual({
      author: 'staff',
      template_key: null,
      body: `Hi Pat, this is ${BUSINESS}. It shipped today.`,
    });
    const audit = await pool.query<{ detail: Record<string, unknown> }>(
      `select detail from app.audit_events
        where tenant_id = $1 and action = 'lead.replied' order by occurred_at desc limit 1`,
      [T],
    );
    expect(audit.rows[0]?.detail).toEqual({ freeText: true, segments: 1, messageId: MESSAGE(4) });
    // After the first text, the business name is no longer required.
    expect((await reply('owner', 5, { text: 'Tracking to follow.' })).statusCode).toBe(200);
  });

  it('needs the reply_free_text permission for staff, even with the switch on', async () => {
    const res = await reply('staff', 6, { text: 'On its way.' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'not_permitted' });
    const granted = await call('PUT', '/portal/business/permissions', 'owner', {
      staffCapabilities: ['act_on_leads', 'reply_templates', 'reply_free_text'],
    });
    expect(granted.json().staffCapabilities).toEqual([
      'act_on_leads',
      'reply_templates',
      'reply_free_text',
    ]);
    expect((await reply('staff', 6, { text: 'On its way.' })).statusCode).toBe(200);
  });

  it('enforces what the owner takes away: actions, templates and template editing', async () => {
    await call('PUT', '/portal/business/permissions', 'owner', { staffCapabilities: [] });
    const action = await call('POST', `/portal/leads/${LEAD(2)}/actions`, 'staff', {
      action: 'close',
    });
    expect(action.json()).toEqual({ error: 'not_permitted' });
    expect(action.statusCode).toBe(403);
    expect((await reply('staff', 7, { templateKey: 'reply_will_call' })).json()).toEqual({
      error: 'not_permitted',
    });
    const settings = (await call('GET', '/portal/settings', 'staff')).json();
    expect(settings.canEdit).toBe(false);

    await call('PUT', '/portal/business/permissions', 'owner', {
      staffCapabilities: ['edit_templates'],
    });
    expect((await call('GET', '/portal/settings', 'staff')).json().canEdit).toBe(true);
  });

  it('saves the Act now limit, within 1 hour to a week', async () => {
    expect((await call('PUT', '/portal/business/act-now', 'owner', { hours: 0 })).statusCode).toBe(
      400,
    );
    const res = await call('PUT', '/portal/business/act-now', 'owner', { hours: 12 });
    expect(res.json().actNowAfterHours).toBe(12);
    expect((await call('GET', '/portal/today', 'owner')).json().actNowAfterHours).toBe(12);
  });

  it('turns a staff member off and on, never the owner', async () => {
    const owner = await call('PUT', `/portal/business/team/${OWNER}`, 'owner', { active: false });
    expect(owner.json()).toEqual({ error: 'owner_stays_active' });

    const off = await call('PUT', `/portal/business/team/${STAFF}`, 'owner', { active: false });
    expect(off.json().team.find((p: { id: string }) => p.id === STAFF).active).toBe(false);
    // Someone turned off cannot sign in.
    expect((await call('GET', '/portal/me', 'staff')).statusCode).toBe(403);

    await call('PUT', `/portal/business/team/${STAFF}`, 'owner', { active: true });
    expect((await call('GET', '/portal/me', 'staff')).statusCode).toBe(200);
  });
});
