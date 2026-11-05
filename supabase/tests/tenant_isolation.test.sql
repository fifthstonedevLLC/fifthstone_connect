-- Tenant isolation for the tenancy foundation (ADR-0003 decision 6). Everything runs in one
-- transaction that is rolled back, so no fixture outlives the test. Fixtures use test-only
-- tenants (`mock-test-*`) so they never collide with the seed data (docs/product/MOCK_DATA.md).
begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

-- Fixtures: Alpha (two users, plus a spare login), Bravo (one active owner, one disabled staff
-- user), Closed (a disabled tenant).
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'rhett@alpha.example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'carla@alpha.example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'mara@bravo.example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000004', 'jules@bravo.example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000007', 'owen@closed.example.net', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000008', 'spare@alpha.example.com', 'authenticated', 'authenticated');

insert into app.tenants (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'mock-test-alpha', 'Alpha Test Co', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'mock-test-bravo', 'Bravo Test Co', 'active'),
  ('10000000-0000-4000-8000-000000000004', 'mock-test-closed', 'Closed Test Co', 'disabled');

insert into app.portal_users (id, tenant_id, auth_user_id, role, display_name, mobile, disabled_at) values
  ('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'owner', 'Rhett Boyd', '+13195550104', null),
  ('b0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'staff', 'Carla Nunez', '+13195550105', null),
  ('b0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000003', 'owner', 'Mara Quinn', '+13195550106', null),
  ('b0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000004', 'staff', 'Jules Park', '+13195550107', now()),
  ('b0000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000007', 'owner', 'Owen Mills', '+13195550110', null);

-- Test-only grants, rolled back with everything else: `postgres` may act as the application
-- role (it is not a superuser on Supabase), and the application role may reach pgTAP.
grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

-- The application role, working as T1 ------------------------------------------------------
set local role fsc_app;
set local app.tenant_id = '10000000-0000-4000-8000-000000000001';

select results_eq(
  'select slug from app.tenants',
  $$values ('mock-test-alpha')$$,
  'the application sees only its own tenant'
);

select results_eq(
  'select display_name from app.portal_users order by display_name',
  $$values ('Carla Nunez'), ('Rhett Boyd')$$,
  'the application sees only its own tenant''s users'
);

select is_empty(
  $$select 1 from app.portal_users where id = 'b0000000-0000-4000-8000-000000000003'$$,
  'another tenant''s user cannot be read by ID'
);

select throws_ok(
  $$insert into app.portal_users (tenant_id, auth_user_id, role, display_name)
    values ('10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000008',
            'staff', 'Intruder')$$,
  '42501',
  null,
  'a user cannot be added to another tenant'
);

select lives_ok(
  $$insert into app.portal_users (tenant_id, auth_user_id, role, display_name)
    values ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008',
            'staff', 'New Staff')$$,
  'a user can be added to the application''s own tenant'
);

select lives_ok(
  $$update app.portal_users set display_name = 'Changed'
    where id = 'b0000000-0000-4000-8000-000000000003'$$,
  'updating another tenant''s user changes nothing (checked below)'
);

select throws_ok(
  $$update app.portal_users set tenant_id = '10000000-0000-4000-8000-000000000002'
    where id = 'b0000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'a user cannot be moved to another tenant'
);

select throws_ok(
  $$insert into app.tenants (slug, name) values ('mock-intruder', 'Intruder')$$,
  '42501',
  null,
  'the application cannot create tenants'
);

select throws_ok(
  $$update app.tenants set status = 'disabled'$$,
  '42501',
  null,
  'the application cannot change tenants'
);

select throws_ok(
  'delete from app.portal_users',
  '42501',
  null,
  'the application cannot delete users; they are disabled instead'
);

-- Missing or malformed tenant context -------------------------------------------------------
set local app.tenant_id = '';

select is_empty('select 1 from app.tenants', 'no tenant context sees no tenants');
select is_empty('select 1 from app.portal_users', 'no tenant context sees no users');

set local app.tenant_id = 'not-a-uuid';

select is_empty('select 1 from app.portal_users', 'malformed tenant context sees nothing');

-- Back as T2: the earlier cross-tenant update did not land ----------------------------------
set local app.tenant_id = '10000000-0000-4000-8000-000000000002';

select results_eq(
  $$select display_name from app.portal_users where id = 'b0000000-0000-4000-8000-000000000003'$$,
  $$values ('Mara Quinn')$$,
  'another tenant''s user is unchanged'
);

-- Sign-in resolution ------------------------------------------------------------------------
select results_eq(
  $$select tenant_id, role from app.resolve_portal_user('a0000000-0000-4000-8000-000000000002')$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid, 'staff'::text)$$,
  'a staff login resolves to its tenant and role, whatever the current context'
);

select is_empty(
  $$select 1 from app.resolve_portal_user('a0000000-0000-4000-8000-000000000007')$$,
  'a disabled tenant''s owner cannot sign in'
);

select is_empty(
  $$select 1 from app.resolve_portal_user('a0000000-0000-4000-8000-000000000004')$$,
  'a disabled user cannot sign in'
);

select is_empty(
  $$select 1 from app.resolve_portal_user('a0000000-0000-4000-8000-0000000000ff')$$,
  'an unknown login resolves to nothing'
);

reset role;

-- Browser-facing Supabase roles -------------------------------------------------------------
set local role anon;

select throws_ok('select * from app.tenants', '42501', null, 'anon cannot read tenant data');

reset role;
set local role authenticated;

select throws_ok(
  'select * from app.portal_users',
  '42501',
  null,
  'authenticated cannot read tenant data'
);

select throws_ok(
  $$select * from app.resolve_portal_user('a0000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'authenticated cannot call sign-in resolution directly'
);

reset role;

select * from finish();

rollback;
