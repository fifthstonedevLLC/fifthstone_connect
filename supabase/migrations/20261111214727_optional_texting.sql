-- Purpose: Texting is optional (decision 36). The last setup step becomes a choice: send the
--          texting application, or go without texting for now. Go-live no longer waits on texting
--          approval; a business without texting gets missed calls and voicemails on the Front Desk
--          to call back, and the engine already sends no text unless texting is approved.
-- Tables: app.onboarding_progress (adds texting_declined_at); view app.setup_progress (new)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the view and the column.
-- Ref: decision 36 (DECISIONS_PENDING.md), revising decision 35; SCOPE.md v0.2 (Onboarding inside
--      the portal).

-- When the owner chose to go without texting. Sending an application later clears it; a
-- business never has both an open choice to decline and an application on record.
alter table app.onboarding_progress
  add column texting_declined_at timestamptz,
  add constraint onboarding_progress_texting_choice
    check (texting_declined_at is null or application_submitted_at is null);

-- Setup progress --------------------------------------------------------------------------------

-- What each setup step's data says, one row per business, so the portal, the API and the operator
-- CLI judge "setup finished" the same way. @fsc/core's `onboardingSteps` turns a row into steps.
-- Runs with the caller's rights, so row-level security still limits the application to its own
-- business.
create view app.setup_progress with (security_invoker = true) as
select
  t.id as tenant_id,
  o.type_confirmed_at is not null as type_confirmed,
  exists (select 1 from app.business_profiles p where p.tenant_id = t.id) as profile_saved,
  coalesce(jsonb_array_length(c.business_hours) > 0, false) as hours_set,
  coalesce((select cc.status = 'connected' from app.calendar_connections cc
             where cc.tenant_id = t.id order by cc.updated_at desc limit 1), false)
    as calendar_connected,
  o.templates_reviewed_at is not null as templates_reviewed,
  (select count(*) from app.portal_users u where u.tenant_id = t.id and u.approves_requests)::int
    as approvers,
  o.test_simulated_at is not null as test_run,
  o.application_submitted_at is not null as application_sent,
  o.texting_declined_at is not null as texting_declined
from app.tenants t
left join app.tenant_config c on c.tenant_id = t.id
left join app.onboarding_progress o on o.tenant_id = t.id;

revoke all on app.setup_progress from public, anon, authenticated;
grant select on app.setup_progress to fsc_app;
