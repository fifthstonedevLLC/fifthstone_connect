---
title: 'Database, Migrations and Seed Data'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Approved'
version: '1.0'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-04'
---

# Database, Migrations and Seed Data

Fifth Stone Connect runs on Supabase (managed Postgres and Auth). Development and testing use a
local Supabase stack in Docker Desktop. Every change that will ever reach a hosted database goes
through a numbered migration in `supabase/migrations/`, recorded in the
[migration ledger](MIGRATION_LEDGER.md). Decision record:
[ADR-0003](../adr/0003-database-platform-and-hosting.md). The rules below are enforced by
`tests/repo-hygiene.test.ts`, not just documented.

## Environments

| Environment | Database                                 | Data                                         | Who changes the schema                 |
| ----------- | ---------------------------------------- | -------------------------------------------- | -------------------------------------- |
| Local       | Supabase CLI stack in Docker Desktop     | Mock data from `supabase/seed/` only         | `supabase db reset` from migrations    |
| Staging     | Hosted Supabase project (non-production) | Mock tenants loaded through the operator CLI | `supabase db push`, after local passes |
| Production  | Hosted Supabase project                  | Real tenants only. Never mock data           | `supabase db push`, owner approval     |

One Supabase project per environment. All tenants share their environment's project; tenants are
rows, never separate projects (ADR-0003).

## Local setup

1. Install Docker Desktop. On Windows it runs on WSL2; give it at least 7 GB of memory.
2. `npm install` (installs the Supabase CLI as a dev dependency; run it on each OS you work from).
3. `npm run db:start` starts the local stack and applies migrations and seed data.
4. Copy `.env.example` to `.env`. The local database URL and ports are already filled in; paste
   the anon and service-role keys that `db:start` prints.
5. Studio (the local dashboard) is at http://127.0.0.1:54323. Postgres listens on port 54322.

| Command                        | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `npm run db:start` / `db:stop` | Start or stop the local stack                                       |
| `npm run db:reset`             | Drop the local database, replay every migration, load seed data     |
| `npm run db:new -- <name>`     | Create `supabase/migrations/<timestamp>_<name>.sql`                 |
| `npm run db:test`              | Run the pgTAP tests in `supabase/tests/` against the local database |
| `npm run seed:build`           | Regenerate `supabase/seed/` from `packages/mock-data`               |

## What lives in `supabase/`

| Path          | Holds                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `config.toml` | Local stack configuration                                                  |
| `migrations/` | Every schema change, in order. The only SQL that reaches a hosted database |
| `seed/`       | Local mock data, numbered `NN_<name>.sql`, loaded on `db:reset` only       |
| `tests/`      | pgTAP tests, `<name>.test.sql`                                             |

Nothing else belongs in `supabase/`. No SQL files anywhere else in the repo.

## Migration rules

1. **Create migrations only with `npm run db:new`.** File names are
   `<14-digit UTC timestamp>_<snake_case_name>.sql`.
2. **Every migration starts with a header:** `-- Purpose:`, `-- Tables:`, `-- Rollback:` (how to
   recover if it misbehaves: usually restore from backup, or the follow-up migration that undoes
   it), and `-- Ref:` (ADR, decision or changelog entry).
3. **Forward-only.** Once a migration has been applied to staging or production it is never
   edited, renamed or deleted. Fix mistakes with a new migration.
4. **One squash, before first staging push.** While the schema exists only locally, the migration
   set may be squashed once into a clean baseline. Record the squash in the ledger. After the
   first staging push, no squashing.
5. **Deprecating something** (a table, column, function or policy): write a new migration that
   drops or changes it, and mark the original migration in the ledger as `superseded` with the
   file that replaced it. The original file stays in the repo, because a database must always be
   rebuildable from empty by replaying every migration in order.
6. **Destructive changes take two releases:** add the new shape and backfill (expand), ship the
   code that uses it, then drop the old shape in a later migration (contract).
7. **Migrations hold structure, not mock data:** tables, indexes, constraints, row-level security
   policies, functions, roles, and reference data production needs (for example the playbook
   catalog). Never mock tenants, people, messages or test fixtures.
8. **No secrets in migrations.** Roles are created without passwords; each environment's
   password is set by the operator and kept in the deployment secret store.
9. **Before a push:** `npm run db:reset` and `npm run db:test` pass locally, `npm run check`
   passes, and the ledger row is filled in.
10. **Hosted databases change only through `supabase db push`,** from a clean checkout of `main`:
    staging first, then production after a dry run (`--dry-run`) and owner approval. Never type
    schema or data changes into a hosted project's SQL editor. An emergency fix made there must
    become a migration the same day, and the ledger records it.

## Seed data rules

- Seed files are local only. `supabase db push` is never run with `--include-seed`.
- Seed files are numbered `NN_<name>.sql` and load in order after migrations. They are generated
  by `npm run seed:build` from `packages/mock-data`, never edited by hand; a test fails when they
  are out of date with the catalog.
- All mock data follows [MOCK_DATA.md](../product/MOCK_DATA.md): `mock-` tenant slugs, fictional
  phone numbers (555-0100 to 555-0199) and `example.com` / `example.org` / `example.net`
  addresses only. The hygiene test rejects anything else in `supabase/seed/`.
- Staging gets mock tenants through the operator CLI's normal provisioning path, never through
  seed files. Production must contain zero `mock-` tenants; the operator's environment check
  fails if it finds one.

## Tests and cleanup

- Database tests are pgTAP files in `supabase/tests/`. Application integration tests run against
  the local stack.
- Tests clean up after themselves: each runs inside a transaction that is rolled back, or the
  suite starts from `npm run db:reset`. No cleanup scripts, teardown scripts or one-off SQL files
  are ever committed.
- No scratch, temporary, backup or work-in-progress files anywhere in the repo. Experiments live
  outside the repo or on a branch that is deleted, not merged.

## Connection rules

- Tenant data lives in the private `app` schema, never in `public`, so the Supabase Data API
  cannot expose it. The portal reaches data only through `apps/api` (decision 17); the browser
  roles `anon` and `authenticated` have no privileges in `app`.
- The API and worker connect with a least-privilege application role (ADR-0001 decision 5),
  through Supabase's connection pooler in hosted environments. Migrations use the direct
  connection.
- Every transaction sets the tenant context (`set_config('app.tenant_id', …, true)`) before
  touching tenant data; row-level security policies check it (ADR-0003 decision 6). Missing or
  malformed context matches no rows. The application role is `fsc_app` (no login until an
  environment enables it). `apps/api` runs every transaction with `set local role fsc_app`, so a
  connection made as `postgres` (local development) is still held to the application's privileges; before a tenant is known, sign-in uses `app.resolve_portal_user`,
  one of three narrow cross-tenant functions it is granted. The others are
  `app.resolve_inbound_tenant` (the number called or address mailed identifies an active tenant)
  and `app.claim_jobs` (the worker leases due jobs across active tenants, then sets each job's
  tenant context). Outbound texts to an opted-out number are refused by a trigger on
  `app.messages`, behind the engine's own check.
- The service-role key is used only by the operator CLI on the owner's machine. Never in the API,
  worker, portal or browser.
