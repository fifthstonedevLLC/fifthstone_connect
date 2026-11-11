-- Purpose: Retire the clinic playbook. Healthcare practices are out of scope (owner, 2026-11-11),
--          so the catalog no longer offers it and no tenant can run the minimum-data flag. This
--          is the expand step: the `clinic_minimum_data` columns stay, always false, until a later
--          migration drops them (DATABASE.md rule 6).
-- Tables: app.playbooks (clinic row removed; flag fixed false), app.tenant_config (flag defaults
--         to false and must be false)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration re-adds
--           the clinic row and lifts the two checks.
-- Ref: decision 33 (DECISIONS_PENDING.md); ADR-0002 decision 11 (superseded in part); CLAUDE.md
--      rule 13.

do $$
begin
  if exists (select 1 from app.tenant_config where playbook_key = 'clinic' or clinic_minimum_data) then
    raise exception 'A tenant still runs the clinic playbook; offboard it before retiring the playbook';
  end if;
end
$$;

delete from app.playbooks where key = 'clinic';

alter table app.playbooks
  add constraint playbooks_no_minimum_data check (not clinic_minimum_data);

alter table app.tenant_config alter column clinic_minimum_data set default false;
alter table app.tenant_config
  add constraint tenant_config_no_minimum_data check (not clinic_minimum_data);

comment on column app.playbooks.clinic_minimum_data is
  'Deprecated (decision 33): always false; dropped by a later migration.';
comment on column app.tenant_config.clinic_minimum_data is
  'Deprecated (decision 33): always false; dropped by a later migration.';
