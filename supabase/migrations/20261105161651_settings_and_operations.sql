-- Purpose: Settings and operations for scope v0.2: the playbook catalog, tenant config, versioned
--          templates and AI settings, service registrations, integration and calendar
--          connections, jobs and attempts, opt-outs, email events and the audit trail. Adds the
--          inbound-tenant and job-claim functions, and a database guard that refuses outbound
--          texts to anyone who opted out.
-- Tables: app.playbooks, app.tenant_config, app.tenant_templates, app.ai_settings,
--         app.service_registrations, app.integration_connections, app.calendar_connections,
--         app.jobs, app.job_attempts, app.opt_outs, app.email_events, app.audit_events
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           these objects; restore from backup if data was written.
-- Ref: SCOPE.md v0.2 (owner portal, settings, onboarding); SYSTEM_OVERVIEW.md; ADR-0002;
--      ADR-0003 decisions 5 and 6; CLAUDE.md rules 2, 11, 12 and 13.

-- Playbooks (reference data) ----------------------------------------------------------------

-- One engine, configured per industry. Defaults are copied into a tenant's first template and AI
-- settings versions at provisioning; the catalog itself is the same in every environment.
create table app.playbooks (
  key text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  -- Minimum-data playbooks never send content to the AI layer (CLAUDE.md rule 13).
  clinic_minimum_data boolean not null,
  default_approver_channel text not null check (default_approver_channel in ('text', 'portal')),
  default_job_minutes integer not null check (default_job_minutes between 15 and 480),
  description text not null check (char_length(description) <= 500)
);

insert into app.playbooks (key, name, clinic_minimum_data, default_approver_channel, default_job_minutes, description) values
  ('hvac', 'HVAC and plumbing', false, 'text', 60,
   'Missed calls; asks problem, address and urgency; same-day or this-week slots; emergency alerts.'),
  ('tattoo', 'Tattoo studio', false, 'portal', 60,
   'Forms and texts; asks placement, size, reference photo and artist; times per artist.'),
  ('contractor', 'Contractor', false, 'text', 60,
   'Missed calls and forms; asks project type, address, timeline and photos; site visit times.'),
  ('clinic', 'Clinic or practice', true, 'portal', 50,
   'Forms and missed calls; callback number and preferred times only; no clinical detail.');

-- Tenant config -----------------------------------------------------------------------------

create table app.tenant_config (
  tenant_id uuid primary key references app.tenants (id),
  playbook_key text not null references app.playbooks (key),
  -- Copied from the playbook at provisioning and locked: the application cannot change it.
  clinic_minimum_data boolean not null,
  -- The tenant's Fifth Stone Connect number and inbound email address; each belongs to one tenant.
  connect_number text unique check (connect_number ~ '^\+[1-9][0-9]{7,14}$'),
  inbound_email text unique check (inbound_email = lower(inbound_email) and char_length(inbound_email) <= 254),
  -- Array of {days: [1-7], open: 'HH:MM', close: 'HH:MM'}; validated by @fsc/core.
  business_hours jsonb not null check (jsonb_typeof(business_hours) = 'array'),
  default_job_minutes integer not null check (default_job_minutes between 15 and 480),
  approval_window_minutes integer not null default 120 check (approval_window_minutes between 15 and 2880),
  hold_minutes integer not null default 1440 check (hold_minutes between 30 and 10080),
  daily_text_limit integer not null default 200 check (daily_text_limit between 1 and 5000),
  email_sender_name text check (char_length(email_sender_name) between 1 and 80),
  email_reply_to text check (email_reply_to = lower(email_reply_to) and char_length(email_reply_to) <= 254),
  updated_at timestamptz not null default now()
);

-- Versioned settings ------------------------------------------------------------------------

-- Every save is a new version and old versions never change, so undo is "make an earlier
-- version active again" and the history is the audit of what was live when. Required template
-- pieces (business name, opt-out line) are checked by apps/api before a version is written
-- (CLAUDE.md rule 11).
create table app.tenant_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  version integer not null check (version >= 1),
  -- Template key -> body, e.g. {"slot_offer": "..."}.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, version),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.portal_users (tenant_id, id)
);

create unique index tenant_templates_one_active on app.tenant_templates (tenant_id) where active;

-- Structured AI instructions (what we do, what we don't, emergency definition, questions,
-- tone); compiled into the prompt inside the locked safety layer by packages/ai.
create table app.ai_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  version integer not null check (version >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, version),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.portal_users (tenant_id, id)
);

create unique index ai_settings_one_active on app.ai_settings (tenant_id) where active;

