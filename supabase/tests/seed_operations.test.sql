-- The settings and operations seed matches MOCK_DATA.md: tenant config from the trade catalog,
-- service status cards, Riverbend's two settings versions, jobs in every status, Wes's opt-out
-- and the audit trail. Read as the application role in Riverbend (Rhett, U-01). Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

select is_empty(
  $$select 1 from app.tenant_config where playbook_key = 'clinic' or clinic_minimum_data$$,
  'no mock tenant runs the retired clinic playbook'
);

select results_eq(
  $$select t.slug, c.playbook_key, c.trade_key, c.default_job_minutes
      from app.tenant_config c join app.tenants t on t.id = c.tenant_id order by t.slug$$,
  $$values ('mock-cedar-lane', 'service_call', null, 60),
           ('mock-northline-ink', 'studio_appointment', 'tattoo', 60),
           ('mock-old-mill-roofing', 'estimate_visit', 'roofing', 60),
           ('mock-riverbend', 'service_call', 'hvac', 60)$$,
  'each mock tenant runs its workflow and trade, with the trade''s job length (decision 34); Cedar Lane has not picked one'
);

select is(
  app.resolve_inbound_tenant('phone', '+13195550100'),
  (select id from app.tenants where slug = 'mock-riverbend'),
  'a call to Riverbend''s number resolves to Riverbend'
);

select is(
  app.resolve_inbound_tenant('phone', '+13195550103'),
  null,
  'a call to Old Mill (disabled) resolves to nothing (OM-03)'
);

select isnt(
  set_config(
    'app.tenant_id',
    (select r.tenant_id::text from auth.users u
       cross join lateral app.resolve_portal_user(u.id) r
      where u.email = 'rhett@riverbend.example.com'),
    true
  ),
  null,
  'Rhett''s login resolves to a tenant context'
);

set local role fsc_app;

select results_eq(
  'select service, state from app.service_registrations order by service',
  $$values ('email', 'submitted'), ('texting', 'approved')$$,
  'Riverbend''s status cards: texting approved, email submitted'
);

select results_eq(
  $$select s.type_confirmed, s.test_run, s.texting_declined
      from app.setup_progress s join app.tenants t on t.id = s.tenant_id$$,
  $$values (true, false, false)$$,
  'setup progress shows only Riverbend''s own row (decision 36): type confirmed, test not run'
);

select results_eq(
  $$select 'templates', version, active from app.tenant_templates
    union all select 'ai', version, active from app.ai_settings
    order by 1, 2$$,
  $$values ('ai', 1, false), ('ai', 2, true), ('templates', 1, false), ('templates', 2, true)$$,
  'Riverbend has two versions of each setting, the second active (X-06)'
);

select results_eq(
  'select distinct status from app.jobs order by 1',
  $$values ('dead'), ('failed'), ('queued'), ('running'), ('skipped'), ('succeeded')$$,
  'jobs exist in every status (X-09)'
);

select results_eq(
  $$select count(*) from app.opt_outs where phone = '+13195550120' and opted_in_at is null$$,
  $$values (1::bigint)$$,
  'Wes is opted out of Riverbend (RB-12)'
);

reset role;

select * from finish();

rollback;
