-- Purpose: Onboarding inside the portal (SCOPE.md v0.2): the business details texting
--          registration needs, the owner's progress through the setup steps, and who approves
--          requests. Details are captured only; nothing here is sent to a vendor.
-- Tables: app.business_profiles, app.onboarding_progress; app.portal_users (adds
--         approves_requests)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the two tables and the column; restore from backup if data was written.
-- Ref: SCOPE.md v0.2 (Onboarding inside the portal); decision 28; CLAUDE.md rules 3 and 4.

-- Business details --------------------------------------------------------------------------

-- What toll-free verification asks for. The EIN is a business identifier, never a personal one:
-- the portal does not collect Social Security numbers. Shapes are checked again by @fsc/core.
create table app.business_profiles (
  tenant_id uuid primary key references app.tenants (id),
  legal_name text not null check (char_length(legal_name) between 1 and 120),
  ein text check (ein ~ '^[0-9]{2}-[0-9]{7}$'),
  street text not null check (char_length(street) between 1 and 200),
  city text not null check (char_length(city) between 1 and 100),
  region text not null check (region ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  website text check (website ~ '^https?://' and char_length(website) <= 200),
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  contact_email text not null check (
    contact_email = lower(contact_email) and char_length(contact_email) <= 254
  ),
  contact_phone text not null check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, updated_by) references app.portal_users (tenant_id, id)
);

-- Setup progress ----------------------------------------------------------------------------

-- Steps the owner acknowledges. Other steps are complete when their data is (details saved,
-- hours set, an approver chosen), so they need no flag here.
create table app.onboarding_progress (
  tenant_id uuid primary key references app.tenants (id),
  type_confirmed_at timestamptz,
  templates_reviewed_at timestamptz,
  -- Simulated until texting is live: the run is recorded, but no call or text happened.
  test_simulated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Approvers ---------------------------------------------------------------------------------

-- Who receives approval requests. Chosen by the owner during setup.
alter table app.portal_users add column approves_requests boolean not null default false;

-- Row-level security and grants -------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['business_profiles', 'onboarding_progress'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy %I on app.%I for all to fsc_app '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())',
      t || '_own_tenant', t
    );
    execute format('revoke all on app.%I from anon, authenticated', t);
    execute format('grant select, insert, update on app.%I to fsc_app', t);
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;
