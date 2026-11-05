-- The Riverbend scenario leads load as MOCK_DATA.md describes, read the way the portal will read
-- them: as the application role, in the tenant resolved from a staff login (Carla, U-02).
-- Rolled back; nothing is written.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

select isnt(
  set_config(
    'app.tenant_id',
    (select r.tenant_id::text
       from auth.users u
       cross join lateral app.resolve_portal_user(u.id) r
      where u.email = 'carla@riverbend.example.com'),
    true
  ),
  null,
  'Carla''s login resolves to a tenant context'
);

set local role fsc_app;

select is(
  (select count(distinct tenant_id) from app.leads),
  1::bigint,
  'Carla sees leads from one tenant only (MOCK_DATA.md acceptance check)'
);

select results_eq(
  $$select lane, count(*) from (
      select case
        when state in ('needs_attention', 'requested') then 'needs_you'
        when state in ('new', 'clarifying', 'offered') then 'waiting_on_customer'
        when state = 'booked' then 'booked'
        when state = 'quiet' then 'went_quiet'
        else 'other'
      end as lane
      from app.leads
    ) l
    group by lane
    order by lane$$,
  $$values ('booked', 2::bigint), ('needs_you', 9::bigint), ('other', 5::bigint),
           ('waiting_on_customer', 7::bigint), ('went_quiet', 1::bigint)$$,
  'every Today lane has Riverbend leads'
);

select results_eq(
  $$select m.direction, m.author, m.template_key
      from app.messages m
      join app.conversations c on c.id = m.conversation_id
      join app.leads l on l.id = c.lead_id
      join app.contacts ct on ct.id = l.contact_id
     where ct.display_name = 'Marcus T.'
     order by m.occurred_at$$,
  $$values ('out', 'template', 'missed_call_text_back'), ('in', 'customer', null),
           ('out', 'template', 'slot_offer'), ('in', 'customer', null),
           ('out', 'template', 'request_received')$$,
  'Marcus''s thread is the scripted happy path, every outbound text from a template'
);

select results_eq(
  $$select r.state, h.state, h.expires_at > now(), r.slot_start > now()
      from app.requests r
      join app.calendar_holds h on h.request_id = r.id
      join app.leads l on l.id = r.lead_id
     where l.state = 'requested'$$,
  $$values ('pending', 'active', true, true)$$,
  'the requested lead has a pending request with an active, unexpired hold on a future slot'
);

select results_eq(
  $$select count(*) filter (where v.transcript is not null),
           count(*) filter (where v.transcript_confidence < 0.5)
      from app.voicemails v$$,
  $$values (12::bigint, 1::bigint)$$,
  'twelve voicemails are transcribed, one with low confidence (VM-05)'
);

reset role;

select * from finish();

rollback;
