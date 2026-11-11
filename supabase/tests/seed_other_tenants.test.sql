-- Northline and Old Mill load as MOCK_DATA.md describes, read the way the portal
-- reads them: as the application role, in the tenant resolved from each business's own login.
-- Rolled back; nothing is written.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

grant fsc_app to postgres;
grant usage on schema extensions to fsc_app;

create function pg_temp.tenant_of(p_email text) returns text
language sql as $$
  select r.tenant_id::text
    from auth.users u
    cross join lateral app.resolve_portal_user(u.id) r
   where u.email = p_email
$$;

-- Northline Ink, as Mara (U-03) ------------------------------------------------------------------

select isnt(
  set_config('app.tenant_id', pg_temp.tenant_of('mara@northline.example.com'), true),
  null,
  'Mara''s login resolves to a tenant context'
);
set local role fsc_app;

select results_eq(
  $$select count(*), count(distinct tenant_id) from app.leads$$,
  $$values (12::bigint, 1::bigint)$$,
  'Mara sees Northline''s twelve leads and no other tenant''s'
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
  $$values ('booked', 1::bigint), ('needs_you', 6::bigint), ('waiting_on_customer', 4::bigint),
           ('went_quiet', 1::bigint)$$,
  'every Today lane has Northline leads'
);

select results_eq(
  $$select c.display_name,
           exists (select 1 from app.opt_outs o where o.phone = c.phone and o.opted_in_at is null)
      from app.contacts c
     where c.phone = '+13195550120'$$,
  $$values ('Rob N.'::text, false)$$,
  'the number that opted out of Riverbend is not opted out at Northline (X-07)'
);

select results_eq(
  $$select r.state, h.state, pu.display_name
      from app.requests r
      join app.calendar_holds h on h.request_id = r.id
      left join app.portal_users pu on pu.id = r.decided_by
     order by r.state$$,
  $$values ('approved'::text, 'converted'::text, 'Jules Park'::text),
           ('pending', 'active', null)$$,
  'Northline has Kira''s pending request and Mei''s consult approved by Jules in the portal'
);

reset role;

-- Old Mill Roofing (disabled) --------------------------------------------------------------------

select is(
  pg_temp.tenant_of('owen@oldmill.example.net'),
  null,
  'Owen cannot get a tenant context: Old Mill is disabled (OM-04)'
);

select results_eq(
  $$select e.outcome, exists (select 1 from app.leads l where l.first_event_id = e.id)
      from app.inbound_events e
      join app.tenants t on t.id = e.tenant_id
     where t.slug = 'mock-old-mill-roofing'
       and e.received_at > (select occurred_at from app.audit_events where action = 'tenant.disabled')$$,
  $$values ('ignored'::text, false)$$,
  'a call after offboarding is recorded as ignored and starts no lead (OM-03)'
);

select is(
  (select count(*)
     from app.tenants t
     join lateral (
       select created_at from app.leads where tenant_id = t.id
       union all
       select created_at from app.jobs where tenant_id = t.id
     ) x on true
    where t.slug = 'mock-old-mill-roofing'
      and x.created_at > (select occurred_at from app.audit_events where action = 'tenant.disabled')),
  0::bigint,
  'Old Mill has no lead or job created after it was disabled'
);

select * from finish();

rollback;
