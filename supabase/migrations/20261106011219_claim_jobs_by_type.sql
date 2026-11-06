-- Purpose: Let a worker claim only the job types it can run. Phase 3 builds handlers one at a
--          time; without this filter a worker would claim, and dead-letter, jobs whose handler
--          does not exist yet. An optional tenant narrows the claim to one business (an operator
--          replaying one tenant's jobs, or a test that must not touch other tests' jobs). Same
--          leasing and tenant rules as `app.claim_jobs(integer, integer)`, which stays.
-- Tables: none (adds function app.claim_jobs(integer, integer, text[], uuid))
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           this overload; nothing is stored by it.
-- Ref: SYSTEM_OVERVIEW.md (worker); changelog 2026-11-06 (Phase 3 worker); CLAUDE.md rule 2.

create function app.claim_jobs(
  p_limit integer,
  p_lease_seconds integer,
  p_action_types text[],
  p_tenant_id uuid default null
)
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
  if p_action_types is null or cardinality(p_action_types) = 0 then
    raise exception 'claim_jobs: name at least one action type' using errcode = '22023';
  end if;
  return query
  with due as (
    select j.id
    from app.jobs j
    join app.tenants t on t.id = j.tenant_id
    where t.status = 'active'
      and j.action_type = any (p_action_types)
      and (p_tenant_id is null or j.tenant_id = p_tenant_id)
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

revoke execute on function app.claim_jobs(integer, integer, text[], uuid) from public;
grant execute on function app.claim_jobs(integer, integer, text[], uuid) to fsc_app;
