import { can, capabilitiesOf, type Capability, type FreeTextChannel } from '@fsc/core';
import type { DbClient } from '../db.js';

/**
 * The business's permission settings (decisions 39 and 40). Runs inside `withTenant`. A business
 * without config gets the defaults the columns declare, so nothing widens by accident.
 */

export interface PermissionSettings {
  staffCapabilities: string[];
  freeTextChannels: FreeTextChannel[];
}

export async function permissionSettings(
  client: DbClient,
  tenantId: string,
): Promise<PermissionSettings> {
  const { rows } = await client.query<{
    staff_capabilities: string[];
    free_text_channels: FreeTextChannel[];
  }>(`select staff_capabilities, free_text_channels from app.tenant_config where tenant_id = $1`, [
    tenantId,
  ]);
  const row = rows[0];
  return {
    staffCapabilities: row?.staff_capabilities ?? ['act_on_leads', 'reply_templates'],
    freeTextChannels: row?.free_text_channels ?? [],
  };
}

export async function userCan(
  client: DbClient,
  tenantId: string,
  role: 'owner' | 'staff',
  capability: Capability,
): Promise<boolean> {
  if (role === 'owner') return true;
  const { staffCapabilities } = await permissionSettings(client, tenantId);
  return can(role, staffCapabilities, capability);
}

export async function userCapabilities(
  client: DbClient,
  tenantId: string,
  role: 'owner' | 'staff',
): Promise<Capability[]> {
  return capabilitiesOf(role, (await permissionSettings(client, tenantId)).staffCapabilities);
}
