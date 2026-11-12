import pg from 'pg';

/**
 * Database access for the operator. Unlike apps/api and apps/worker, the operator works across
 * businesses and changes what the application may only read (status, texting status, numbers),
 * so it uses the admin connection from the operator's machine. Every change is one transaction
 * and writes an operator audit event.
 */

export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 2 });
}

export async function inTransaction<T>(
  pool: pg.Pool,
  work: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
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
