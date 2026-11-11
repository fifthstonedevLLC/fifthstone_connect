-- The seeded mock tenants and logins (supabase/seed/01 and 02, generated from packages/mock-data)
-- load as MOCK_DATA.md describes, and each login resolves to its own tenant and role. Read-only;
-- wrapped in a rolled-back transaction anyway.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select results_eq(
  'select slug, status from app.tenants order by slug',
  $$values ('mock-cedar-lane', 'onboarding'), ('mock-northline-ink', 'active'),
           ('mock-old-mill-roofing', 'disabled'), ('mock-riverbend', 'active')$$,
  'the four mock tenants are seeded: Old Mill disabled, Cedar Lane still onboarding'
);

select is_empty(
  $$select 1 from app.tenants where slug not like 'mock-%'$$,
  'only mock tenants exist locally'
);

select results_eq(
  $$select u.email::text, t.slug, r.role, r.live
    from auth.users u
    cross join lateral app.resolve_portal_user(u.id) r
    join app.tenants t on t.id = r.tenant_id
    order by u.email$$,
  $$values ('carla@riverbend.example.com', 'mock-riverbend', 'staff', true),
           ('dee@cedarlane.example.com', 'mock-cedar-lane', 'owner', false),
           ('jules@northline.example.com', 'mock-northline-ink', 'staff', true),
           ('mara@northline.example.com', 'mock-northline-ink', 'owner', true),
           ('rhett@riverbend.example.com', 'mock-riverbend', 'owner', true)$$,
  'every login resolves to its own tenant and role; an onboarding business signs in, not live (decision 35)'
);

select is_empty(
  $$select 1 from auth.users u cross join lateral app.resolve_portal_user(u.id) r
    where u.email = 'owen@oldmill.example.net'$$,
  'the disabled tenant''s owner cannot sign in'
);

select results_eq(
  $$select count(*) from auth.users u
    join auth.identities i on i.user_id = u.id and i.provider = 'email'
    where u.encrypted_password is not null and u.email_confirmed_at is not null$$,
  $$values (6::bigint)$$,
  'all six logins have a password, a confirmed email and an email identity'
);

select * from finish();

rollback;
