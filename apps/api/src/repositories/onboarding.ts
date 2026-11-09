import type { CalendarProviderKey } from '@fsc/core/calendar-providers';
import {
  BusinessHoursListSchema,
  onboardingSteps,
  type BusinessHoursList,
  type BusinessProfile,
  type OnboardingStep,
} from '@fsc/core';
import { simulateTestCall, type TestCallStep } from '@fsc/conversation';
import type { DbClient } from '../db.js';
import { activeTemplates } from './replies.js';

/**
 * Onboarding inside the portal (SCOPE.md v0.2). Runs inside `withTenant`. Details are captured
 * and versioned nowhere else; nothing is sent to a vendor (Phase 4). The test call is a labeled
 * simulation until texting is live. Every write is an audit event that names what changed, never
 * the values (an EIN stays out of the audit trail).
 */

export interface Onboarding {
  canEdit: boolean;
  steps: { key: OnboardingStep; done: boolean }[];
  businessType: {
    key: string;
    name: string;
    description: string;
    minimumData: boolean;
    approverChannel: 'text' | 'portal';
    confirmedAt: string | null;
  } | null;
  details: (BusinessProfile & { updatedAt: string }) | null;
  hours: BusinessHoursList | [];
  timezone: string;
  calendar: {
    provider: CalendarProviderKey;
    status: 'connected' | 'revoked' | 'disconnected';
  } | null;
  templates: { version: number | null; reviewedAt: string | null; questions: string[] };
  team: {
    id: string;
    name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approvesRequests: boolean;
  }[];
  test: { simulatedAt: string | null };
  connectNumber: string | null;
}

