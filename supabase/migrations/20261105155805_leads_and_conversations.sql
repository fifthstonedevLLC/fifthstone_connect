-- Purpose: The lead domain for scope v0.2: contacts, inbound events, leads, calls and voicemails,
--          AI analyses, conversations and messages, requests and calendar holds. Every table is
--          tenant-owned, joined by composite foreign keys, and under row-level security.
-- Tables: app.contacts, app.inbound_events, app.leads, app.calls, app.voicemails,
--         app.ai_analyses, app.conversations, app.messages, app.requests, app.calendar_holds
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           these objects; restore from backup if data was written.
-- Ref: SCOPE.md v0.2 (core loop); SYSTEM_OVERVIEW.md (states); ADR-0002 decisions 5–7;
--      ADR-0003 decision 6; CLAUDE.md rules 1, 2, 3 and 10.

-- Holds use an exclusion constraint over (tenant, calendar, time range).
create extension if not exists btree_gist with schema extensions;

-- Contacts ----------------------------------------------------------------------------------

-- One person per tenant, matched by phone or email so repeat callers keep one history. The same
-- number in two tenants is two unrelated contacts.
create table app.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  display_name text check (char_length(display_name) between 1 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email = lower(email) and char_length(email) <= 254),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  unique (tenant_id, id)
);

create unique index contacts_tenant_phone_key on app.contacts (tenant_id, phone)
  where phone is not null;
create unique index contacts_tenant_email_key on app.contacts (tenant_id, email)
  where email is not null;

-- Inbound events ----------------------------------------------------------------------------

-- Every call, text, email and form submission is recorded here first. The unique key is what
-- makes intake idempotent: a provider retry inserts nothing new (CLAUDE.md rule 2). Raw payloads
-- are not stored; the hash proves what was received.
create table app.inbound_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  source text not null check (source in ('phone', 'email', 'form')),
  kind text not null check (kind in (
    'missed_call', 'voicemail', 'text_received', 'text_status',
    'email_received', 'email_delivery', 'form_submitted'
  )),
  external_event_id text not null check (external_event_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  -- `ignored`: recorded but acted on by nothing, e.g. a call to a disabled tenant.
  outcome text not null default 'accepted' check (outcome in ('accepted', 'ignored')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  unique (tenant_id, source, external_event_id),
  unique (tenant_id, id)
);

-- Leads -------------------------------------------------------------------------------------

-- One potential job. Portal lanes are queries over `state` (SYSTEM_OVERVIEW.md, States).
create table app.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  contact_id uuid not null,
  source text not null check (source in ('missed_call', 'text', 'email', 'form')),
  state text not null default 'new' check (state in (
    'new', 'clarifying', 'offered', 'requested', 'booked',
    'needs_attention', 'quiet', 'closed', 'spam', 'opted_out'
  )),
  -- Why the lead is in its state when that needs explaining: `emergency`, `unsure`,
  -- `price_question`, `hold_expired`, `wrong_number`, `out_of_scope`, ...
  state_reason text check (state_reason ~ '^[a-z][a-z_]{1,59}$'),
  urgency text check (urgency in ('emergency', 'this_week', 'flexible')),
  category text check (category ~ '^[a-z][a-z_]{1,59}$'),
  -- At most two lines, written by AI from the voicemail and texts; labeled as such in the portal.
  summary text check (char_length(summary) <= 500),
  address text check (char_length(address) <= 300),
  first_event_id uuid,
  state_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references app.contacts (tenant_id, id),
  foreign key (tenant_id, first_event_id) references app.inbound_events (tenant_id, id)
);

create index leads_tenant_state_idx on app.leads (tenant_id, state, state_changed_at desc);
create index leads_tenant_contact_idx on app.leads (tenant_id, contact_id);

-- Calls and voicemails ----------------------------------------------------------------------

create table app.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid not null,
  provider_call_id text not null check (provider_call_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  from_number text not null check (from_number ~ '^\+[1-9][0-9]{7,14}$'),
  to_number text not null check (to_number ~ '^\+[1-9][0-9]{7,14}$'),
  started_at timestamptz not null,
  unique (tenant_id, provider_call_id),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id)
);

create index calls_tenant_lead_idx on app.calls (tenant_id, lead_id);

-- The recording stays with the provider; only its reference is kept. The transcript is null for
-- clinic tenants, whose voicemails are never transcribed (CLAUDE.md rule 13, enforced in code).
create table app.voicemails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  call_id uuid not null,
  recording_ref text not null check (char_length(recording_ref) between 1 and 200),
  duration_seconds integer not null check (duration_seconds between 0 and 600),
  transcript text check (char_length(transcript) <= 10000),
  transcript_confidence numeric(4, 3) check (transcript_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  check ((transcript is null) = (transcript_confidence is null)),
  unique (tenant_id, call_id),
  unique (tenant_id, id),
  foreign key (tenant_id, call_id) references app.calls (tenant_id, id)
);

-- AI analyses -------------------------------------------------------------------------------

