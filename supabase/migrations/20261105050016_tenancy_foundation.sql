-- Purpose: Tenancy foundation. A private `app` schema, the least-privilege application role,
--          transaction-scoped tenant context, `tenants` and `portal_users` under row-level
--          security, and the one function that resolves a signed-in portal user's tenant.
-- Tables: app.tenants, app.portal_users
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           these objects; restore from backup if data was written.
-- Ref: ADR-0003 decisions 5 and 6; DECISIONS_PENDING 4 and 17; DATABASE.md connection rules.

-- Tenant data lives outside `public`, so the Supabase Data API never exposes it. The portal
-- reaches it only through apps/api (DECISIONS_PENDING 17).
create schema app;
revoke all on schema app from public;

-- Application role for apps/api and apps/worker. Created without login or password; each
-- environment enables login and sets the password from its secret store (DATABASE.md rule 8).
-- Roles are cluster-wide and survive a local reset, hence the existence check.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'fsc_app') then
    create role fsc_app nologin noinherit;
  end if;
end
$$;

grant usage on schema app to fsc_app;

-- Tenant context ----------------------------------------------------------------------------

-- The tenant for the current transaction, set by the application with
-- `set_config('app.tenant_id', <uuid>, true)`. Missing or malformed context is null, which no
-- policy matches, so a forgotten context returns nothing rather than everything.
create function app.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when current_setting('app.tenant_id', true)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then current_setting('app.tenant_id', true)::uuid
  end
$$;

revoke execute on function app.current_tenant_id() from public;
grant execute on function app.current_tenant_id() to fsc_app;

create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function app.touch_updated_at() from public;

-- Tenants -----------------------------------------------------------------------------------

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'disabled')),
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app.tenants is
  'One row per business. Created and disabled by the operator CLI only (ADR-0003 decision 5).';

create trigger tenants_touch_updated_at
  before update on app.tenants
  for each row execute function app.touch_updated_at();

alter table app.tenants enable row level security;

-- The application reads its own tenant only. Creating, renaming and disabling tenants is the
-- operator's job, so the application role has no write privileges here.
create policy tenants_own_tenant on app.tenants
  for select to fsc_app
  using (id = app.current_tenant_id());

grant select on app.tenants to fsc_app;

-- Portal users ------------------------------------------------------------------------------

create table app.portal_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  -- One login belongs to one tenant in MVP. Deleting the login is blocked until the portal user
  -- is removed through offboarding, so nothing disappears silently.
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'staff')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  -- E.164; used for approval texts.
  mobile text check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for composite foreign keys, so child rows cannot point across tenants.
  unique (tenant_id, id)
);

comment on table app.portal_users is
  'Owner and staff logins per tenant. Staff can view, reply and approve; owners can do everything.';

create index portal_users_tenant_id_idx on app.portal_users (tenant_id);

create trigger portal_users_touch_updated_at
  before update on app.portal_users
  for each row execute function app.touch_updated_at();

alter table app.portal_users enable row level security;

-- Owners manage staff from the portal, so the application can add and edit users in its own
-- tenant. There is no delete: users are disabled, which keeps the audit trail intact.
create policy portal_users_own_tenant on app.portal_users
  for all to fsc_app
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());

grant select, insert, update on app.portal_users to fsc_app;

-- Sign-in resolution ------------------------------------------------------------------------

-- Before any tenant context exists, apps/api needs the signed-in user's tenant and role. This
-- is the single cross-tenant read the application role gets: one row, for one login, only when
-- both the user and the tenant are active.
create function app.resolve_portal_user(p_auth_user_id uuid)
returns table (portal_user_id uuid, tenant_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select pu.id, pu.tenant_id, pu.role
  from app.portal_users pu
  join app.tenants t on t.id = pu.tenant_id
  where pu.auth_user_id = p_auth_user_id
    and pu.disabled_at is null
    and t.status = 'active'
$$;

revoke execute on function app.resolve_portal_user(uuid) from public;
grant execute on function app.resolve_portal_user(uuid) to fsc_app;

-- Browser-facing Supabase roles never touch tenant data directly.
revoke all on all tables in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;
