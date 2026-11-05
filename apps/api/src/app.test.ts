import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, REDACT_PATHS } from './app.js';
import { supabaseTokenVerifier, type TokenVerifier } from './auth.js';
import { createPool } from './db.js';

/**
 * Route tests against the local Supabase stack and its seed data (`npm run db:start`). Mock
 * data only. When the stack is not running these tests are skipped with a warning, so
 * `npm test` still works without Docker.
 */

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

async function databaseReachable(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('select 1 from app.tenants limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const reachable = await databaseReachable();
if (!reachable) console.warn('apps/api route tests skipped: local Supabase stack is not running');

describe.skipIf(!reachable)('portal routes (local stack)', () => {
  let pool: pg.Pool;
  const authUserIds = new Map<string, string>();
  const logLines: string[] = [];

  /** Test verifier: the token is the user's email; real verification is tested separately. */
  const verifyByEmail: TokenVerifier = async (token) => authUserIds.get(token) ?? null;

  const app = () =>
    buildApp({
      pool,
      verifyToken: verifyByEmail,
      logger: {
        level: 'info',
        redact: { paths: REDACT_PATHS, censor: '[redacted]' },
        stream: new Writable({
          write(chunk, _encoding, done) {
            logLines.push(String(chunk));
            done();
          },
        }),
      },
    });

  beforeAll(async () => {
    pool = createPool(DATABASE_URL);
    const { rows } = await pool.query<{ id: string; email: string }>(
      `select id, email from auth.users where email like '%.example.%'`,
    );
    for (const row of rows) authUserIds.set(row.email, row.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  const get = (url: string, token?: string) =>
    app().inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('reports health', async () => {
    const res = await get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('rejects portal requests without a valid token', async () => {
    expect((await get('/portal/today')).statusCode).toBe(401);
    expect((await get('/portal/today', 'not-a-real-token')).statusCode).toBe(401);
  });

  it("refuses a disabled tenant's owner (Old Mill)", async () => {
    const res = await get('/portal/today', 'owen@oldmill.example.net');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'no_portal_access' });
  });

  it('returns the signed-in user and their business', async () => {
    const res = await get('/portal/me', 'rhett@riverbend.example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      displayName: 'Rhett Boyd',
      role: 'owner',
      tenant: {
        name: 'Riverbend Heating & Air',
        slug: 'mock-riverbend',
        timezone: 'America/Chicago',
      },
      services: { texting: 'approved', email: 'submitted' },
      calendar: { provider: 'google', status: 'connected' },
    });
  });

  it("returns Riverbend's Today lanes, and only Riverbend's leads", async () => {
    const res = await get('/portal/today', 'carla@riverbend.example.com');
    expect(res.statusCode).toBe(200);
    const { lanes } = res.json() as {
      lanes: Record<string, { id: string; name: string | null }[]>;
    };
    expect(Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.length]))).toEqual({
      needsYou: 9,
      waitingOnCustomer: 7,
      booked: 2,
      wentQuiet: 1,
    });

    const ids = Object.values(lanes)
      .flat()
      .map((l) => l.id);
    const { rows } = await pool.query<{ slug: string }>(
      `select distinct t.slug from app.leads l join app.tenants t on t.id = l.tenant_id
        where l.id = any($1)`,
      [ids],
    );
    expect(rows).toEqual([{ slug: 'mock-riverbend' }]);

    const marcus = lanes.needsYou?.find((l) => l.name === 'Marcus T.');
    expect(marcus).toMatchObject({ state: 'requested' });
    expect((marcus as unknown as { slotStart: string | null }).slotStart).not.toBeNull();
  });

  /** A Riverbend lead's ID, looked up by contact name (seed IDs are generated). */
  async function riverbendLeadId(name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `select l.id from app.leads l join app.contacts c on c.id = l.contact_id
        where c.display_name = $1 order by l.created_at desc limit 1`,
      [name],
    );
    if (!rows[0]) throw new Error(`No seeded lead for ${name}`);
    return rows[0].id;
  }

  it("returns a lead's page: details, voicemail, thread and the request with its hold", async () => {
    const id = await riverbendLeadId('Marcus T.');
    const res = await get(`/portal/leads/${id}`, 'carla@riverbend.example.com');
    expect(res.statusCode).toBe(200);
    const lead = res.json();
    expect(lead).toMatchObject({
      id,
      state: 'requested',
      urgency: 'flexible',
      address: '9918 Elm St, Cedar Falls',
      contact: { name: 'Marcus T.', phone: '+13195550142', earlierLeads: 0 },
      voicemail: { durationSeconds: 24 },
      request: { state: 'pending', hold: { state: 'active' }, decidedAt: null },
    });
    expect(lead.voicemail.transcript).toContain('This is Marcus');
    expect(
      lead.messages.map((m: { direction: string; author: string }) => `${m.direction}:${m.author}`),
    ).toEqual(['out:template', 'in:customer', 'out:template', 'in:customer', 'out:template']);
  });

  it('counts earlier leads from a repeat customer', async () => {
    const id = await riverbendLeadId('Tom H.');
    const res = await get(`/portal/leads/${id}`, 'rhett@riverbend.example.com');
    expect(res.json()).toMatchObject({ contact: { name: 'Tom H.', earlierLeads: 1 } });
  });

  it("answers 404, not 403, for another business's lead", async () => {
    const id = await riverbendLeadId('Marcus T.');
    const res = await get(`/portal/leads/${id}`, 'mara@northline.example.com');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects a malformed lead ID with a short error code', async () => {
    const res = await get('/portal/leads/not-a-uuid', 'rhett@riverbend.example.com');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('keeps tokens and customer details out of the logs', async () => {
    await get('/portal/today', 'rhett@riverbend.example.com');
    const logs = logLines.join('');
    expect(logs).not.toContain('rhett@riverbend.example.com');
    expect(logs).not.toContain('+1319555');
    expect(logs).not.toContain('Bearer');
  });
});

/**
 * The real sign-in path: a token issued by local Supabase Auth, verified against its published
 * keys. Needs the local anon key (`SUPABASE_ANON_KEY`, from `npx supabase status`).
 */
const anonKey = process.env.SUPABASE_ANON_KEY;
describe.skipIf(!reachable || !anonKey || anonKey === 'CHANGE_ME')('real Supabase sign-in', () => {
  it('accepts a token from local Supabase Auth and rejects a tampered one', async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'rhett@riverbend.example.com', password: 'mock-local-only' }),
    });
    const { access_token: token } = (await res.json()) as { access_token: string };
    const pool = createPool(DATABASE_URL);
    try {
      const app = buildApp({
        pool,
        verifyToken: supabaseTokenVerifier(SUPABASE_URL),
        logger: false,
      });
      const ok = await app.inject({
        method: 'GET',
        url: '/portal/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
      const tampered = `${token.slice(0, -4)}AAAA`;
      const bad = await app.inject({
        method: 'GET',
        url: '/portal/me',
        headers: { authorization: `Bearer ${tampered}` },
      });
      expect(bad.statusCode).toBe(401);
    } finally {
      await pool.end();
    }
  });
});
