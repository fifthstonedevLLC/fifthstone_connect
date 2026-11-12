import {
  factsFromProgress,
  goLiveProblems,
  normalizeEmail,
  onboardingSteps,
  setupDone,
  setupStage,
  type GoLiveProblem,
  type OnboardingStep,
  type ServiceRegistrationState,
  type SetupStage,
} from '@fsc/core';
import { WORKFLOW_KEYS, type WorkflowKey } from '@fsc/conversation';
import type { AuthAdmin } from './auth-admin.js';
import type { DbClient } from './db.js';

/**
 * Operator commands (ADR-0003 decision 5; decisions 23, 35 and 36). Each runs in one transaction
 * on the admin connection, is safe to run twice, and writes an operator audit event when it
 * changes something. The rules for going live live in @fsc/core; this file is the wiring.
 */

type TenantStatus = 'onboarding' | 'active' | 'disabled';

export interface BusinessSummary {
  slug: string;
  name: string;
  status: TenantStatus;
  stage: SetupStage | 'disabled';
  /** The texting status card, or `declined` when the owner chose no texting (decision 36). */
  texting: ServiceRegistrationState | 'declined';
  connectNumber: string | null;
  steps: { key: OnboardingStep; done: boolean }[];
  owner: string | null;
}

export type CommandResult<T = undefined> =
  { ok: true; changed: boolean; value?: T } | { ok: false; error: string };

const SUMMARY_SQL = `
  select t.id, t.slug, t.name, t.status, c.connect_number,
         (select state from app.service_registrations
           where tenant_id = t.id and service = 'texting') as texting,
         (select u.email::text from app.portal_users pu join auth.users u on u.id = pu.auth_user_id
           where pu.tenant_id = t.id and pu.role = 'owner' order by pu.created_at limit 1) as owner,
         sp.*
    from app.tenants t
    left join app.tenant_config c on c.tenant_id = t.id
    join app.setup_progress sp on sp.tenant_id = t.id`;

type SummaryRow = Parameters<typeof factsFromProgress>[0] & {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  connect_number: string | null;
  texting: ServiceRegistrationState | null;
  owner: string | null;
};

function summarize(row: SummaryRow): BusinessSummary {
  const steps = onboardingSteps(factsFromProgress(row));
  return {
    slug: row.slug,
    name: row.name,
    status: row.status,
    stage:
      row.status === 'disabled'
        ? 'disabled'
        : setupStage(row.status === 'active', setupDone(steps)),
    texting: row.texting_declined ? 'declined' : (row.texting ?? 'not_started'),
    connectNumber: row.connect_number,
    steps,
    owner: row.owner,
  };
}

export async function listBusinesses(client: DbClient): Promise<BusinessSummary[]> {
  const { rows } = await client.query<SummaryRow>(`${SUMMARY_SQL} order by t.slug`);
  return rows.map(summarize);
}

async function find(
  client: DbClient,
  slug: string,
  lock = false,
): Promise<(BusinessSummary & { id: string }) | null> {
  if (lock) {
    await client.query(`select 1 from app.tenants where slug = $1 for update`, [slug]);
  }
  const { rows } = await client.query<SummaryRow>(`${SUMMARY_SQL} where t.slug = $1`, [slug]);
  const row = rows[0];
  return row ? { ...summarize(row), id: row.id } : null;
}

export function showBusiness(client: DbClient, slug: string) {
  return find(client, slug);
}

