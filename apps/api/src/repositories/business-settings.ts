import {
  CAPABILITIES,
  FREE_TEXT_CHANNELS,
  type Capability,
  type FreeTextChannel,
  type ServiceRegistrationState,
} from '@fsc/core';
import type { DbClient } from '../db.js';
import { permissionSettings } from './permissions.js';

/**
 * The Settings page (Iteration 1, ROADMAP.md): the team, what staff can do (decision 40), the
 * free-text switch (decision 39) and the Act now limit (decision 37). Runs inside `withTenant`.
 * Everyone can read it; the route lets only the owner write. Each write is an audit event.
 */

export interface BusinessSettings {
  canEdit: boolean;
  team: {
    id: string;
    name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approvesRequests: boolean;
    active: boolean;
  }[];
  staffCapabilities: Capability[];
  freeTextChannels: FreeTextChannel[];
  actNowAfterHours: number;
  texting: { state: ServiceRegistrationState; declined: boolean };
}

export type BusinessSettingsError = 'not_found' | 'owner_stays_active' | 'not_provisioned';

export async function getBusinessSettings(
  client: DbClient,
  tenantId: string,
  role: 'owner' | 'staff',
): Promise<BusinessSettings> {
  const team = await client.query<{
    id: string;
    display_name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approves_requests: boolean;
    disabled_at: Date | null;
  }>(
    `select id, display_name, role, mobile, approves_requests, disabled_at
       from app.portal_users where tenant_id = $1
      order by role = 'owner' desc, display_name`,
    [tenantId],
  );
  const config = await client.query<{
    act_now_after_hours: number;
    texting: ServiceRegistrationState | null;
    declined: boolean;
  }>(
    `select c.act_now_after_hours,
            (select state from app.service_registrations
              where tenant_id = c.tenant_id and service = 'texting') as texting,
            exists (select 1 from app.onboarding_progress o
                     where o.tenant_id = c.tenant_id and o.texting_declined_at is not null)
              as declined
       from app.tenant_config c where c.tenant_id = $1`,
    [tenantId],
  );
  const permissions = await permissionSettings(client, tenantId);
  const c = config.rows[0];
  return {
    canEdit: role === 'owner',
    team: team.rows.map((u) => ({
      id: u.id,
      name: u.display_name,
      role: u.role,
      mobile: u.mobile,
      approvesRequests: u.approves_requests,
      active: u.disabled_at === null,
    })),
    staffCapabilities: CAPABILITIES.filter((cap) => permissions.staffCapabilities.includes(cap)),
    freeTextChannels: permissions.freeTextChannels,
    actNowAfterHours: c?.act_now_after_hours ?? 24,
    texting: { state: c?.texting ?? 'not_started', declined: c?.declined ?? false },
  };
}

async function audit(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into app.audit_events (tenant_id, actor_type, actor_portal_user_id, action, detail)
     values ($1, 'portal_user', $2, $3, $4)`,
    [tenantId, portalUserId, action, JSON.stringify(detail)],
  );
}

type Result = { ok: true } | { ok: false; error: BusinessSettingsError };

/** What staff can do; the owner always can do everything (decision 40). */
export async function saveStaffCapabilities(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  capabilities: Capability[],
): Promise<Result> {
  const before = await permissionSettings(client, tenantId);
  const next = CAPABILITIES.filter((c) => capabilities.includes(c));
  const updated = await client.query(
    `update app.tenant_config set staff_capabilities = $2 where tenant_id = $1`,
    [tenantId, next],
  );
  if (!updated.rowCount) return { ok: false, error: 'not_provisioned' };
  await audit(client, tenantId, portalUserId, 'settings.staff_permissions_saved', {
    granted: next.filter((c) => !before.staffCapabilities.includes(c)),
    removed: before.staffCapabilities.filter((c) => !next.includes(c as Capability)),
  });
  return { ok: true };
}

/** Channels where people allowed to may type their own replies (decision 39). */
export async function saveFreeTextChannels(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  channels: FreeTextChannel[],
): Promise<Result> {
  const next = FREE_TEXT_CHANNELS.filter((c) => channels.includes(c));
  const updated = await client.query(
    `update app.tenant_config set free_text_channels = $2 where tenant_id = $1`,
    [tenantId, next],
  );
  if (!updated.rowCount) return { ok: false, error: 'not_provisioned' };
  await audit(client, tenantId, portalUserId, 'settings.free_text_saved', { channels: next });
  return { ok: true };
}

/** How long a lead may wait before it goes to Act now (decision 37). */
export async function saveActNowHours(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  hours: number,
): Promise<Result> {
  const updated = await client.query(
    `update app.tenant_config set act_now_after_hours = $2 where tenant_id = $1`,
    [tenantId, hours],
  );
  if (!updated.rowCount) return { ok: false, error: 'not_provisioned' };
  await audit(client, tenantId, portalUserId, 'settings.act_now_saved', { hours });
  return { ok: true };
}

/**
 * Turns a person's access off or back on. Someone turned off cannot sign in and stops receiving
 * approval texts. The owner always stays on: a business is never left without one.
 */
export async function setPersonActive(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  personId: string,
  active: boolean,
): Promise<Result> {
  const person = await client.query<{ role: 'owner' | 'staff' }>(
    `select role from app.portal_users where tenant_id = $1 and id = $2 for update`,
    [tenantId, personId],
  );
  const row = person.rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.role === 'owner' && !active) return { ok: false, error: 'owner_stays_active' };
  await client.query(
    `update app.portal_users
        set disabled_at = case when $3 then null else coalesce(disabled_at, now()) end,
            approves_requests = approves_requests and $3
      where tenant_id = $1 and id = $2`,
    [tenantId, personId, active],
  );
  await audit(
    client,
    tenantId,
    portalUserId,
    active ? 'team.person_enabled' : 'team.person_disabled',
    {
      personId,
    },
  );
  return { ok: true };
}
