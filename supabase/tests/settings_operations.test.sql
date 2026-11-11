-- Tenant isolation and the schema-level rules for settings and operations: locked config,
-- write-once settings versions, read-only operator data, append-only history, the opt-out guard,
-- inbound tenant resolution and job claiming. One rolled-back transaction; test-only tenants.
begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

-- Fixtures: Alpha and Bravo (active) and Closed (disabled), each configured, with jobs in every
-- state the claim function cares about.
insert into app.tenants (id, slug, name, status) values
  ('10000000-0000-4000-8000-00000000000a', 'mock-test-alpha', 'Alpha Test Co', 'active'),
  ('10000000-0000-4000-8000-00000000000b', 'mock-test-bravo', 'Bravo Test Co', 'active'),
  ('10000000-0000-4000-8000-00000000000c', 'mock-test-closed', 'Closed Test Co', 'disabled');

insert into app.tenant_config (tenant_id, playbook_key, connect_number, inbound_email, business_hours, default_job_minutes) values
  ('10000000-0000-4000-8000-00000000000a', 'service_call', '+13195550190', 'mock-test-alpha@inbound.example.com', '[]', 60),
  ('10000000-0000-4000-8000-00000000000b', 'studio_appointment', '+13195550191', 'mock-test-bravo@inbound.example.com', '[]', 60),
  ('10000000-0000-4000-8000-00000000000c', 'estimate_visit', '+13195550192', 'mock-test-closed@inbound.example.com', '[]', 60);

insert into app.tenant_templates (tenant_id, version, content, active) values
  ('10000000-0000-4000-8000-00000000000a', 1, '{"slot_offer": "Reply with a number."}', true),
  ('10000000-0000-4000-8000-00000000000b', 1, '{"slot_offer": "Reply with a number."}', true);

insert into app.ai_settings (tenant_id, version, content, active) values
  ('10000000-0000-4000-8000-00000000000a', 1, '{"tone": "plain"}', true),
  ('10000000-0000-4000-8000-00000000000b', 1, '{"tone": "plain"}', true);

insert into app.service_registrations (tenant_id, service, state) values
  ('10000000-0000-4000-8000-00000000000a', 'texting', 'approved'),
  ('10000000-0000-4000-8000-00000000000b', 'texting', 'submitted');

insert into app.audit_events (tenant_id, actor_type, action) values
  ('10000000-0000-4000-8000-00000000000a', 'operator', 'tenant.provisioned'),
  ('10000000-0000-4000-8000-00000000000b', 'operator', 'tenant.provisioned');

-- Alpha has a customer who replied STOP; Bravo has the same number, not opted out.
insert into app.contacts (id, tenant_id, phone) values
  ('c0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', '+13195550193');
insert into app.leads (id, tenant_id, contact_id, source, state) values
  ('d0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-00000000000a', 'missed_call', 'opted_out');
