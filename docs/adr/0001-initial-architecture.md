---
title: 'ADR-0001: Initial Architecture'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Proposed'
version: '0.1'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-02'
---

# ADR-0001: Initial Architecture

Records the Phase 0 baseline. Items marked **Proposed** need owner sign-off; see
[DECISIONS_PENDING.md](DECISIONS_PENDING.md).

## Context

A single operator (Fifth Stone Dev) must run a repeatable paid integration for a handful of
pilot businesses. Priorities, in order: no lost inquiries, no duplicate customer emails or rows,
low support time, code the owner can read and maintain.

## Decisions

### 1. One TypeScript monorepo with npm workspaces — Accepted

Node 22 LTS, ESM, strict TypeScript. npm workspaces because npm ships with Node; no extra
package manager to install or explain. Packages hold business logic; apps are thin.

_Rejected:_ pnpm/Turborepo (tooling overhead for 6 small packages); Python services (owner
writes both, but one typed language across API/worker/connectors keeps contracts shared).

### 2. Fastify for the API — Proposed

Built-in JSON-schema hooks, first-party rate-limit and helmet plugins, pino structured logging
with path-based redaction, good TypeScript support. Express would need several third-party
middlewares for the same baseline.

_Consequence:_ Fastify plugin model to learn; small surface in our usage.

### 3. Zod as the single source of validation — Proposed (adopted in Phase 1)

Types and runtime validation from one definition in `packages/core`.

### 4. Postgres-backed durable job queue, hand-written — Proposed

`jobs` table claimed with `FOR UPDATE SKIP LOCKED` plus a lease timestamp; attempts recorded in
`job_attempts`; exponential backoff with jitter; capped attempts → `dead` status. Roughly a
few hundred lines we fully understand.

_Rejected for now:_ pg-boss (solid, but hides the semantics we must reason about for
reconciliation); Redis/BullMQ (another stateful service to run and back up); in-memory timers.

_Consequence:_ we own lease-recovery correctness — covered by concurrency tests.

### 5. Server-side Postgres access with a dedicated role — Proposed

API and worker connect with `pg` using a least-privilege application role, not the Supabase
`service_role` key or supabase-js. Every repository function requires `tenantId`. Composite
foreign keys `(tenant_id, id)` prevent cross-tenant references. RLS considered as defense in
depth; decision deferred to the tenant-isolation ADR.

### 6. Plain SQL migrations — Proposed

Numbered `.sql` files in `infra/migrations` with a small runner and a `schema_migrations`
table. Readable, reviewable, no ORM.

### 7. Tooling — Accepted

| Dev dependency                              | Why                                                           |
| ------------------------------------------- | ------------------------------------------------------------- |
| `typescript`, `@types/node`                 | Compiler and Node types                                       |
| `vitest`                                    | Fast TS-native test runner, built-in mocking                  |
| `eslint`, `@eslint/js`, `typescript-eslint` | Lint, including a `no-console` rule to force redacting logger |
| `prettier`                                  | Formatting so diffs stay reviewable                           |

No runtime dependencies added in Phase 0.

## Consequences

- Two processes to deploy and monitor (api, worker).
- We own queue correctness and must test lease expiry, duplicate claims, and crash recovery.
- Postgres is the single stateful dependency: backups and a tested restore are mandatory before
  production onboarding.

## Owner and date

Phil, Fifth Stone Dev — 2026-11-02 (pending sign-off on Proposed items).