async function audit(
  client: DbClient,
  tenantId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into app.audit_events (tenant_id, actor_type, action, detail)
     values ($1, 'operator', $2, $3)`,
    [tenantId, action, JSON.stringify(detail)],
  );
}

// Create --------------------------------------------------------------------------------------

export interface CreateInput {
  slug: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  timezone: string;
  workflow: string;
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a business as `onboarding` (decision 35) with its config, texting and email status
 * cards at `not_started`, and its owner's login. Running it again with the same details changes
 * nothing; a slug or login that belongs to something else is refused.
 */
export async function createBusiness(
  client: DbClient,
  auth: AuthAdmin,
  input: CreateInput,
): Promise<CommandResult<{ setPasswordLink: string }>> {
  const email = normalizeEmail(input.ownerEmail);
  if (!email) return { ok: false, error: 'the owner email is not valid' };
  if (!validTimezone(input.timezone)) return { ok: false, error: 'unknown time zone' };
  if (!(WORKFLOW_KEYS as readonly string[]).includes(input.workflow)) {
    return { ok: false, error: `workflow must be one of: ${WORKFLOW_KEYS.join(', ')}` };
  }
  const workflow = input.workflow as WorkflowKey;

  const existing = await client.query<{ id: string; name: string }>(
    `select id, name from app.tenants where slug = $1 for update`,
    [input.slug],
  );
  if (existing.rows[0] && existing.rows[0].name !== input.name) {
    return { ok: false, error: `${input.slug} already belongs to ${existing.rows[0].name}` };
  }

  const authUserId = await auth.ensureUser(email);
  const elsewhere = await client.query<{ slug: string }>(
    `select t.slug from app.portal_users pu join app.tenants t on t.id = pu.tenant_id
      where pu.auth_user_id = $1`,
    [authUserId],
  );
  const otherSlug = elsewhere.rows[0]?.slug;
  if (otherSlug && otherSlug !== input.slug) {
    return { ok: false, error: `${email} already signs in to ${otherSlug}` };
  }

  let changed = false;
  let tenantId = existing.rows[0]?.id;
  if (!tenantId) {
    const created = await client.query<{ id: string }>(
      `insert into app.tenants (slug, name, status, timezone) values ($1, $2, 'onboarding', $3)
       returning id`,
      [input.slug, input.name, input.timezone],
    );
    tenantId = created.rows[0]!.id;
    changed = true;
  }
  const config = await client.query(
    `insert into app.tenant_config (tenant_id, playbook_key, business_hours, default_job_minutes)
     select $1, key, '[]', default_job_minutes from app.playbooks where key = $2
     on conflict (tenant_id) do nothing`,
    [tenantId, workflow],
  );
  const cards = await client.query(
    `insert into app.service_registrations (tenant_id, service, state)
     values ($1, 'texting', 'not_started'), ($1, 'email', 'not_started')
     on conflict (tenant_id, service) do nothing`,
    [tenantId],
  );
  const owner = await client.query(
    `insert into app.portal_users (tenant_id, auth_user_id, role, display_name)
     values ($1, $2, 'owner', $3)
     on conflict (auth_user_id) do nothing`,
    [tenantId, authUserId, input.ownerName],
  );
  changed ||= Boolean(config.rowCount || cards.rowCount || owner.rowCount);
  if (changed) {
    await audit(client, tenantId, 'tenant.provisioned', { workflow, status: 'onboarding' });
  }
  return { ok: true, changed, value: { setPasswordLink: await auth.setPasswordLink(email) } };
}

// Number, texting, go-live, disable -----------------------------------------------------------

/** Records the Fifth Stone Connect number bought for the business (the purchase is manual). */
export async function setNumber(
  client: DbClient,
  slug: string,
  number: string,
): Promise<CommandResult> {
  const business = await find(client, slug, true);
  if (!business) return { ok: false, error: `no business ${slug}` };
  if (!/^\+[1-9][0-9]{7,14}$/.test(number))
    return { ok: false, error: 'use E.164, like +13195550100' };
  if (business.connectNumber === number) return { ok: true, changed: false };
  const taken = await client.query<{ slug: string }>(
    `select t.slug from app.tenant_config c join app.tenants t on t.id = c.tenant_id
      where c.connect_number = $1`,
    [number],
  );
  if (taken.rows[0])
    return { ok: false, error: `${number} already belongs to ${taken.rows[0].slug}` };
  await client.query(`update app.tenant_config set connect_number = $2 where tenant_id = $1`, [
    business.id,
    number,
  ]);
  await audit(client, business.id, 'tenant.number_set', {
    number,
    previous: business.connectNumber,
  });
  return { ok: true, changed: true };
}

export const TEXTING_STATES = ['not_started', 'submitted', 'approved', 'rejected'] as const;
export type TextingState = (typeof TEXTING_STATES)[number];

/**
 * Moves the texting status card as the carriers answer. `submitted` and `approved` need an
 * application on record: a business that chose no texting has nothing with the carriers.
 */
export async function setTexting(
  client: DbClient,
  slug: string,
  state: TextingState,
  note?: string,
): Promise<CommandResult> {
  const business = await find(client, slug, true);
  if (!business) return { ok: false, error: `no business ${slug}` };
  if (business.status === 'disabled') return { ok: false, error: `${slug} is disabled` };
  const sent = await client.query<{ sent: boolean }>(
    `select application_submitted_at is not null as sent from app.onboarding_progress
      where tenant_id = $1`,
    [business.id],
  );
  if ((state === 'submitted' || state === 'approved') && !sent.rows[0]?.sent) {
    return { ok: false, error: `${slug} has not sent a texting application` };
  }
  if (business.texting === state) return { ok: true, changed: false };
  await client.query(
    `insert into app.service_registrations (tenant_id, service, state) values ($1, 'texting', $2)
     on conflict (tenant_id, service) do update set state = excluded.state, updated_at = now()`,
    [business.id, state],
  );
  await audit(client, business.id, 'texting.status_changed', {
    from: business.texting,
    to: state,
    ...(note ? { note } : {}),
  });
  return { ok: true, changed: true };
}

const GO_LIVE_TEXT: Record<GoLiveProblem, string> = {
  disabled: 'the business is disabled',
  already_live: 'the business is already live',
  setup_incomplete: 'setup is not finished',
  no_number: 'no Fifth Stone Connect number yet (set one with `number`)',
};

/**
 * Turns a business on (decision 36): setup finished and a number to forward calls to. Texting
 * approval is not needed; texting switches on whenever it is approved.
 */
export async function goLive(
  client: DbClient,
  slug: string,
): Promise<CommandResult<{ texting: BusinessSummary['texting'] }>> {
  const business = await find(client, slug, true);
  if (!business) return { ok: false, error: `no business ${slug}` };
  const problems = goLiveProblems({
    status: business.status,
    setupDone: setupDone(business.steps),
    connectNumber: business.connectNumber,
  });
  if (problems.includes('already_live')) {
    return { ok: true, changed: false, value: { texting: business.texting } };
  }
  if (problems.length > 0) {
    return { ok: false, error: `not ready: ${problems.map((p) => GO_LIVE_TEXT[p]).join('; ')}` };
  }
  await client.query(`update app.tenants set status = 'active' where id = $1`, [business.id]);
  await audit(client, business.id, 'tenant.went_live', { texting: business.texting });
  return { ok: true, changed: true, value: { texting: business.texting } };
}

/**
 * Offboarding: the business stops receiving anything and its people can no longer sign in. Its
 * data stays (OFFBOARDING.md). Releasing the number in Twilio is a separate, manual step.
 */
export async function disableBusiness(client: DbClient, slug: string): Promise<CommandResult> {
  const business = await find(client, slug, true);
  if (!business) return { ok: false, error: `no business ${slug}` };
  if (business.status === 'disabled') return { ok: true, changed: false };
  await client.query(`update app.tenants set status = 'disabled' where id = $1`, [business.id]);
  await client.query(
    `update app.service_registrations set state = 'disabled', updated_at = now()
      where tenant_id = $1`,
    [business.id],
  );
  await audit(client, business.id, 'tenant.disabled', { previous: business.status });
  return { ok: true, changed: true };
}

// People ----------------------------------------------------------------------------------------

export interface AddPersonInput {
  slug: string;
  name: string;
  email: string;
  /** E.164 mobile, for approval texts; optional. */
  mobile?: string;
}

/**
 * Adds a staff member to a business and makes their login (Iteration 1; owners are made by
 * `create`). What they can do is what the owner grants in Settings (decision 40). Running it again
 * changes nothing; a login that belongs to another business is refused.
 */
export async function addPerson(
  client: DbClient,
  auth: AuthAdmin,
  input: AddPersonInput,
): Promise<CommandResult<{ setPasswordLink: string }>> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: 'the email is not valid' };
  if (input.mobile !== undefined && !/^\+[1-9][0-9]{7,14}$/.test(input.mobile)) {
    return { ok: false, error: 'use E.164 for the mobile, like +13195550100' };
  }
  const business = await find(client, input.slug, true);
  if (!business) return { ok: false, error: `no business ${input.slug}` };
  if (business.status === 'disabled') return { ok: false, error: `${input.slug} is disabled` };

  const authUserId = await auth.ensureUser(email);
  const existing = await client.query<{ slug: string }>(
    `select t.slug from app.portal_users pu join app.tenants t on t.id = pu.tenant_id
      where pu.auth_user_id = $1`,
    [authUserId],
  );
  const otherSlug = existing.rows[0]?.slug;
  if (otherSlug && otherSlug !== input.slug) {
    return { ok: false, error: `${email} already signs in to ${otherSlug}` };
  }
  let changed = false;
  if (!otherSlug) {
    await client.query(
      `insert into app.portal_users (tenant_id, auth_user_id, role, display_name, mobile)
       values ($1, $2, 'staff', $3, $4)`,
      [business.id, authUserId, input.name, input.mobile ?? null],
    );
    await audit(client, business.id, 'team.person_added', { role: 'staff' });
    changed = true;
  }
  return { ok: true, changed, value: { setPasswordLink: await auth.setPasswordLink(email) } };
}

/** A fresh set-password link for someone who already has a login (links expire). */
export async function passwordLink(
  client: DbClient,
  auth: AuthAdmin,
  email: string,
): Promise<CommandResult<{ setPasswordLink: string }>> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: 'the email is not valid' };
  const { rows } = await client.query<{ slug: string }>(
    `select t.slug from auth.users u
       join app.portal_users pu on pu.auth_user_id = u.id
       join app.tenants t on t.id = pu.tenant_id
      where u.email = $1`,
    [normalized],
  );
  if (!rows[0]) return { ok: false, error: `${normalized} does not sign in to any business` };
  return {
    ok: true,
    changed: false,
    value: { setPasswordLink: await auth.setPasswordLink(normalized) },
  };
}
