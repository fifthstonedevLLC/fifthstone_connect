-- Tenant isolation and the schema-level rules for the lead domain (contacts through calendar
-- holds). One rolled-back transaction; fixtures use test-only tenants (`mock-test-*`) so they
-- never collide with seed data (docs/product/MOCK_DATA.md).
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- Fixtures: Alpha and Bravo, each with a contact, a lead with a missed-call event, an SMS
-- conversation with one message, and a pending request with an active hold.
insert into app.tenants (id, slug, name) values
  ('10000000-0000-4000-8000-00000000000a', 'mock-test-alpha', 'Alpha Test Co'),
  ('10000000-0000-4000-8000-00000000000b', 'mock-test-bravo', 'Bravo Test Co');

insert into app.contacts (id, tenant_id, display_name, phone) values
  ('c0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Alpha Customer', '+13195550150'),
  -- The same number in another tenant is a separate, unrelated contact (MOCK_DATA.md X-01).
  ('c0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'Bravo Customer', '+13195550150');

insert into app.inbound_events (id, tenant_id, source, kind, external_event_id, payload_sha256) values
  ('e0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'phone',
   'missed_call', 'MOCK-CA-TEST-A', repeat('a', 64)),
  ('e0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'phone',
   'missed_call', 'MOCK-CA-TEST-B', repeat('b', 64));

insert into app.leads (id, tenant_id, contact_id, source, state, first_event_id) values
  ('d0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-00000000000a', 'missed_call', 'requested', 'e0000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b',
   'c0000000-0000-4000-8000-00000000000b', 'missed_call', 'requested', 'e0000000-0000-4000-8000-00000000000b');

insert into app.conversations (id, tenant_id, lead_id, channel) values
  ('f0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', 'sms'),
  ('f0000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000b', 'sms');

insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status) values
  ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a', 'in', 'customer', '1', 'received'),
  ('10000000-0000-4000-8000-00000000000b', 'f0000000-0000-4000-8000-00000000000b', 'in', 'customer', '2', 'received');

insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end) values
  ('a1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'd0000000-0000-4000-8000-00000000000a', '2026-11-12 20:00+00', '2026-11-12 21:00+00'),
  ('a1000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b',
   'd0000000-0000-4000-8000-00000000000b', '2026-11-12 20:00+00', '2026-11-12 21:00+00');

insert into app.calendar_holds (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at) values
  ('10000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'MOCK-GCAL-SHARED',
   'MOCK-CAL-A', '2026-11-12 20:00+00', '2026-11-12 21:00+00', '2026-11-11 20:00+00'),
  -- Same calendar ID and slot in another tenant: separate calendars, no conflict.
  ('10000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-00000000000b', 'MOCK-GCAL-SHARED',
   'MOCK-CAL-B', '2026-11-12 20:00+00', '2026-11-12 21:00+00', '2026-11-11 20:00+00');

-- Test-only grants, rolled back: `postgres` may act as the application role, which may reach pgTAP.
grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

-- As the application, working for Alpha -----------------------------------------------------
set local role fsc_app;
set local app.tenant_id = '10000000-0000-4000-8000-00000000000a';

select results_eq(
  $$select 'contacts', count(*) from app.contacts
    union all select 'inbound_events', count(*) from app.inbound_events
    union all select 'leads', count(*) from app.leads
    union all select 'conversations', count(*) from app.conversations
    union all select 'messages', count(*) from app.messages
    union all select 'requests', count(*) from app.requests
    union all select 'calendar_holds', count(*) from app.calendar_holds$$,
  $$values ('contacts', 1::bigint), ('inbound_events', 1::bigint), ('leads', 1::bigint),
           ('conversations', 1::bigint), ('messages', 1::bigint), ('requests', 1::bigint),
           ('calendar_holds', 1::bigint)$$,
  'every lead-domain table shows only the current tenant''s rows'
);

select is_empty(
  $$select 1 from app.leads where id = 'd0000000-0000-4000-8000-00000000000b'$$,
  'another tenant''s lead cannot be read by ID'
);

select throws_ok(
  $$insert into app.leads (tenant_id, contact_id, source)
    values ('10000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 'text')$$,
  '42501',
  null,
  'a lead cannot be created in another tenant'
);

select throws_ok(
  $$insert into app.leads (tenant_id, contact_id, source)
    values ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000b', 'text')$$,
  '23503',
  null,
  'a lead cannot point at another tenant''s contact (composite foreign key)'
);

select throws_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000b',
            'out', 'staff', 'hello', 'queued')$$,
  '23503',
  null,
  'a message cannot be added to another tenant''s conversation'
);

