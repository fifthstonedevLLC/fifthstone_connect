import type { CalendarProviderKey } from '@fsc/core/calendar-providers';
import { setupStage, type ServiceRegistrationState, type SetupStage } from '@fsc/core';
import type { DbClient } from '../db.js';

export interface Me {
  displayName: string;
  role: 'owner' | 'staff';
  tenant: { name: string; slug: string; timezone: string };
  /** Setting up, application sent, or live; only live businesses get the working pages. */
  stage: SetupStage;
  /** Portal status cards; a service with no registration row reads `not_started`. */
  services: { texting: ServiceRegistrationState; email: ServiceRegistrationState };
  calendar: {
    provider: CalendarProviderKey;
    status: 'connected' | 'revoked' | 'disconnected';
  } | null;
}

/**
 * The signed-in portal user, their business and its service status, for the portal shell.
 * Runs inside `withTenant`.
 */
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
    timezone: string;
    live: boolean;
    applied: boolean;
    texting: ServiceRegistrationState | null;
    email: ServiceRegistrationState | null;
    calendar_provider: CalendarProviderKey | null;
    calendar_status: 'connected' | 'revoked' | 'disconnected' | null;
  }>(
    `select pu.display_name, pu.role, t.name as tenant_name, t.slug, t.timezone,
            t.status = 'active' as live,
            exists (select 1 from app.onboarding_progress
                     where tenant_id = $1 and application_submitted_at is not null) as applied,
            (select state from app.service_registrations
              where tenant_id = $1 and service = 'texting') as texting,
            (select state from app.service_registrations
              where tenant_id = $1 and service = 'email') as email,
            cc.provider as calendar_provider, cc.status as calendar_status
       from app.portal_users pu
       join app.tenants t on t.id = pu.tenant_id
       left join lateral (
         select provider, status from app.calendar_connections
          where tenant_id = $1 order by updated_at desc limit 1
       ) cc on true
      where pu.tenant_id = $1 and pu.id = $2`,
    [tenantId, portalUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    displayName: row.display_name,
    role: row.role,
    tenant: { name: row.tenant_name, slug: row.slug, timezone: row.timezone },
    stage: setupStage(row.live, row.applied),
    services: { texting: row.texting ?? 'not_started', email: row.email ?? 'not_started' },
    calendar:
      row.calendar_provider && row.calendar_status
        ? { provider: row.calendar_provider, status: row.calendar_status }
        : null,
  };
}