-- What the language model returned, kept for review and evaluation. Output is stored only after
-- it parsed against the packages/ai schema; a failed parse is recorded with `valid = false` and no
-- output. An analysis never changes a lead by itself (CLAUDE.md rule 10).
create table app.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid not null,
  input_kind text not null check (input_kind in ('voicemail', 'text', 'email', 'form')),
  model text not null check (char_length(model) between 1 and 100),
  valid boolean not null,
  output jsonb,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  check (valid = (output is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id)
);

create index ai_analyses_tenant_lead_idx on app.ai_analyses (tenant_id, lead_id);

-- Conversations and messages ----------------------------------------------------------------

create table app.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid not null,
  channel text not null check (channel in ('sms', 'email')),
  created_at timestamptz not null default now(),
  unique (tenant_id, lead_id, channel),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id)
);

-- The customer thread. Outbound text comes only from an owner-approved template, a person, or an
-- AI-drafted clarifying question; there is no free-form AI author, so AI can never state a time,
-- price or commitment (CLAUDE.md rule 10). Question content is checked in code before sending.
create table app.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('customer', 'template', 'staff', 'ai_question')),
  -- Template key and version for `template` messages, e.g. `slot_offer`.
  template_key text check (template_key ~ '^[a-z][a-z_]{1,59}$'),
  body text not null check (char_length(body) between 1 and 1600),
  segments integer check (segments >= 0),
  provider_message_id text check (provider_message_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  delivery_status text not null check (delivery_status in (
    'received', 'queued', 'sent', 'delivered', 'undelivered', 'failed'
  )),
  occurred_at timestamptz not null default now(),
  check (
    (direction = 'in' and author = 'customer' and delivery_status = 'received')
    or (direction = 'out' and author <> 'customer' and delivery_status <> 'received')
  ),
  check ((author = 'template') = (template_key is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references app.conversations (tenant_id, id)
);

create unique index messages_tenant_provider_id_key on app.messages (tenant_id, provider_message_id)
  where provider_message_id is not null;
create index messages_tenant_conversation_idx on app.messages (tenant_id, conversation_id, occurred_at);

-- Requests and holds ------------------------------------------------------------------------

-- A customer's pick becomes a request, not a booking, until a person approves it.
create table app.requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  lead_id uuid not null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  state text not null default 'pending' check (state in (
    'pending', 'approved', 'changed', 'declined', 'expired'
  )),
  decided_by uuid,
  decided_via text check (decided_via in ('text', 'portal')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start),
  -- A person's decision records who, how and when; an expiry records none of them.
  check (
    (state in ('approved', 'changed', 'declined')
      and decided_by is not null and decided_via is not null and decided_at is not null)
    or (state in ('pending', 'expired')
      and decided_by is null and decided_via is null and decided_at is null)
  ),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references app.leads (tenant_id, id),
  foreign key (tenant_id, decided_by) references app.portal_users (tenant_id, id)
);

-- At most one open request per lead.
create unique index requests_one_pending_per_lead on app.requests (tenant_id, lead_id)
  where state = 'pending';

-- The tentative hold placed on the tenant's calendar for a request. Two active holds can never
-- overlap on one calendar, so a held slot is never offered to a second customer.
create table app.calendar_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  request_id uuid not null,
  calendar_id text not null check (char_length(calendar_id) between 1 and 200),
  provider_hold_ref text not null check (char_length(provider_hold_ref) between 1 and 200),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  state text not null default 'active' check (state in ('active', 'converted', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start),
  unique (tenant_id, request_id),
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references app.requests (tenant_id, id),
  exclude using gist (
    tenant_id with =,
    calendar_id with =,
    tstzrange(slot_start, slot_end) with &&
  ) where (state = 'active')
);

-- Row-level security and privileges ---------------------------------------------------------

create trigger leads_touch_updated_at before update on app.leads
  for each row execute function app.touch_updated_at();
create trigger contacts_touch_updated_at before update on app.contacts
  for each row execute function app.touch_updated_at();
create trigger requests_touch_updated_at before update on app.requests
  for each row execute function app.touch_updated_at();
create trigger calendar_holds_touch_updated_at before update on app.calendar_holds
  for each row execute function app.touch_updated_at();

-- Same rule on every table: the application sees and writes only the current tenant's rows.
-- Nothing here is deleted by the application; leads close, requests expire, holds are released.
do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts', 'inbound_events', 'leads', 'calls', 'voicemails', 'ai_analyses',
    'conversations', 'messages', 'requests', 'calendar_holds'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy %I on app.%I for all to fsc_app '
      'using (tenant_id = app.current_tenant_id()) '
      'with check (tenant_id = app.current_tenant_id())',
      t || '_own_tenant', t
    );
    execute format('revoke all on app.%I from anon, authenticated', t);
  end loop;
end
$$;

-- Records of what happened are append-only to the application.
grant select, insert on app.inbound_events, app.calls, app.voicemails, app.ai_analyses,
  app.conversations to fsc_app;
-- State that moves: contact details, lead state, delivery status, decisions, holds.
grant select, insert, update on app.contacts, app.leads, app.messages, app.requests,
  app.calendar_holds to fsc_app;