insert into app.conversations (id, tenant_id, lead_id, channel) values
  ('f0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'd0000000-0000-4000-8000-00000000000a', 'sms');
insert into app.opt_outs (tenant_id, phone, source) values
  ('10000000-0000-4000-8000-00000000000a', '+13195550193', 'stop_keyword'),
  ('10000000-0000-4000-8000-00000000000b', '+13195550194', 'stop_keyword');

insert into app.jobs (tenant_id, action_type, idempotency_key, status, attempts, run_at, lease_expires_at) values
  ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-due', 'queued', 0, now() - interval '1 minute', null),
  ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-later', 'queued', 0, now() + interval '1 hour', null),
  ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-done', 'succeeded', 1, now() - interval '1 hour', null),
  ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-dead', 'dead', 5, now() - interval '1 hour', null),
  ('10000000-0000-4000-8000-00000000000b', 'send_text', 'test:b-retry', 'failed', 1, now() - interval '1 minute', null),
  ('10000000-0000-4000-8000-00000000000b', 'send_text', 'test:b-stale', 'running', 1, now() - interval '1 hour', now() - interval '5 minutes'),
  ('10000000-0000-4000-8000-00000000000c', 'send_text', 'test:c-due', 'queued', 0, now() - interval '1 minute', null);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

-- As the application, working for Alpha -----------------------------------------------------
set local role fsc_app;
set local app.tenant_id = '10000000-0000-4000-8000-00000000000a';

select results_eq(
  $$select 'tenant_config', count(*) from app.tenant_config
    union all select 'tenant_templates', count(*) from app.tenant_templates
    union all select 'ai_settings', count(*) from app.ai_settings
    union all select 'service_registrations', count(*) from app.service_registrations
    union all select 'opt_outs', count(*) from app.opt_outs
    union all select 'audit_events', count(*) from app.audit_events
    union all select 'jobs', count(*) from app.jobs$$,
  $$values ('tenant_config', 1::bigint), ('tenant_templates', 1::bigint), ('ai_settings', 1::bigint),
           ('service_registrations', 1::bigint), ('opt_outs', 1::bigint),
           ('audit_events', 1::bigint), ('jobs', 4::bigint)$$,
  'every settings and operations table shows only the current tenant''s rows'
);

select results_eq(
  'select key from app.playbooks order by key',
  $$values ('estimate_visit'), ('recurring_service'), ('service_call'), ('shop_dropoff'),
           ('studio_appointment')$$,
  'the catalog is the five workflows (decision 34)'
);

select is(
  (select count(distinct playbook_key) from app.trades), 5::bigint,
  'every workflow offers trades, and the trade list is readable'
);

select is_empty(
  $$select 1 from app.playbooks where key = 'clinic' or clinic_minimum_data$$,
  'the clinic playbook is retired (decision 33)'
);

select throws_ok(
  $$insert into app.playbooks (key, name, clinic_minimum_data, default_approver_channel, default_job_minutes, description)
    values ('spa', 'Spa', false, 'text', 60, 'x')$$,
  '42501', null, 'the playbook catalog is read-only to the application'
);

select throws_ok(
  $$insert into app.trades (key, playbook_key, name, default_job_minutes)
    values ('spa', 'studio_appointment', 'Spa', 60)$$,
  '42501', null, 'the trade list is read-only to the application'
);

-- Locked config ------------------------------------------------------------------------------
select throws_ok(
  'update app.tenant_config set clinic_minimum_data = false',
  '42501', null, 'the retired clinic flag cannot be changed by the application'
);

select lives_ok(
  $$update app.tenant_config set playbook_key = 'shop_dropoff', trade_key = 'auto_repair'$$,
  'the owner can change the workflow and trade (decision 34)'
);

select throws_ok(
  $$update app.tenant_config set trade_key = 'tattoo'$$,
  '23503', null, 'a trade must belong to the business''s workflow'
);

select lives_ok(
  $$update app.tenant_config set business_hours = '[{"days": [1, 2, 3, 4, 5], "open": "07:00", "close": "18:00"}]'$$,
  'the owner can change business hours'
);

-- Versioned settings ---------------------------------------------------------------------------
select throws_ok(
  $$insert into app.tenant_templates (tenant_id, version, content, active)
    values ('10000000-0000-4000-8000-00000000000a', 2, '{}', true)$$,
  '23505', null, 'only one template version can be active'
);

select throws_ok(
  $$update app.tenant_templates set content = '{"slot_offer": "edited in place"}'$$,
  '42501', null, 'a saved template version never changes'
);

select lives_ok(
  $$update app.tenant_templates set active = false where version = 1;
    insert into app.tenant_templates (tenant_id, version, content, active)
    values ('10000000-0000-4000-8000-00000000000a', 2, '{"slot_offer": "Pick a number."}', true)$$,
  'a new version can replace the active one'
);

-- Operator-managed and append-only ------------------------------------------------------------
select throws_ok(
  $$update app.service_registrations set state = 'approved'$$,
  '42501', null, 'service registrations are read-only to the application'
);

select throws_ok(
  $$update app.audit_events set action = 'tenant.renamed'$$,
  '42501', null, 'the audit trail is append-only'
);

select throws_ok(
  $$insert into app.jobs (tenant_id, action_type, idempotency_key)
    values ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-due')$$,
  '23505', null, 'a job with the same idempotency key is never queued twice'
);

select throws_ok(
  $$insert into app.jobs (tenant_id, action_type, idempotency_key, status)
    values ('10000000-0000-4000-8000-00000000000a', 'send_text', 'test:a-no-lease', 'running')$$,
  '23514', null, 'a running job always has a lease'
);

-- Opt-out guard -------------------------------------------------------------------------------
select throws_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'out', 'template', 'slot_offer', 'Reply with a number.', 'queued')$$,
  'P0001', 'Recipient has opted out of texts from this business',
  'no outbound text is recorded for a number that opted out'
);

select lives_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'in', 'customer', 'START', 'received')$$,
  'an inbound text from an opted-out number is still recorded'
);

select lives_ok(
  $$update app.opt_outs set opted_in_at = now() where phone = '+13195550193';
    insert into app.messages (tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'out', 'template', 'opt_in_confirmed', 'You are opted back in.', 'queued')$$,
  'after opting back in, outbound texts are allowed again'
);

-- Inbound tenant resolution -------------------------------------------------------------------
set local app.tenant_id = '';

select is(
  app.resolve_inbound_tenant('phone', '+13195550190'),
  '10000000-0000-4000-8000-00000000000a'::uuid,
  'a call to Alpha''s number resolves to Alpha, with no context set'
);

select is(
  app.resolve_inbound_tenant('email', 'MOCK-TEST-ALPHA@inbound.example.com'),
  '10000000-0000-4000-8000-00000000000a'::uuid,
  'inbound email resolves case-insensitively'
);

select is(
  app.resolve_inbound_tenant('phone', '+13195550192'),
  null,
  'a call to a disabled tenant''s number resolves to nothing'
);

-- Job claiming --------------------------------------------------------------------------------
-- Seed data may hold claimable jobs too (claiming spans tenants), so only this test's are compared.
select results_eq(
  $$select idempotency_key from app.claim_jobs(100, 60) where idempotency_key like 'test:%' order by 1$$,
  $$values ('test:a-due'), ('test:b-retry'), ('test:b-stale')$$,
  'the worker claims due, retryable and stale-lease jobs across active tenants only'
);

select is_empty(
  'select 1 from app.claim_jobs(100, 60)',
  'claimed jobs are leased and not handed out twice'
);

select throws_ok(
  'select * from app.claim_jobs(1000, 60)',
  '22023', null, 'claims are bounded'
);

reset role;

select results_eq(
  $$select idempotency_key, status, attempts, lease_expires_at > now()
      from app.jobs where idempotency_key in ('test:a-due', 'test:b-stale') order by 1$$,
  $$values ('test:a-due', 'running', 1, true), ('test:b-stale', 'running', 2, true)$$,
  'a claim sets the lease and counts the attempt'
);

-- Browser-facing roles ------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from app.tenant_config', '42501', null, 'anon cannot read tenant config');
reset role;

select * from finish();

rollback;