-- Services and connections ------------------------------------------------------------------

-- Status cards in the portal. Fifth Stone Dev moves these through the operator; the
-- application only reads them.
create table app.service_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  service text not null check (service in ('texting', 'email')),
  -- `disabled`: turned off at offboarding (number released, sending stopped).
  state text not null default 'not_started' check (state in (
    'not_started', 'submitted', 'approved', 'rejected', 'disabled'
  )),
  updated_at timestamptz not null default now(),
  unique (tenant_id, service)
);

-- Vendor configuration per tenant. Secrets are referenced by name (`secret_ref`), never stored.
create table app.integration_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  type text not null check (type in ('twilio', 'ses', 'webhook_source', 'google_sheets')),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  secret_ref text check (secret_ref ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tenant_id, type)
);

-- The owner connects their calendar in the portal; tokens live in the secret store.
create table app.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  provider text not null check (provider in ('google', 'acuity')),
  calendar_id text not null check (char_length(calendar_id) between 1 and 200),
  -- `revoked`: the tenant withdrew access; offers pause and the portal asks to reconnect.
  status text not null check (status in ('connected', 'revoked', 'disconnected')),
  secret_ref text check (secret_ref ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, calendar_id)
);

-- Jobs --------------------------------------------------------------------------------------

-- Side effects queued with the state change that caused them and run by the worker. The
-- idempotency key is unique per tenant, so each action happens at most once (CLAUDE.md rule 2).
create table app.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid,
  action_type text not null check (action_type ~ '^[a-z][a-z_]{1,59}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 3 and 200),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'succeeded', 'failed', 'dead', 'skipped'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  -- Error code and short operator-facing detail only: never message bodies or tokens.
  last_error text check (char_length(last_error) <= 500),
  external_ref text check (char_length(external_ref) <= 200),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'running') = (lease_expires_at is not null)),
  check (attempts <= max_attempts),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id)
);

create index jobs_due_idx on app.jobs (run_at) where status in ('queued', 'failed');
create index jobs_lease_idx on app.jobs (lease_expires_at) where status = 'running';
create index jobs_tenant_status_idx on app.jobs (tenant_id, status);

create table app.job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  job_id uuid not null,
  attempt integer not null check (attempt >= 1),
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text check (outcome in ('succeeded', 'failed')),
  error_code text check (error_code ~ '^[a-z0-9][a-z0-9_]{1,59}$'),
  check ((outcome is null) = (finished_at is null)),
  unique (tenant_id, job_id, attempt),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id)
);

-- Opt-outs and email events -----------------------------------------------------------------

-- STOP is recorded per tenant and number; START records the opt back in (CLAUDE.md rule 12).
create table app.opt_outs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  source text not null check (source in ('stop_keyword', 'staff', 'operator')),
  opted_out_at timestamptz not null default now(),
  opted_in_at timestamptz,
  check (opted_in_at is null or opted_in_at >= opted_out_at),
  unique (tenant_id, phone)
);

create table app.email_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  provider_message_id text not null check (provider_message_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  recipient text not null check (recipient = lower(recipient) and char_length(recipient) <= 254),
  status text not null check (status in ('delivered', 'bounced', 'complained')),
  occurred_at timestamptz not null,
  unique (tenant_id, provider_message_id, status)
);

-- Audit trail -------------------------------------------------------------------------------

-- Settings changes, approvals, provisioning and denied access. Append-only. `detail` holds IDs
-- and field names, never message bodies or contact details.
create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  actor_type text not null check (actor_type in ('portal_user', 'operator', 'system')),
  actor_portal_user_id uuid,
  action text not null check (action ~ '^[a-z][a-z_.]{2,79}$'),
  subject_type text check (subject_type ~ '^[a-z][a-z_]{1,39}$'),
  subject_id uuid,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  check ((actor_type = 'portal_user') = (actor_portal_user_id is not null)),
  foreign key (tenant_id, actor_portal_user_id) references app.portal_users (tenant_id, id)
);

create index audit_events_tenant_time_idx on app.audit_events (tenant_id, occurred_at desc);

-- Opt-out guard -----------------------------------------------------------------------------

