-- Purpose: The offer step. Records the numbered times a customer was offered, so a reply of "2"
--          means the second time in the text they actually received. A new offer withdraws the
--          open one; a pick marks its time `picked` and the rest `withdrawn`. The pick becomes a
--          request with a hold (app.requests, app.calendar_holds), never a booking.
-- Tables: app.slot_offers (new)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the table; requests and holds made from picks are unaffected.
-- Ref: SCOPE.md v0.2 (step 3, Offer); decision 19; CLAUDE.md rules 2, 3 and 10.

create table app.slot_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid not null,
  -- The outbound `slot_offer` message this time was listed in.
  message_id uuid not null,
  choice smallint not null check (choice between 1 and 9),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  state text not null default 'open' check (state in ('open', 'picked', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start),
  unique (tenant_id, message_id, choice),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id),
  foreign key (tenant_id, message_id) references app.messages (tenant_id, id)
);

-- A lead has at most one open offer: each number means one time.
create unique index slot_offers_one_open_per_choice on app.slot_offers (tenant_id, lead_id, choice)
  where state = 'open';

-- Row-level security and grants -------------------------------------------------------------

alter table app.slot_offers enable row level security;
create policy slot_offers_own_tenant on app.slot_offers for all to fsc_app
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
revoke all on app.slot_offers from anon, authenticated;
grant select, insert, update on app.slot_offers to fsc_app;
create trigger slot_offers_touch_updated_at before update on app.slot_offers
  for each row execute function app.touch_updated_at();
