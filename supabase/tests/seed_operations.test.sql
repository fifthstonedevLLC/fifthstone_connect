-- The settings and operations seed matches MOCK_DATA.md: tenant config from the playbook catalog,
-- service status cards, Riverbend's two settings versions, jobs in every status, Wes's opt-out
-- and the audit trail. Read as the application role in Riverbend (Rhett, U-01). Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

select is(
  (select c.clinic_minimum_data from app.tenant_config c
     join app.tenants t on t.id = c.tenant_id where t.slug = 'mock-prairie-path'),
  true,
  'Prairie Path runs the minimum-data clinic playbook'
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
