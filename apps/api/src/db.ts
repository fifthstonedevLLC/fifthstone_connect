import pg from 'pg';

/**
 * Database access. Every query runs inside a transaction as the application role `fsc_app`,
 * whatever role the connection itself uses, so row-level security always applies (ADR-0003
 * decision 6). Tenant work also sets the transaction's tenant context.
 */

export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
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

/**
 * Work before a tenant is known (sign-in, inbound routing). Tenant tables return nothing here;
 * only the narrow resolver functions granted to `fsc_app` are useful.
 */
export function withoutTenant<T>(
  pool: pg.Pool,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, null, work);
}
