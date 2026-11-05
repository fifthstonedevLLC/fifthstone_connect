import type { DbClient } from '../db.js';

export interface Me {
  displayName: string;
  role: 'owner' | 'staff';
  tenant: { name: string; slug: string };
}

/** The signed-in portal user and their business, for the portal header. Runs inside `withTenant`. */
export async function getMe(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
): Promise<Me | null> {
  const { rows } = await client.query<{
    display_name: string;
    role: 'owner' | 'staff';
    tenant_name: string;
    slug: string;
  }>(
    `select pu.display_name, pu.role, t.name as tenant_name, t.slug
       from app.portal_users pu
       join app.tenants t on t.id = pu.tenant_id
      where pu.tenant_id = $1 and pu.id = $2`,
    [tenantId, portalUserId],
  );
  const row = rows[0];
  return row
    ? {
        displayName: row.display_name,
        role: row.role,
        tenant: { name: row.tenant_name, slug: row.slug },
      }
    : null;
}