select lives_ok(
  $$update app.leads set state = 'closed' where id = 'd0000000-0000-4000-8000-00000000000b'$$,
  'updating another tenant''s lead changes nothing (checked below)'
);

select throws_ok(
  'delete from app.leads',
  '42501',
  null,
  'the application cannot delete leads; they are closed instead'
);

-- Idempotency and append-only records --------------------------------------------------------
select throws_ok(
  $$insert into app.inbound_events (tenant_id, source, kind, external_event_id, payload_sha256)
    values ('10000000-0000-4000-8000-00000000000a', 'phone', 'missed_call', 'MOCK-CA-TEST-A', repeat('c', 64))$$,
  '23505',
  null,
  'a provider retry of the same event inserts nothing new'
);

select throws_ok(
  $$update app.inbound_events set outcome = 'ignored'$$,
  '42501',
  null,
  'inbound events are append-only to the application'
);

-- Templates promise: no free-form outbound author ---------------------------------------------
select throws_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'out', 'ai', 'You are booked for Thursday at 8 AM.', 'queued')$$,
  '23514',
  null,
  'there is no free-form AI author for outbound messages'
);

select throws_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'out', 'template', 'Got it.', 'queued')$$,
  '23514',
  null,
  'a template message must name its template'
);

select lives_ok(
  $$insert into app.messages (tenant_id, conversation_id, direction, author, template_key, body, delivery_status)
    values ('10000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000a',
            'out', 'template', 'request_received', 'Got it, Thu 2:00 PM is requested.', 'queued')$$,
  'a template message with its key is accepted'
);

-- Requests and holds --------------------------------------------------------------------------
select throws_ok(
  $$insert into app.requests (tenant_id, lead_id, slot_start, slot_end)
    values ('10000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a',
            '2026-11-13 15:00+00', '2026-11-13 16:00+00')$$,
  '23505',
  null,
  'a lead has at most one pending request'
);

select throws_ok(
  $$update app.requests set state = 'approved' where id = 'a1000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'an approval must record who decided, how and when'
);

select throws_ok(
  $$insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end, state)
    values ('a1000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-00000000000a',
            'd0000000-0000-4000-8000-00000000000a', '2026-11-12 20:30+00', '2026-11-12 21:30+00', 'expired');
    insert into app.calendar_holds (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000aa', 'MOCK-GCAL-SHARED',
            'MOCK-CAL-A2', '2026-11-12 20:30+00', '2026-11-12 21:30+00', '2026-11-11 20:00+00')$$,
  '23P01',
  null,
  'two active holds cannot overlap on one calendar'
);

select lives_ok(
  $$insert into app.requests (id, tenant_id, lead_id, slot_start, slot_end, state)
    values ('a1000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000000a',
            'd0000000-0000-4000-8000-00000000000a', '2026-11-12 20:30+00', '2026-11-12 21:30+00', 'expired');
    insert into app.calendar_holds (tenant_id, request_id, calendar_id, provider_hold_ref, slot_start, slot_end, state, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-0000000000ab', 'MOCK-GCAL-SHARED',
            'MOCK-CAL-A3', '2026-11-12 20:30+00', '2026-11-12 21:30+00', 'released', '2026-11-11 20:00+00')$$,
  'a released hold may overlap an active one'
);

-- No tenant context, then Bravo ---------------------------------------------------------------
set local app.tenant_id = '';

select is_empty('select 1 from app.leads', 'no tenant context sees no leads');

set local app.tenant_id = '10000000-0000-4000-8000-00000000000b';

select results_eq(
  $$select state from app.leads$$,
  $$values ('requested')$$,
  'another tenant''s lead is unchanged'
);

reset role;

-- Browser-facing roles ------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from app.leads', '42501', null, 'anon cannot read leads');
reset role;
set local role authenticated;
select throws_ok('select * from app.messages', '42501', null, 'authenticated cannot read messages');
reset role;

select * from finish();

rollback;