export type OnboardingError = 'not_provisioned' | 'no_approver' | 'unknown_person' | 'no_templates';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getOnboarding(
  client: DbClient,
  tenantId: string,
  role: 'owner' | 'staff',
): Promise<Onboarding> {
  const base = await client.query<{
    timezone: string;
    playbook_key: string | null;
    playbook_name: string | null;
    description: string | null;
    clinic_minimum_data: boolean | null;
    approver_channel: 'text' | 'portal' | null;
    connect_number: string | null;
    business_hours: unknown;
    type_confirmed_at: Date | null;
    templates_reviewed_at: Date | null;
    test_simulated_at: Date | null;
  }>(
    `select t.timezone, c.playbook_key, p.name as playbook_name, p.description,
            c.clinic_minimum_data, p.default_approver_channel as approver_channel,
            c.connect_number, c.business_hours,
            o.type_confirmed_at, o.templates_reviewed_at, o.test_simulated_at
       from app.tenants t
       left join app.tenant_config c on c.tenant_id = t.id
       left join app.playbooks p on p.key = c.playbook_key
       left join app.onboarding_progress o on o.tenant_id = t.id
      where t.id = $1`,
    [tenantId],
  );
  const b = base.rows[0];
  if (!b) throw new Error('tenant not visible in its own context');

  const calendar = await client.query<{
    provider: CalendarProviderKey;
    status: 'connected' | 'revoked' | 'disconnected';
  }>(
    `select provider, status from app.calendar_connections
      where tenant_id = $1 order by updated_at desc limit 1`,
    [tenantId],
  );
  const profile = await client.query<{
    legal_name: string;
    ein: string | null;
    street: string;
    city: string;
    region: string;
    postal_code: string;
    website: string | null;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    updated_at: Date;
  }>(
    `select legal_name, ein, street, city, region, postal_code, website, contact_name,
            contact_email, contact_phone, updated_at
       from app.business_profiles where tenant_id = $1`,
    [tenantId],
  );
  const team = await client.query<{
    id: string;
    display_name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approves_requests: boolean;
  }>(
    `select id, display_name, role, mobile, approves_requests from app.portal_users
      where tenant_id = $1 order by role = 'owner' desc, display_name`,
    [tenantId],
  );
  const templates = await activeTemplates(client, tenantId);
  // Minimum-data businesses have no AI questions; their front desk asks only for times.
  const ai = b.clinic_minimum_data
    ? null
    : await client.query<{ questions: unknown }>(
        `select content -> 'questions' as questions from app.ai_settings
          where tenant_id = $1 and active`,
        [tenantId],
      );
  const questionsRaw = ai?.rows[0]?.questions;
  const questions = Array.isArray(questionsRaw)
    ? questionsRaw.filter((q): q is string => typeof q === 'string')
    : [];

  const hours = BusinessHoursListSchema.safeParse(b.business_hours);
  const p = profile.rows[0];
  const cal = calendar.rows[0] ?? null;

  return {
    canEdit: role === 'owner',
    steps: onboardingSteps({
      typeConfirmed: b.type_confirmed_at !== null,
      profileSaved: p !== undefined,
      hoursSet: hours.success,
      calendarConnected: cal?.status === 'connected',
      templatesReviewed: b.templates_reviewed_at !== null,
      approvers: team.rows.filter((u) => u.approves_requests).length,
      testRun: b.test_simulated_at !== null,
    }),
    businessType:
      b.playbook_key && b.playbook_name && b.description && b.approver_channel
        ? {
            key: b.playbook_key,
            name: b.playbook_name,
            description: b.description,
            minimumData: b.clinic_minimum_data ?? true,
            approverChannel: b.approver_channel,
            confirmedAt: iso(b.type_confirmed_at),
          }
        : null,
    details: p
      ? {
          legalName: p.legal_name,
          ...(p.ein ? { ein: p.ein } : {}),
          street: p.street,
          city: p.city,
          region: p.region as BusinessProfile['region'],
          postalCode: p.postal_code,
          ...(p.website ? { website: p.website } : {}),
          contactName: p.contact_name,
          contactEmail: p.contact_email,
          contactPhone: p.contact_phone,
          updatedAt: p.updated_at.toISOString(),
        }
      : null,
    hours: hours.success ? hours.data : [],
    timezone: b.timezone,
    calendar: cal,
    templates: {
      version: templates?.version ?? null,
      reviewedAt: iso(b.templates_reviewed_at),
      questions,
    },
    team: team.rows.map((u) => ({
      id: u.id,
      name: u.display_name,
      role: u.role,
      mobile: u.mobile,
      approvesRequests: u.approves_requests,
    })),
    test: { simulatedAt: iso(b.test_simulated_at) },
    connectNumber: b.connect_number,
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

/**
 * Records an acknowledged step. The business type keeps its first confirmation; a template
 * review or a test run records the latest time.
 */
async function acknowledge(
  client: DbClient,
  tenantId: string,
  column: 'type_confirmed_at' | 'templates_reviewed_at' | 'test_simulated_at',
): Promise<void> {
  // `column` is one of three fixed names, never input.
  const value =
    column === 'type_confirmed_at'
      ? `coalesce(app.onboarding_progress.${column}, excluded.${column})`
      : `excluded.${column}`;
  await client.query(
    `insert into app.onboarding_progress (tenant_id, ${column}) values ($1, now())
     on conflict (tenant_id) do update set ${column} = ${value}`,
    [tenantId],
  );
}

export async function confirmBusinessType(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
): Promise<void> {
  await acknowledge(client, tenantId, 'type_confirmed_at');
  await audit(client, tenantId, portalUserId, 'onboarding.type_confirmed', {});
}

const PROFILE_COLUMNS: [keyof BusinessProfile, string][] = [
  ['legalName', 'legal_name'],
  ['ein', 'ein'],
  ['street', 'street'],
  ['city', 'city'],
  ['region', 'region'],
  ['postalCode', 'postal_code'],
  ['website', 'website'],
  ['contactName', 'contact_name'],
  ['contactEmail', 'contact_email'],
  ['contactPhone', 'contact_phone'],
];

export async function saveBusinessDetails(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  profile: BusinessProfile,
): Promise<void> {
  const before = await client.query<Record<string, string | null>>(
    `select ${PROFILE_COLUMNS.map(([, c]) => c).join(', ')}
       from app.business_profiles where tenant_id = $1`,
    [tenantId],
  );
  const values = PROFILE_COLUMNS.map(([key]) => profile[key] ?? null);
  await client.query(
    `insert into app.business_profiles
       (tenant_id, updated_by, ${PROFILE_COLUMNS.map(([, c]) => c).join(', ')})
     values ($1, $2, ${PROFILE_COLUMNS.map((_, i) => `$${i + 3}`).join(', ')})
     on conflict (tenant_id) do update set
       updated_by = excluded.updated_by,
       ${PROFILE_COLUMNS.map(([, c]) => `${c} = excluded.${c}`).join(',\n       ')}`,
    [tenantId, portalUserId, ...values],
  );
  const old = before.rows[0];
  const changed = PROFILE_COLUMNS.filter(([, c], i) => (old?.[c] ?? null) !== values[i]).map(
    ([key]) => key,
  );
  await audit(client, tenantId, portalUserId, 'onboarding.details_saved', { changed });
}

export async function saveHours(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  hours: BusinessHoursList,
): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  const updated = await client.query(
    `update app.tenant_config set business_hours = $2 where tenant_id = $1`,
    [tenantId, JSON.stringify(hours)],
  );
  if (!updated.rowCount) return { ok: false, error: 'not_provisioned' };
  await audit(client, tenantId, portalUserId, 'onboarding.hours_saved', { blocks: hours.length });
  return { ok: true };
}

export async function markTemplatesReviewed(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  const templates = await activeTemplates(client, tenantId);
  if (!templates) return { ok: false, error: 'no_templates' };
  await acknowledge(client, tenantId, 'templates_reviewed_at');
  await audit(client, tenantId, portalUserId, 'onboarding.templates_reviewed', {
    templateVersion: templates.version,
  });
  return { ok: true };
}

export async function saveApprovers(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  approverIds: string[],
): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  if (approverIds.length === 0) return { ok: false, error: 'no_approver' };
  const known = await client.query<{ id: string }>(
    `select id from app.portal_users where tenant_id = $1 and id = any($2)`,
    [tenantId, approverIds],
  );
  // Another business's person is unknown here, exactly like someone who does not exist.
  if (known.rowCount !== new Set(approverIds).size) return { ok: false, error: 'unknown_person' };
  await client.query(
    `update app.portal_users set approves_requests = (id = any($2)) where tenant_id = $1`,
    [tenantId, approverIds],
  );
  await audit(client, tenantId, portalUserId, 'onboarding.approvers_saved', {
    approvers: [...new Set(approverIds)].sort(),
  });
  return { ok: true };
}

