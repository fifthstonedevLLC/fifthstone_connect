-- Purpose: Business types as five workflows with trades inside them (decision 34). The playbook
--          catalog becomes the five workflows (service call, estimate visit, recurring service,
--          studio appointment, shop drop-off); `app.trades` lists the trades each one offers; and
--          a tenant records its trade beside its workflow. Owners choose both in Setup, so the
--          application may now change them. Existing tenants move to the matching workflow.
-- Tables: app.playbooks (five workflow rows replace hvac, tattoo and contractor), app.trades
--         (new), app.tenant_config (adds trade_key; playbook_key and trade_key updatable)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration re-adds
--           the three old rows, moves tenants back and drops trade_key and app.trades.
-- Ref: decision 34 (DECISIONS_PENDING.md); ADR-0002 decision 2; SCOPE.md v0.2 (playbooks);
--      packages/conversation/src/playbooks.ts (starter questions and wording per trade).

-- Workflows ---------------------------------------------------------------------------------

insert into app.playbooks (key, name, clinic_minimum_data, default_approver_channel, default_job_minutes, description) values
  ('service_call', 'Service call', false, 'text', 60,
   'A visit to fix something, sooner when it is urgent.'),
  ('estimate_visit', 'Estimate visit', false, 'text', 60,
   'A visit to look at the job and give a quote.'),
  ('recurring_service', 'Recurring service', false, 'text', 60,
   'A first visit; the regular schedule is set up with a person after that.'),
  ('studio_appointment', 'Studio appointment', false, 'portal', 60,
   'A consult or session at your place, approved at the front desk.'),
  ('shop_dropoff', 'Shop drop-off', false, 'text', 30,
   'A time to bring the item in; the work happens at your shop.');

-- Trades ------------------------------------------------------------------------------------

-- Reference data, the same in every environment. The starter questions and wording for each
-- trade live in code; this table holds the keys, names and job lengths the database relies on.
create table app.trades (
  key text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  playbook_key text not null references app.playbooks (key),
  name text not null check (char_length(name) between 1 and 80),
  default_job_minutes integer not null check (default_job_minutes between 15 and 480),
  unique (key, playbook_key)
);

insert into app.trades (key, playbook_key, name, default_job_minutes) values
  ('hvac', 'service_call', 'Heating and cooling', 60),
  ('plumbing', 'service_call', 'Plumbing', 60),
  ('electrical', 'service_call', 'Electrical', 60),
  ('garage_door', 'service_call', 'Garage doors', 60),
  ('service_other', 'service_call', 'Other repair or service', 60),
  ('roofing', 'estimate_visit', 'Roofing', 60),
  ('remodeling', 'estimate_visit', 'Remodeling', 60),
  ('painting', 'estimate_visit', 'Painting', 60),
  ('landscaping', 'estimate_visit', 'Landscaping and hardscape', 60),
  ('estimate_other', 'estimate_visit', 'Other project work', 60),
  ('lawn_care', 'recurring_service', 'Lawn care', 60),
  ('house_cleaning', 'recurring_service', 'House cleaning', 120),
  ('pool_service', 'recurring_service', 'Pool service', 60),
  ('pest_control', 'recurring_service', 'Pest control', 60),
  ('recurring_other', 'recurring_service', 'Other regular service', 60),
  ('tattoo', 'studio_appointment', 'Tattoo studio', 60),
  ('salon_barber', 'studio_appointment', 'Salon or barber', 45),
  ('pet_grooming', 'studio_appointment', 'Pet grooming', 90),
  ('photography', 'studio_appointment', 'Photography', 60),
  ('studio_other', 'studio_appointment', 'Other studio or appointment', 60),
  ('auto_repair', 'shop_dropoff', 'Auto repair', 30),
  ('small_engine', 'shop_dropoff', 'Small engine repair', 30),
  ('device_repair', 'shop_dropoff', 'Phone and computer repair', 30),
  ('bike_repair', 'shop_dropoff', 'Bike repair', 30),
  ('shop_other', 'shop_dropoff', 'Other shop repair', 30);

alter table app.trades enable row level security;
create policy trades_read on app.trades for select to fsc_app using (true);
grant select on app.trades to fsc_app;
revoke all on app.trades from anon, authenticated;

-- Tenant config -----------------------------------------------------------------------------

-- Null until the owner picks a trade. When set, it must belong to the tenant's workflow.
alter table app.tenant_config add column trade_key text;
alter table app.tenant_config
  add constraint tenant_config_trade_in_workflow
  foreign key (trade_key, playbook_key) references app.trades (key, playbook_key);

-- Existing tenants move to the matching workflow; a contractor had no trade recorded.
update app.tenant_config set
  playbook_key = case playbook_key
    when 'hvac' then 'service_call'
    when 'tattoo' then 'studio_appointment'
    when 'contractor' then 'estimate_visit'
  end,
  trade_key = case playbook_key
    when 'hvac' then 'hvac'
    when 'tattoo' then 'tattoo'
  end
where playbook_key in ('hvac', 'tattoo', 'contractor');

delete from app.playbooks where key in ('hvac', 'tattoo', 'contractor');

-- Owners choose their business type in Setup (decision 34).
grant update (playbook_key, trade_key) on app.tenant_config to fsc_app;
