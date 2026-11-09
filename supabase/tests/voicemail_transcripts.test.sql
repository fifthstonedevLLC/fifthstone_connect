-- The application role can write a voicemail's transcript and its confidence, and nothing else
-- about the recording; and only for its own business. Uses the seeded tenants, acting as
-- Riverbend. Rolled back; nothing is kept.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

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
  (select count(*) from app.voicemails where tenant_id = (select riverbend from ids)) > 0,
  'the seed has voicemails for Riverbend'
);

select set_config('app.tenant_id', (select riverbend::text from ids), true);
set local role fsc_app;

select lives_ok(
  $$update app.voicemails set transcript = 'Furnace is out.', transcript_confidence = 0.9
     where tenant_id = (select riverbend from ids)$$,
  'the worker can write a transcript and its confidence'
);

select throws_ok(
  $$update app.voicemails set recording_ref = 'MOCK-REC-CHANGED'
     where tenant_id = (select riverbend from ids)$$,
  '42501',
  null,
  'the recording reference cannot be changed'
);

select is_empty(
  $$update app.voicemails set transcript = 'Changed'
     where tenant_id = (select northline from ids) returning 1$$,
  'another business''s voicemails cannot be updated'
);

reset role;

select * from finish();

rollback;
