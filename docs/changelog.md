---
title: 'Changelog'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Engineering'
last_updated: '2026-11-02'
---

# Changelog

Newest first. Each entry: date, change, rationale, test evidence.

## 2026-11-03 — Phase 1, part 1: core types and validation

**Change**

- `packages/core`: canonical lead schema with normalization (`lead.ts`, `normalize.ts`), tenant
  config (`tenant.ts`), inbound event contract (`events.ts`), action jobs and idempotency keys
  (`jobs.ts`), integration connection configs (`connections.ts`).
- Lead status transition rules; only `new` is unresolved.
- `docs/architecture/SYSTEM_OVERVIEW.md`: added canonical lead shape section.
- Repository connected to `github.com/fifthstonedevLLC/fifthstone_connect`; Phase 0 pushed.

**New runtime dependency:** `zod` (in `@fsc/core`) — one definition gives both TypeScript types
and runtime validation with readable error messages (ADR-0001 §3).

**Decisions made inside defaults (review):** North American phone numbers assumed unless a
`+country` code is given; per-tenant daily acknowledgment cap defaults to 100; reminder default
is 8 business hours after creation; client-generated submission UUID is the form event ID.

**Test evidence:** `npm run check` — typecheck, lint, format pass; 43/43 tests pass (40 new unit
tests in `packages/core`). Pure logic only; no database, network, or mocks involved.

## 2026-11-02 — Phase 0: repository and documentation foundation

**Change**

- Moved the original handoff documents to `docs/handoff/` (unchanged) and added a project
  `README.md` at the root.
- Scaffolded an npm-workspaces TypeScript monorepo: `packages/{core,connectors,workflow}`,
  `apps/{api,worker,operator}`, `infra/{migrations,deployment,monitoring}`. Source files are
  placeholders that document what each phase adds.
- Added `CLAUDE.md`, `.env.example` (placeholders only, SES sending disabled by default),
  `.gitignore`, `.editorconfig`, `.gitattributes`, `.nvmrc`, Prettier and ESLint config.
- Added documentation foundation: style guide, scope, backlog, system overview, ADR-0001,
  pending decisions, threat model, runbook, onboarding, offboarding.
- Added `tests/repo-hygiene.test.ts` enforcing env-file ignore rules and placeholder-only secrets.

**New dev dependencies:** typescript, @types/node, vitest, eslint, @eslint/js,
typescript-eslint, prettier (rationale in ADR-0001 §7). No runtime dependencies.

**Rationale:** Execution guide Phase 0.

**Test evidence:** see "Checks" in the Phase 0 session handoff — typecheck, lint, format check,
and 3 hygiene tests run locally. No external services were called; no mocks were needed yet.
