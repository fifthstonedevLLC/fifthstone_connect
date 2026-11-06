-- Onboarding tables are tenant-owned like every other table: a business reads and writes only its
-- own details and progress, and only the application role reaches them. Uses the seeded tenants,
-- read as Riverbend's owner (Rhett). Rolled back; nothing is written.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

create function pg_temp.tenant_of(p_email text) returns uuid
language sql as $$
  select r.tenant_id
    from auth.users u
    cross join lateral app.resolve_portal_user(u.id) r
   where u.email = p_email
$$;

create temp table ids as
select pg_temp.tenant_of('rhett@riverbend.example.com') as riverbend,
       pg_temp.tenant_of('helen@prairiepath.example.org') as prairie;
grant select on ids to fsc_app;

select set_config('app.tenant_id', (select riverbend::text from ids), true);
set local role fsc_app;

select results_eq(
  $$select tenant_id from app.business_profiles$$,
  $$select riverbend from ids$$,
  'Riverbend sees only its own business details'
);

select results_eq(
  $$select tenant_id from app.onboarding_progress$$,
  $$select riverbend from ids$$,
  'Riverbend sees only its own setup progress'
);

select is_empty(
  $$select 1 from app.business_profiles where tenant_id = (select prairie from ids)$$,
  'another business''s details cannot be read by tenant ID'
);

select throws_ok(
  $$insert into app.onboarding_progress (tenant_id, type_confirmed_at)
    select prairie, now() from ids$$,
  '42501',
  null,
  'setup progress cannot be written for another business'
);

select is_empty(
  $$update app.business_profiles set city = 'Waterloo'
     where tenant_id = (select prairie from ids) returning 1$$,
  'another business''s details cannot be updated'
);

select throws_ok(
  $$update app.business_profiles set ein = '123-45-6789'$$,
  '23514',
  null,
  'an EIN must have the EIN shape, so a Social Security number cannot be stored'
);

select is(
  (select count(*) from app.portal_users where approves_requests),
  1::bigint,
  'Riverbend has one approver (Rhett)'
);

reset role;

set local role anon;
select throws_ok(
  'select * from app.business_profiles', '42501', null, 'anon cannot read business details'
);

set local role authenticated;
select throws_ok(
  'select * from app.onboarding_progress', '42501', null, 'authenticated cannot read setup progress'
);

reset role;

select * from finish();

rollback;
