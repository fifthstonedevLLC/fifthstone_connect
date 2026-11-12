-- Purpose: Each business's own limit for how long a lead may wait on it before it goes to Act now
--          (decision 37). Picking a workflow copies its default (service call 4 hours, shop
--          drop-off 8, the others 24); the owner can change it. Existing businesses get their
--          workflow's default. The other Act now rules (a hold about to run out, an appointment
--          within two days) are fixed in packages/conversation and need no column.
-- Tables: app.tenant_config (adds act_now_after_hours)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the column.
-- Ref: decision 37 (DECISIONS_PENDING.md); packages/conversation/src/priority.ts and
--      playbooks.ts.

alter table app.tenant_config
  add column act_now_after_hours integer not null default 24
    check (act_now_after_hours between 1 and 168);

update app.tenant_config set act_now_after_hours = case playbook_key
  when 'service_call' then 4
  when 'shop_dropoff' then 8
  else 24
end;

grant update (act_now_after_hours) on app.tenant_config to fsc_app;
