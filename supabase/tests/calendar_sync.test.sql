-- Busy times synced from a business's calendar are tenant-owned like every other table: a
-- business reads only its own, only the application role reaches them, and only start and end are
-- stored. Uses the seeded tenants, read as Riverbend. Rolled back; nothing is kept.
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
       pg_temp.tenant_of('mara@northline.example.com') as northline;
grant select on ids to fsc_app;

select ok(
  (select count(*) from app.calendar_busy where tenant_id = (select riverbend from ids)) > 0,
  'the seed has busy times for Riverbend'
);

select is_empty(
  $$select column_name from information_schema.columns
     where table_schema = 'app' and table_name = 'calendar_busy'
       and column_name not in ('id', 'tenant_id', 'connection_id', 'starts_at', 'ends_at', 'synced_at')$$,
  'busy times hold no titles, attendees or descriptions'
);

select lives_ok(
  $$insert into app.calendar_connections (tenant_id, provider, calendar_id, status)
    select riverbend, 'microsoft', 'MOCK-OUTLOOK-TEST', 'disconnected' from ids$$,
  'Outlook (Microsoft) is an accepted calendar provider'
);

select throws_ok(
  $$insert into app.calendar_connections (tenant_id, provider, calendar_id, status)
    select riverbend, 'yahoo', 'MOCK-OTHER-TEST', 'disconnected' from ids$$,
  '23514',
  null,
  'an unknown provider is refused'
);

select set_config('app.tenant_id', (select riverbend::text from ids), true);
set local role fsc_app;

select results_eq(
  $$select distinct tenant_id from app.calendar_busy$$,
  $$select riverbend from ids$$,
  'Riverbend sees only its own busy times'
);

select throws_ok(
  $$insert into app.calendar_busy (tenant_id, connection_id, starts_at, ends_at)
    select northline, (select id from app.calendar_connections limit 1), now(), now() + interval '1 hour'
      from ids$$,
  '42501',
  null,
  'busy times cannot be written for another business'
);

select throws_ok(
  $$insert into app.calendar_busy (tenant_id, connection_id, starts_at, ends_at)
    select riverbend, c.id, now(), now() - interval '1 hour'
      from ids, app.calendar_connections c where c.provider = 'google'$$,
  '23514',
  null,
  'a busy time must end after it starts'
);

reset role;

set local role anon;
select throws_ok('select * from app.calendar_busy', '42501', null, 'anon cannot read busy times');

set local role authenticated;
select throws_ok(
  'select * from app.calendar_busy', '42501', null, 'authenticated cannot read busy times'
);

reset role;

select * from finish();

rollback;
