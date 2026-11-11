-- Purpose: Lock a business until it is live (decision 35). A new status, `onboarding`, lets the
--          owner and staff sign in while the business finishes setup and waits for texting
--          approval; calls, texts, jobs and calendar syncs keep running only for `active`
--          businesses, so nothing reaches customers before go-live. Sign-in now says whether the
--          business is live, and setup records when the owner sent the texting application.
-- Tables: app.tenants (status adds `onboarding`), app.onboarding_progress (application columns);
--         function app.resolve_portal_user (adds `live`)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration moves
--           onboarding businesses to `disabled`, restores the old check and function and drops
--           the two columns.
-- Ref: decision 35 (DECISIONS_PENDING.md); decisions 23 and 28; SCOPE.md v0.2 (Onboarding inside
--      the portal); CLAUDE.md rule 3.

-- Status ------------------------------------------------------------------------------------

-- `onboarding`: signed up, not live. Fifth Stone Dev moves a business to `active` once texting is
-- approved. The default stays `active` for now; provisioning (decision 23) creates businesses
-- as `onboarding`.
alter table app.tenants drop constraint tenants_status_check;
alter table app.tenants
  add constraint tenants_status_check check (status in ('onboarding', 'active', 'disabled'));

-- Sign-in -----------------------------------------------------------------------------------

-- Same single cross-tenant read as before, now also for a business still onboarding, with
-- `live` saying which. A disabled business still resolves to nothing.
drop function app.resolve_portal_user(uuid);

create function app.resolve_portal_user(p_auth_user_id uuid)
returns table (portal_user_id uuid, tenant_id uuid, role text, live boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select pu.id, pu.tenant_id, pu.role, t.status = 'active'
  from app.portal_users pu
  join app.tenants t on t.id = pu.tenant_id
  where pu.auth_user_id = p_auth_user_id
    and pu.disabled_at is null
    and t.status in ('active', 'onboarding')
$$;

revoke execute on function app.resolve_portal_user(uuid) from public;
grant execute on function app.resolve_portal_user(uuid) to fsc_app;

-- Texting application -----------------------------------------------------------------------

-- The owner reviews what goes to the carriers and sends it. Fifth Stone Dev submits it to Twilio
-- (by hand until the Phase 4 adapter) and moves the texting status card. Sending again after a
-- fix records the latest time.
alter table app.onboarding_progress
  add column application_submitted_at timestamptz,
  add column application_submitted_by uuid,
  add constraint onboarding_progress_application_by_fkey
    foreign key (tenant_id, application_submitted_by) references app.portal_users (tenant_id, id);
