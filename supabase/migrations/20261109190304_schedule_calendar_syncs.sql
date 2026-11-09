-- Purpose: Queue a calendar sync for every connected calendar of every active business, at most
--          once per period. The worker calls this before each pass; it runs before any tenant is
--          known, so it is a narrow security-definer function like `app.claim_jobs`. A sync that
--          is still queued, running or retrying is never doubled.
-- Tables: none (adds function app.schedule_calendar_syncs(integer, uuid); writes app.jobs)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the function; queued `sync_calendar` jobs can be left to run or be deleted.
-- Ref: changelog 2026-11-09 (calendar sync); decision 30; CLAUDE.md rules 2 and 3.

create function app.schedule_calendar_syncs(
  p_every_minutes integer,
  p_tenant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period bigint;
  v_count integer;
begin
  if p_every_minutes not between 5 and 1440 then
    raise exception 'schedule_calendar_syncs: period must be 5-1440 minutes'
      using errcode = '22023';
  end if;
  -- One key per connection per period: a second call in the same period inserts nothing.
  v_period := floor(extract(epoch from now()) / (p_every_minutes * 60));
  insert into app.jobs (tenant_id, action_type, idempotency_key, max_attempts)
  select c.tenant_id, 'sync_calendar', 'sync_calendar:' || c.id || ':' || v_period, 3
    from app.calendar_connections c
    join app.tenants t on t.id = c.tenant_id
   where t.status = 'active'
     and c.status = 'connected'
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and not exists (
       select 1 from app.jobs j
        where j.tenant_id = c.tenant_id
          and j.action_type = 'sync_calendar'
          and j.idempotency_key like 'sync_calendar:' || c.id || ':%'
          and j.status in ('queued', 'running', 'failed')
     )
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function app.schedule_calendar_syncs(integer, uuid) from public;
grant execute on function app.schedule_calendar_syncs(integer, uuid) to fsc_app;
