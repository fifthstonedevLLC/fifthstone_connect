-- Purpose: Approving by text. Records every text between the business's approvers and this
--          service: the approval request for a customer's pick, the approver's numbered reply,
--          and the short answer back. Kept apart from the customer thread (app.messages), so a
--          customer never sees, and the portal never mixes, the business's own conversation.
-- Tables: app.approver_texts (new)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration drops
--           the table; decisions made by text stay on app.requests (decided_via = 'text').
-- Ref: SCOPE.md v0.2 (step 4, Approve); decision 25; CLAUDE.md rules 2, 3 and 4.

create table app.approver_texts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id),
  portal_user_id uuid not null,
  -- The request the text is about; null for an answer to a reply that matched none.
  request_id uuid,
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (kind in ('approval_request', 'reply', 'answer')),
  body text not null check (char_length(body) between 1 and 1600),
  provider_message_id text check (provider_message_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  status text not null check (status in ('received', 'queued', 'sent', 'failed')),
  occurred_at timestamptz not null default now(),
  check ((direction = 'in') = (kind = 'reply')),
  check ((direction = 'in') = (status = 'received')),
  unique (tenant_id, id),
  foreign key (tenant_id, portal_user_id) references app.portal_users (tenant_id, id),
  foreign key (tenant_id, request_id) references app.requests (tenant_id, id)
);

create unique index approver_texts_provider_id_key on app.approver_texts (tenant_id, provider_message_id)
  where provider_message_id is not null;
-- The latest approval request sent to each approver is how a bare "1" finds its request.
create index approver_texts_latest_request on app.approver_texts (tenant_id, portal_user_id, occurred_at desc)
  where kind = 'approval_request';

-- Row-level security and grants -------------------------------------------------------------

alter table app.approver_texts enable row level security;
create policy approver_texts_own_tenant on app.approver_texts for all to fsc_app
  using (tenant_id = app.current_tenant_id())
  with check (tenant_id = app.current_tenant_id());
revoke all on app.approver_texts from anon, authenticated;
grant select, insert, update on app.approver_texts to fsc_app;
