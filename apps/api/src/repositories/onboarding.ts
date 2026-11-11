import type { CalendarProviderKey } from '@fsc/core/calendar-providers';
import {
  BusinessHoursListSchema,
  onboardingSteps,
  readyToApply,
  setupStage,
  type BusinessHoursList,
  type BusinessProfile,
  type OnboardingStep,
  type SetupStage,
} from '@fsc/core';
import {
  registrationPreview,
  simulateTestCall,
  trade,
  workflow,
  type RegistrationPreview,
  type TestCallStep,
} from '@fsc/conversation';
import type { DbClient } from '../db.js';
import { activeTemplates } from './replies.js';
import { applyStarterSettings } from './settings.js';

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
    approverChannel: 'text' | 'portal';
    /** The trade inside the workflow; null until the owner picks one. */
    trade: { key: string; name: string } | null;
    jobMinutes: number;
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
  /** The texting application: what goes to the carriers, and when it was sent (decision 35). */
  application: {
    ready: boolean;
    submittedAt: string | null;
    preview: RegistrationPreview | null;
  };
  stage: SetupStage;
  connectNumber: string | null;
}

export type OnboardingError =
  | 'not_provisioned'
  | 'no_approver'
  | 'unknown_person'
  | 'no_templates'
  | 'unknown_trade'
  | 'template_problems'
  | 'setup_incomplete'
  | 'not_confirmed'
  | 'already_live';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** What a typical customer of this trade needs, and the first question asked, for samples. */
