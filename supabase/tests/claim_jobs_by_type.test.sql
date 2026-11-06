-- The type-filtered job claim: a worker claims only the job types it has handlers for, and can be
-- narrowed to one business. One rolled-back transaction; test-only tenants.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into app.tenants (id, slug, name, status) values
  ('20000000-0000-4000-8000-00000000000a', 'mock-test-claim-a', 'Claim A Test Co', 'active'),
  ('20000000-0000-4000-8000-00000000000b', 'mock-test-claim-b', 'Claim B Test Co', 'active');

insert into app.jobs (tenant_id, action_type, idempotency_key, run_at) values
  ('20000000-0000-4000-8000-00000000000a', 'send_text', 'claimtest:a-text', now() - interval '1 minute'),
  ('20000000-0000-4000-8000-00000000000a', 'approval_reminder', 'claimtest:a-reminder', now() - interval '1 minute'),
  ('20000000-0000-4000-8000-00000000000b', 'send_text', 'claimtest:b-text', now() - interval '1 minute');

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app, anon;
set local role fsc_app;

select results_eq(
  $$select idempotency_key from app.claim_jobs(100, 60, array['send_text'],
                                               '20000000-0000-4000-8000-00000000000a')$$,
  $$values ('claimtest:a-text')$$,
  'one business''s jobs of the named types only'
);

select results_eq(
  $$select idempotency_key from app.claim_jobs(100, 60, array['send_text'])
     where idempotency_key like 'claimtest:%'$$,
  $$values ('claimtest:b-text')$$,
  'without a business, every active business''s jobs of those types; claimed ones are leased'
);

select throws_ok(
  $$select * from app.claim_jobs(10, 60, array[]::text[])$$,
  '22023', null, 'a claim names at least one job type'
);

reset role;

select results_eq(
  $$select status, attempts from app.jobs where idempotency_key = 'claimtest:a-reminder'$$,
  $$values ('queued'::text, 0)$$,
  'a job type with no handler stays queued, its attempts untouched'
);

set local role anon;
select throws_ok(
  $$select * from app.claim_jobs(10, 60, array['send_text'])$$,
  '42501', null, 'only the application role can claim jobs'
);

reset role;

select * from finish();

rollback;
