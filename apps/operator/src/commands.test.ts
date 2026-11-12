import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthAdmin } from './auth-admin.js';
import {
  addPerson,
  createBusiness,
  disableBusiness,
  goLive,
  listBusinesses,
  passwordLink,
  setNumber,
  setTexting,
  showBusiness,
} from './commands.js';
import { createPool, inTransaction } from './db.js';

/**
 * Operator commands against the local stack, on a test-only business (`mock-test-operator`)
 * removed afterwards (and before starting, in case an earlier run was interrupted). The owner's
 * login is made by a stand-in for Supabase Auth's admin API, so no real login service is called.
 * Mock values only.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SLUG = 'mock-test-operator';
const EMAIL = 'owner@operator.example.com';
const NUMBER = '+13195550188';
const STAFF_EMAIL = 'staff@operator.example.com';

async function reachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.setup_progress limit 1');
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
if (!ready) console.warn('apps/operator tests skipped: local Supabase stack is not running');

async function removeTestBusiness(pool: pg.Pool) {
  const { rows } = await pool.query<{ id: string }>(`select id from app.tenants where slug = $1`, [
    SLUG,
  ]);
  const id = rows[0]?.id;
  if (id) {
    for (const table of [
      'audit_events',
      'service_registrations',
      'calendar_connections',
      'business_profiles',
      'onboarding_progress',
      'tenant_config',
      'portal_users',
    ]) {
      await pool.query(`delete from app.${table} where tenant_id = $1`, [id]);
    }
    await pool.query(`delete from app.tenants where id = $1`, [id]);
  }
  await pool.query(`delete from auth.users where email = any($1)`, [[EMAIL, STAFF_EMAIL]]);
}

describe.skipIf(!ready)('operator commands (local stack, test business)', () => {
  let pool: pg.Pool;
  // Stands in for Supabase Auth: makes the login row directly, as the seed does.
  const auth: AuthAdmin = {
    async ensureUser(email) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into auth.users (id, email, aud, role)
         values (gen_random_uuid(), $1, 'authenticated', 'authenticated')
         on conflict do nothing returning id`,
        [email],
      );
      if (rows[0]) return rows[0].id;
      const found = await pool.query<{ id: string }>(`select id from auth.users where email = $1`, [
        email,
      ]);
      return found.rows[0]!.id;
    },
    async setPasswordLink() {
      return 'https://example.com/mock-set-password';
    },
  };
  const input = {
    slug: SLUG,
    name: 'Operator Test Co',
    ownerName: 'Operator Owner',
    ownerEmail: EMAIL,
    timezone: 'America/Chicago',
    workflow: 'shop_dropoff',
  };
  const run = <T>(work: (c: pg.PoolClient) => Promise<T>) => inTransaction(pool, work);
  const show = () => run((c) => showBusiness(c, SLUG));
  const audits = async () =>
    (
      await pool.query<{ action: string; actor_type: string; detail: Record<string, unknown> }>(
        `select a.action, a.actor_type, a.detail from app.audit_events a
           join app.tenants t on t.id = a.tenant_id
          where t.slug = $1 order by a.occurred_at, a.id`,
        [SLUG],
      )
    ).rows;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    await removeTestBusiness(pool);
  });

  afterAll(async () => {
    await removeTestBusiness(pool);
    await pool.end();
  });

  it('creates a business that is onboarding, with its owner and status cards', async () => {
    const result = await run((c) => createBusiness(c, auth, input));
    expect(result).toEqual({
      ok: true,
      changed: true,
      value: { setPasswordLink: 'https://example.com/mock-set-password' },
    });
    expect(await show()).toMatchObject({
      status: 'onboarding',
      stage: 'setting_up',
      texting: 'not_started',
      connectNumber: null,
      owner: EMAIL,
    });
    const config = await pool.query<{ playbook_key: string; default_job_minutes: number }>(
      `select playbook_key, default_job_minutes from app.tenant_config c
         join app.tenants t on t.id = c.tenant_id where t.slug = $1`,
      [SLUG],
    );
    expect(config.rows[0]).toEqual({ playbook_key: 'shop_dropoff', default_job_minutes: 30 });
    expect(await audits()).toEqual([
      {
        action: 'tenant.provisioned',
        actor_type: 'operator',
        detail: { workflow: 'shop_dropoff', status: 'onboarding' },
      },
    ]);
  });

  it('is safe to run twice, and refuses a slug or login that belongs to something else', async () => {
    expect(await run((c) => createBusiness(c, auth, input))).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await run((c) => createBusiness(c, auth, { ...input, name: 'Other Co' }))).toEqual({
      ok: false,
      error: `${SLUG} already belongs to Operator Test Co`,
    });
    const rhett = await run((c) =>
      createBusiness(c, auth, {
        ...input,
        slug: 'mock-test-operator-two',
        ownerEmail: 'rhett@riverbend.example.com',
      }),
    );
    expect(rhett).toEqual({
      ok: false,
      error: 'rhett@riverbend.example.com already signs in to mock-riverbend',
    });
    expect(
      await run((c) => createBusiness(c, auth, { ...input, workflow: 'clinic' })),
    ).toMatchObject({ ok: false });
  });

  it('adds a staff member with a login, once, and refuses a login from elsewhere', async () => {
    const person = { slug: SLUG, name: 'Op Staff', email: STAFF_EMAIL, mobile: '+13195550187' };
    expect(await run((c) => addPerson(c, auth, person))).toEqual({
      ok: true,
      changed: true,
      value: { setPasswordLink: 'https://example.com/mock-set-password' },
    });
    expect(await run((c) => addPerson(c, auth, person))).toMatchObject({
      ok: true,
      changed: false,
    });
    const role = await pool.query<{ role: string; mobile: string }>(
      `select pu.role, pu.mobile from app.portal_users pu join auth.users u on u.id = pu.auth_user_id
        where u.email = $1`,
      [STAFF_EMAIL],
    );
    expect(role.rows[0]).toEqual({ role: 'staff', mobile: '+13195550187' });
    expect(
      await run((c) => addPerson(c, auth, { ...person, email: 'jules@northline.example.com' })),
    ).toEqual({
      ok: false,
      error: 'jules@northline.example.com already signs in to mock-northline-ink',
    });
    expect((await audits()).map((a) => a.action)).toContain('team.person_added');
  });

  it('makes a fresh set-password link only for someone who signs in somewhere', async () => {
    expect(await run((c) => passwordLink(c, auth, STAFF_EMAIL))).toMatchObject({ ok: true });
    expect(await run((c) => passwordLink(c, auth, 'nobody@operator.example.com'))).toEqual({
      ok: false,
      error: 'nobody@operator.example.com does not sign in to any business',
    });
  });

  it('will not go live before setup is finished and a number is in place', async () => {
    expect(await run((c) => goLive(c, SLUG))).toEqual({
      ok: false,
      error:
        'not ready: setup is not finished; no Fifth Stone Connect number yet (set one with `number`)',
    });
  });

  it('moves texting to submitted only when an application is on record', async () => {
    expect(await run((c) => setTexting(c, SLUG, 'submitted'))).toEqual({
      ok: false,
      error: `${SLUG} has not sent a texting application`,
    });
  });

  it('records the number, refusing one another business uses', async () => {
    expect(await run((c) => setNumber(c, SLUG, '+13195550100'))).toEqual({
      ok: false,
      error: '+13195550100 already belongs to mock-riverbend',
    });
    expect(await run((c) => setNumber(c, SLUG, NUMBER))).toEqual({ ok: true, changed: true });
    expect(await run((c) => setNumber(c, SLUG, NUMBER))).toEqual({ ok: true, changed: false });
  });

  // Decision 36: a business that chose no texting goes live on finished setup alone.
  it('goes live without texting once setup is finished', async () => {
    const id = (
      await pool.query<{ id: string }>(`select id from app.tenants where slug = $1`, [SLUG])
    ).rows[0]!.id;
    await pool.query(
      `insert into app.onboarding_progress
         (tenant_id, type_confirmed_at, templates_reviewed_at, test_simulated_at, texting_declined_at)
       values ($1, now(), now(), now(), now());
       insert into app.business_profiles
         (tenant_id, legal_name, street, city, region, postal_code, contact_name, contact_email,
          contact_phone)
       values ($1, 'Operator Test Co LLC', '9988 Test Rd', 'Cedar Falls', 'IA', '50613',
               'Operator Owner', 'owner@operator.example.com', '+13195550188');
       update app.tenant_config
          set business_hours = '[{"days": [1, 2, 3, 4, 5], "open": "08:00", "close": "17:00"}]'
        where tenant_id = $1;
       insert into app.calendar_connections (tenant_id, provider, calendar_id, status, connected_at)
       values ($1, 'google', 'MOCK-GCAL-OPERATOR', 'connected', now());
       update app.portal_users set approves_requests = true where tenant_id = $1;`.replaceAll(
        '$1',
        `'${id}'`,
      ),
    );
    expect(await show()).toMatchObject({ stage: 'ready', texting: 'declined' });

    expect(await run((c) => goLive(c, SLUG))).toEqual({
      ok: true,
      changed: true,
      value: { texting: 'declined' },
    });
    expect(await show()).toMatchObject({ status: 'active', stage: 'live' });
    expect((await audits()).at(-1)).toEqual({
      action: 'tenant.went_live',
      actor_type: 'operator',
      detail: { texting: 'declined' },
    });
    expect(await run((c) => goLive(c, SLUG))).toMatchObject({ ok: true, changed: false });

    const listed = await run(listBusinesses);
    expect(listed.find((b) => b.slug === SLUG)?.stage).toBe('live');
  });

  it('disables the business and its status cards', async () => {
    expect(await run((c) => disableBusiness(c, SLUG))).toEqual({ ok: true, changed: true });
    expect(await show()).toMatchObject({
      status: 'disabled',
      stage: 'disabled',
      texting: 'declined',
    });
    const cards = await pool.query<{ state: string }>(
      `select r.state from app.service_registrations r join app.tenants t on t.id = r.tenant_id
        where t.slug = $1`,
      [SLUG],
    );
    expect(cards.rows.map((r) => r.state)).toEqual(['disabled', 'disabled']);
    expect(await run((c) => disableBusiness(c, SLUG))).toEqual({ ok: true, changed: false });
  });
});
