import pg from 'pg';

/**
 * Database access for the worker, with the same rules as apps/api: every query runs inside a
 * transaction as the application role `fsc_app`, so row-level security always applies, and tenant
 * work sets the transaction's tenant context (ADR-0003 decision 6).
 */

export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 5 });
}

async function inTransaction<T>(
  pool: pg.Pool,
  tenantId: string | null,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role fsc_app');
    if (tenantId !== null) {
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Work for one tenant: row-level security limits every query to that tenant's rows. */
export function withTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, tenantId, work);
}

/** Claiming jobs, before any tenant is known: only `app.claim_jobs` is useful here. */
export function withoutTenant<T>(
  pool: pg.Pool,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, null, work);
}
