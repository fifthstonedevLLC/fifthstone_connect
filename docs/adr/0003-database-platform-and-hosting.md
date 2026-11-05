---
title: 'ADR-0003: Database Platform, Migrations and Hosting'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Proposed'
version: '0.1'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-03'
---

# ADR-0003: Database Platform, Migrations and Hosting

Records where the database and the application run, how schema changes reach each
environment, and how one deployment serves every tenant. Working rules:
[DATABASE.md](../engineering/DATABASE.md). Items marked **Proposed** need owner sign-off.

## Context

Fifth Stone Connect is a multi-tenant web application: one deployment serves every business.
It needs a database with authentication for the owner portal, an always-on worker for texts,
reminders and hold expiry, and public HTTPS endpoints for Twilio and SES. Fifth Stone Dev
already runs Docker workloads on a Hostinger VPS behind Dokploy and Traefik, and used Supabase
Auth for the WayMaker Ink request portal.

## Decisions

### 1. Supabase for Postgres and Auth; local Supabase in Docker Desktop for development — Accepted (owner, 2026-11-03)

Development and tests run against the Supabase CLI's local stack in Docker Desktop. Staging and
production are hosted Supabase projects. Resolves pending decision 3.

### 2. Migrations through the Supabase CLI — Accepted (owner, 2026-11-03)

Plain SQL migrations stay (ADR-0001 decision 6), but the Supabase CLI replaces the planned
hand-written runner and the files live in `supabase/migrations/`. `infra/migrations/` is
retired. Forward-only, a ledger of every migration, deprecation by superseding migration, seed
data local only, and no stray scripts: all in DATABASE.md and enforced by
`tests/repo-hygiene.test.ts`.

### 3. One Supabase project per environment, shared by all tenants — Proposed

Three environments: local, staging, production. Tenants are rows in `tenants`, not separate
projects.

_Rejected:_ a project per tenant. Every schema change would have to be pushed to every
project, costs scale per tenant, the single worker would need a connection per project, and
cross-tenant operator views (failed jobs, health) would be impossible without stitching.

### 4. Application on the Hostinger VPS, connected to hosted Supabase — Proposed

`apps/api`, `apps/worker` and `apps/portal` run as containers on the existing Hostinger VPS
under Dokploy, with HTTPS at Traefik. They connect to Supabase over TLS: the API and worker
through Supabase's connection pooler, migrations over the direct connection. Supabase's region
is chosen to sit close to the VPS data center.

- The worker is a long-running process, which suits a VPS and not serverless functions.
- The database lives off the VPS, so losing the VPS loses no data; Supabase handles backups.
- Staging runs as a separate Dokploy app with its own environment variables, pointed at the
  staging Supabase project.

_Consequence:_ the VPS is a single point of failure for receiving webhooks. Uptime monitoring
and alerting are required before pilots; a Twilio fallback URL is a later improvement
(backlog).

### 5. Tenant provisioning through the operator CLI — Proposed

One command (`operator tenant create`) does the following, each step idempotent and audited, so
a failed run can be re-run safely:

1. Create the `tenants` and `tenant_config` rows and copy the chosen playbook's defaults into
   version 1 of `tenant_templates` and `ai_settings`.
2. Invite the owner through Supabase Auth (server-side, service-role key, operator machine only)
   and create the matching `portal_users` row with role `owner`.
3. Create the tenant's Twilio subaccount, number and messaging service; store references in
   `integration_connections` as secret names.
4. Assign the tenant's inbound email address and create `service_registrations` rows for
   texting and email at `not_started`.

The owner then finishes onboarding in the portal (business details for registration, calendar
connection, templates, approvers, test call). Offboarding follows `docs/operations/OFFBOARDING.md`.

### 6. Tenant context on every transaction, enforced by row-level security — Proposed

Every request resolves its tenant before touching data: the Twilio number called, the inbound
email address, the form's public ID, or the signed-in portal user's `portal_users` row. Each
transaction then sets `app.tenant_id` (transaction-scoped, so it works through the pooler), and
row-level security policies on every tenant-owned table allow only rows with that `tenant_id`.
The application role does not bypass RLS. The worker claims jobs across tenants through one
narrowly scoped database function, then sets the job's tenant context before doing the work.
This adds RLS as a second lock behind ADR-0001 decision 5's tenant-scoped repository functions
and resolves pending decision 4.

## Consequences

- Docker Desktop with at least 7 GB of memory is a development requirement.
- Every schema change is a reviewed migration replayable from empty; no manual SQL in hosted
  projects.
- Mock data can never reach production: seed files are local only, staging gets mock tenants
  through the normal provisioning path, and production must contain zero `mock-` tenants.

## Owner and date

Phil, Fifth Stone Dev — 2026-11-03 (decisions 1 and 2 accepted; 3–6 pending sign-off).