-- A second lock behind the engine's own check: no outbound text is ever recorded for a number
-- that has opted out of this tenant and not opted back in.
create function app.refuse_text_to_opted_out()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.direction = 'out' and exists (
    select 1
    from app.conversations c
    join app.leads l on l.tenant_id = c.tenant_id and l.id = c.lead_id
    join app.contacts ct on ct.tenant_id = l.tenant_id and ct.id = l.contact_id
    join app.opt_outs o on o.tenant_id = ct.tenant_id and o.phone = ct.phone
    where c.tenant_id = new.tenant_id
      and c.id = new.conversation_id
      and c.channel = 'sms'
      and o.opted_in_at is null
  ) then
    raise exception 'Recipient has opted out of texts from this business'
      using errcode = 'P0001', hint = 'opted_out';
  end if;
  return new;
end
$$;

revoke execute on function app.refuse_text_to_opted_out() from public;

create trigger messages_refuse_opted_out
  before insert on app.messages
  for each row execute function app.refuse_text_to_opted_out();

-- Cross-tenant functions --------------------------------------------------------------------

-- Inbound webhooks arrive before any tenant context exists. The number that was called or the
-- address that was mailed identifies the tenant, and only an active tenant is returned.
create function app.resolve_inbound_tenant(p_channel text, p_address text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.tenant_id
  from app.tenant_config c
  join app.tenants t on t.id = c.tenant_id
  where t.status = 'active'
    and case p_channel
          when 'phone' then c.connect_number = p_address
          when 'email' then c.inbound_email = lower(p_address)
          else false
        end
$$;

-- The worker's one way to see jobs across tenants: claim up to `p_limit` due jobs, including any
-- whose lease expired (a crashed worker), skipping disabled tenants. Each claimed job is leased,
-- so a second worker never runs it at the same time. The worker then sets that job's tenant
-- context for everything it does.
create function app.claim_jobs(p_limit integer, p_lease_seconds integer)
returns table (
  job_id uuid,
  tenant_id uuid,
  lead_id uuid,
  action_type text,
  idempotency_key text,
  attempts integer,
  correlation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 3600 then
    raise exception 'claim_jobs: limit must be 1-100 and lease 10-3600 seconds'
      using errcode = '22023';
  end if;
  return query
  with due as (
    select j.id
    from app.jobs j
    join app.tenants t on t.id = j.tenant_id
    where t.status = 'active'
      and (
        (j.status in ('queued', 'failed') and j.run_at <= now())
        or (j.status = 'running' and j.lease_expires_at < now())
      )
      and j.attempts < j.max_attempts
    order by j.run_at
    limit p_limit
    for update of j skip locked
  )
  update app.jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  from due
  where j.id = due.id
  returning j.id, j.tenant_id, j.lead_id, j.action_type, j.idempotency_key, j.attempts,
            j.correlation_id;
end
$$;

revoke execute on function app.resolve_inbound_tenant(text, text) from public;
revoke execute on function app.claim_jobs(integer, integer) from public;
grant execute on function app.resolve_inbound_tenant(text, text) to fsc_app;
grant execute on function app.claim_jobs(integer, integer) to fsc_app;

-- Row-level security and privileges ---------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['tenant_config', 'jobs', 'service_registrations', 'calendar_connections',
                           'integration_connections']
  loop
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;

  foreach t in array array[
    'tenant_config', 'tenant_templates', 'ai_settings', 'service_registrations',
    'integration_connections', 'calendar_connections', 'jobs', 'job_attempts', 'opt_outs',
    'email_events', 'audit_events'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy %I on app.%I for all to fsc_app '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())',
      t || '_own_tenant', t
    );
    execute format('revoke all on app.%I from anon, authenticated', t);
  end loop;
end
$$;

-- The playbook catalog is the same for everyone and read-only to the application.
alter table app.playbooks enable row level security;
create policy playbooks_read on app.playbooks for select to fsc_app using (true);
grant select on app.playbooks to fsc_app;
revoke all on app.playbooks from anon, authenticated;

-- Owners edit their own settings, but not the playbook or the clinic flag.
grant select on app.tenant_config to fsc_app;
grant update (
  business_hours, default_job_minutes, approval_window_minutes, hold_minutes,
  email_sender_name, email_reply_to
) on app.tenant_config to fsc_app;

-- Versions are written once; only which version is active can change.
grant select, insert on app.tenant_templates, app.ai_settings to fsc_app;
grant update (active) on app.tenant_templates, app.ai_settings to fsc_app;

-- Operator-managed: the application reads status and configuration only.
grant select on app.service_registrations, app.integration_connections to fsc_app;

-- The owner connects or reconnects a calendar from the portal.
grant select, insert, update on app.calendar_connections to fsc_app;

-- The worker records outcomes; history is append-only.
grant select, insert, update on app.jobs, app.opt_outs to fsc_app;
grant select, insert on app.job_attempts, app.email_events, app.audit_events to fsc_app;
