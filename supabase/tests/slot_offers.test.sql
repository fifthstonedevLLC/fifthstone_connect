-- Offered times are tenant-owned like every other table: a business reads and writes only its
-- own, only the application role reaches them, and each number means one open time per lead.
-- Uses the seeded tenants, acting as Riverbend. Rolled back; nothing is kept.
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

-- A Riverbend lead with an outbound text, and Northline's tenant ID.
create temp table ids as
select pg_temp.tenant_of('rhett@riverbend.example.com') as riverbend,
       pg_temp.tenant_of('mara@northline.example.com') as northline,
       cv.lead_id, m.id as message_id
  from app.messages m
  join app.conversations cv on cv.tenant_id = m.tenant_id and cv.id = m.conversation_id
 where m.tenant_id = pg_temp.tenant_of('rhett@riverbend.example.com') and m.direction = 'out'
 limit 1;
grant select on ids to fsc_app;

select set_config('app.tenant_id', (select riverbend::text from ids), true);
set local role fsc_app;

select lives_ok(
  $$insert into app.slot_offers (tenant_id, lead_id, message_id, choice, slot_start, slot_end)
    select riverbend, lead_id, message_id, 1, now() + interval '1 day', now() + interval '25 hours'
      from ids$$,
  'a business records the times it offered'
);

select throws_ok(
  $$insert into app.slot_offers (tenant_id, lead_id, message_id, choice, slot_start, slot_end)
    select riverbend, lead_id, message_id, 1, now() + interval '2 days', now() + interval '49 hours'
      from ids$$,
  '23505',
  null,
  'one open time per number per lead'
);

select throws_ok(
  $$insert into app.slot_offers (tenant_id, lead_id, message_id, choice, slot_start, slot_end)
    select northline, lead_id, message_id, 2, now() + interval '1 day', now() + interval '25 hours'
      from ids$$,
  '42501',
  null,
  'offers cannot be written for another business'
);

reset role;
select set_config('app.tenant_id', (select northline::text from ids), true);
set local role fsc_app;

select is_empty(
  $$select 1 from app.slot_offers where lead_id = (select lead_id from ids)$$,
  'another business cannot read the offer'
);

reset role;

set local role anon;
select throws_ok('select * from app.slot_offers', '42501', null, 'anon cannot read offers');

set local role authenticated;
select throws_ok(
  'select * from app.slot_offers', '42501', null, 'authenticated cannot read offers'
);

reset role;

select * from finish();

rollback;