function sampleValues(
  tradeKey: string | null,
  question: string | undefined,
): { need?: string; question?: string } {
  const need = tradeKey ? trade(tradeKey)?.sample.values.need : undefined;
  return { ...(need ? { need } : {}), ...(question ? { question } : {}) };
}

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
    approver_channel: 'text' | 'portal' | null;
    trade_key: string | null;
    trade_name: string | null;
    default_job_minutes: number | null;
    connect_number: string | null;
    business_hours: unknown;
    type_confirmed_at: Date | null;
    templates_reviewed_at: Date | null;
    test_simulated_at: Date | null;
    application_submitted_at: Date | null;
    live: boolean;
  }>(
    `select t.timezone, t.status = 'active' as live, c.playbook_key, p.name as playbook_name, p.description,
            p.default_approver_channel as approver_channel,
            c.trade_key, tr.name as trade_name, c.default_job_minutes,
            c.connect_number, c.business_hours,
            o.type_confirmed_at, o.templates_reviewed_at, o.test_simulated_at,
            o.application_submitted_at
       from app.tenants t
       left join app.tenant_config c on c.tenant_id = t.id
       left join app.playbooks p on p.key = c.playbook_key
       left join app.trades tr on tr.key = c.trade_key
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
  const ai = await client.query<{ questions: unknown }>(
    `select content -> 'questions' as questions from app.ai_settings
      where tenant_id = $1 and active`,
    [tenantId],
  );
  const questionsRaw = ai.rows[0]?.questions;
  const questions = Array.isArray(questionsRaw)
    ? questionsRaw.filter((q): q is string => typeof q === 'string')
    : [];

  const hours = BusinessHoursListSchema.safeParse(b.business_hours);
  const p = profile.rows[0];
  const cal = calendar.rows[0] ?? null;

  const steps = onboardingSteps({
    typeConfirmed: b.type_confirmed_at !== null,
    profileSaved: p !== undefined,
    hoursSet: hours.success,
    calendarConnected: cal?.status === 'connected',
    templatesReviewed: b.templates_reviewed_at !== null,
    approvers: team.rows.filter((u) => u.approves_requests).length,
    testRun: b.test_simulated_at !== null,
    applicationSent: b.application_submitted_at !== null,
  });
  const flow = b.playbook_key ? workflow(b.playbook_key) : null;

  return {
    canEdit: role === 'owner',
    steps,
    businessType:
      b.playbook_key && b.playbook_name && b.description && b.approver_channel
        ? {
            key: b.playbook_key,
            name: b.playbook_name,
            description: b.description,
            approverChannel: b.approver_channel,
            trade: b.trade_key && b.trade_name ? { key: b.trade_key, name: b.trade_name } : null,
            jobMinutes: b.default_job_minutes ?? 60,
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
    application: {
      ready: readyToApply(steps),
      submittedAt: iso(b.application_submitted_at),
      preview:
        templates && flow
          ? registrationPreview({
              businessName: templates.business,
              workflow: flow.key,
              templates: templates.content,
              values: sampleValues(b.trade_key, questions[0]),
            })
          : null,
    },
    stage: setupStage(b.live, b.application_submitted_at !== null),
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

/**
 * The owner picks a business type: a workflow and one of its trades (decision 34). The trade's
 * job length, the workflow's starter templates and the trade's starter AI instructions become
 * live, each as a new version the owner can edit or restore. Picking also confirms the step. When
 * the wording changes, the template review is asked for again, since customers will see it.
 */
export async function chooseBusinessType(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  tradeKey: string,
): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  const chosen = trade(tradeKey);
  const flow = chosen ? workflow(chosen.workflow) : null;
  if (!chosen || !flow) return { ok: false, error: 'unknown_trade' };

  const before = await client.query<{ playbook_key: string; trade_key: string | null }>(
    `select playbook_key, trade_key from app.tenant_config where tenant_id = $1 for update`,
    [tenantId],
  );
  const old = before.rows[0];
  if (!old) return { ok: false, error: 'not_provisioned' };

  // Job length comes from the database's trade row, so an unknown or mismatched trade fails here.
  const updated = await client.query(
    `update app.tenant_config c
        set playbook_key = tr.playbook_key, trade_key = tr.key,
            default_job_minutes = tr.default_job_minutes
       from app.trades tr
      where c.tenant_id = $1 and tr.key = $2 and tr.playbook_key = $3`,
    [tenantId, chosen.key, flow.key],
  );
  if (!updated.rowCount) return { ok: false, error: 'unknown_trade' };

  const reason = { workflow: flow.key, trade: chosen.key };
  const templates = await applyStarterSettings(
    client,
    tenantId,
    portalUserId,
    'templates',
    flow.templates,
    reason,
  );
  if (!templates.ok) return { ok: false, error: 'template_problems' };
  const ai = await applyStarterSettings(client, tenantId, portalUserId, 'ai', chosen.ai, reason);
  if (!ai.ok) return { ok: false, error: 'template_problems' };

  await acknowledge(client, tenantId, 'type_confirmed_at');
  if (templates.version !== null) {
    await client.query(
      `update app.onboarding_progress set templates_reviewed_at = null where tenant_id = $1`,
      [tenantId],
    );
  }
  await audit(client, tenantId, portalUserId, 'onboarding.business_type_chosen', {
    ...reason,
    previousWorkflow: old.playbook_key,
    previousTrade: old.trade_key,
    templateVersion: templates.version,
    aiVersion: ai.version,
  });
  return { ok: true };
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
    trade_key: string | null;
    approver_channel: 'text' | 'portal' | null;
    connect_number: string | null;
    caller_name: string;
    caller_mobile: string | null;
    approver_name: string | null;
  }>(
    `select c.playbook_key, c.trade_key, p.default_approver_channel as approver_channel,
            c.connect_number,
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
    trade: f.trade_key,
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

/**
 * The owner sends the texting application once every other step is done (decision 35). It is
 * recorded here; Fifth Stone Dev submits it to the carriers (by hand until the Phase 4 adapter)
 * and moves the texting status card. Sending again after a fix records the latest time. A live
 * business has nothing to apply for.
 */
export async function submitApplication(
  client: DbClient,
  tenantId: string,
  portalUserId: string,
  role: 'owner' | 'staff',
  confirmed: boolean,
): Promise<{ ok: true } | { ok: false; error: OnboardingError }> {
  if (!confirmed) return { ok: false, error: 'not_confirmed' };
  const current = await getOnboarding(client, tenantId, role);
  if (current.stage === 'live') return { ok: false, error: 'already_live' };
  if (!current.application.ready) return { ok: false, error: 'setup_incomplete' };

  await client.query(
    `insert into app.onboarding_progress
       (tenant_id, application_submitted_at, application_submitted_by)
     values ($1, now(), $2)
     on conflict (tenant_id) do update set
       application_submitted_at = excluded.application_submitted_at,
       application_submitted_by = excluded.application_submitted_by`,
    [tenantId, portalUserId],
  );
  await audit(client, tenantId, portalUserId, 'onboarding.application_submitted', {
    resubmitted: current.application.submittedAt !== null,
    templateVersion: current.templates.version,
  });
  return { ok: true };
}
