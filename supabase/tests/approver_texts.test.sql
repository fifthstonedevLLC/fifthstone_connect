-- Texts with a business's approvers are tenant-owned like every other table: a business reads
-- and writes only its own, only the application role reaches them, and a reply is always
-- inbound. Uses the seeded tenants, acting as Riverbend. Rolled back; nothing is kept.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

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
       pg_temp.tenant_of('mara@northline.example.com') as northline,
       (select r.portal_user_id from auth.users u cross join lateral app.resolve_portal_user(u.id) r
         where u.email = 'rhett@riverbend.example.com') as rhett;
grant select on ids to fsc_app;

select set_config('app.tenant_id', (select riverbend::text from ids), true);
set local role fsc_app;

select lives_ok(
  $$insert into app.approver_texts (tenant_id, portal_user_id, direction, kind, body, status)
    select riverbend, rhett, 'out', 'answer', 'Nothing is waiting for your approval right now.',
           'queued' from ids$$,
  'a business records a text to its approver'
);

select throws_ok(
  $$insert into app.approver_texts (tenant_id, portal_user_id, direction, kind, body, status)
    select riverbend, rhett, 'out', 'reply', '1', 'received' from ids$$,
  '23514',
  null,
  'a reply is always inbound'
);

select throws_ok(
  $$insert into app.approver_texts (tenant_id, portal_user_id, direction, kind, body, status)
    select northline, rhett, 'out', 'answer', 'Hello', 'queued' from ids$$,
  '42501',
  null,
  'approver texts cannot be written for another business'
);

reset role;
select set_config('app.tenant_id', (select northline::text from ids), true);
set local role fsc_app;

select is_empty(
  $$select 1 from app.approver_texts where tenant_id = (select riverbend from ids)$$,
  'another business cannot read them'
);

reset role;

set local role anon;
select throws_ok('select * from app.approver_texts', '42501', null, 'anon cannot read them');

set local role authenticated;
select throws_ok(
  'select * from app.approver_texts', '42501', null, 'authenticated cannot read them'
);

reset role;

select * from finish();

rollback;
