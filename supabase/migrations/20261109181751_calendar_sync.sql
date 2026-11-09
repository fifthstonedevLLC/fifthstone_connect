-- Purpose: The portal calendar. Adds Microsoft (Outlook / Microsoft 365) as a calendar provider
--          beside Google and Acuity (owner, 2026-11-09), records when each connection last
--          synced, and stores the busy times read from the connected calendar so the portal can
--          show them and slots can avoid them. Only start and end are kept: never titles,
--          attendees or descriptions of the owner's own events.
-- Tables: app.calendar_connections (provider check, last_synced_at, unique (tenant_id, id));
--         app.calendar_busy (new)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           app.calendar_busy and the column and restores the provider check (after removing
--           any Microsoft connections).
-- Ref: SCOPE.md v0.2 (calendar); docs/adr/DECISIONS_PENDING.md decision 30; CLAUDE.md rules 3
--      and 4.

-- Connections ------------------------------------------------------------------------------

alter table app.calendar_connections drop constraint calendar_connections_provider_check;
alter table app.calendar_connections add constraint calendar_connections_provider_check
  check (provider in ('google', 'microsoft', 'acuity'));

-- When the worker last read busy times from this calendar. Null until the first sync.
alter table app.calendar_connections add column last_synced_at timestamptz;

alter table app.calendar_connections add constraint calendar_connections_tenant_id_id_key
  unique (tenant_id, id);

-- Busy time ---------------------------------------------------------------------------------

-- Free/busy only, replaced on each sync by the worker. Busy time closes slots; it never opens
-- them (business hours decide what can be offered at all).
create table app.calendar_busy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  connection_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  synced_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, connection_id) references app.calendar_connections (tenant_id, id)
);

create index calendar_busy_tenant_starts on app.calendar_busy (tenant_id, starts_at);

-- Row-level security and grants -------------------------------------------------------------

alter table app.calendar_busy enable row level security;
create policy calendar_busy_own_tenant on app.calendar_busy for all to fsc_app
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
revoke all on app.calendar_busy from anon, authenticated;
grant select, insert, delete on app.calendar_busy to fsc_app;