/**
 * Plays a missed call through the business's live templates and records that the test ran. This
 * is a simulation: no call is placed, no text is sent and no lead is created.
 */
export async function runTestCall(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
): Promise<{ ok: true; steps: TestCallStep[] } | { ok: false; error: OnboardingError }> {
  const templates = await activeTemplates(client, tenantId);
  if (!templates) return { ok: false, error: 'no_templates' };
  const facts = await client.query<{
    playbook_key: string | null;
    approver_channel: 'text' | 'portal' | null;
    connect_number: string | null;
    caller_name: string;
    caller_mobile: string | null;
    approver_name: string | null;
  }>(
    `select c.playbook_key, p.default_approver_channel as approver_channel, c.connect_number,
            me.display_name as caller_name, me.mobile as caller_mobile,
            (select display_name from app.portal_users
              where tenant_id = $1 and approves_requests
              order by role = 'owner' desc, display_name limit 1) as approver_name
       from app.portal_users me
       left join app.tenant_config c on c.tenant_id = me.tenant_id
       left join app.playbooks p on p.key = c.playbook_key
      where me.tenant_id = $1 and me.id = $2`,
    [tenantId, portalUserId],
  );
  const f = facts.rows[0];
  if (!f?.playbook_key || !f.approver_channel) return { ok: false, error: 'not_provisioned' };

  const steps = simulateTestCall({
    businessName: templates.business,
    playbook: f.playbook_key,
    connectNumber: f.connect_number,
    callerName: f.caller_name,
    callerNumber: f.caller_mobile,
    approverName: f.approver_name,
    approverChannel: f.approver_channel,
    templates: templates.content,
  });
  await acknowledge(client, tenantId, 'test_simulated_at');
  await audit(client, tenantId, portalUserId, 'onboarding.test_simulated', {
    simulated: true,
    templateVersion: templates.version,
  });
  return { ok: true, steps };
}
