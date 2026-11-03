# CLAUDE.md — Fifth Stone Connect

Instructions for Claude (and any engineer) working in this repository. Read this first, then
`docs/handoff/01_PRODUCT_BUILD_PLAN.md` and `docs/handoff/02_EXECUTION_GUIDE.md`.

## Purpose

**Fifth Stone Connect** (internal working name — not an approved public brand) is a managed
integration service from **Fifth Stone Dev**. The MVP runs one packaged workflow,
**Inquiry-to-Action**:

website inquiry → secure intake → durable job queue → Amazon SES acknowledgment + owner alert
→ Google Sheets row → staff follow-up reminder while the lead is unresolved.

It is a repeatable paid service operated by Fifth Stone Dev, not a SaaS or automation builder.

## Current phase

Phase 1 in progress. Done: core types and validation (`packages/core`). Next: connector
interfaces, then SQL migrations and tenant-isolation tests (needs a test database decision).
Track status in `docs/changelog.md`; open decisions live in `docs/adr/DECISIONS_PENDING.md`.

## Commands

```bash
npm install            # install dev dependencies (re-run on each OS; native binaries differ)
npm run typecheck      # tsc --noEmit across all workspaces
npm run lint           # eslint
npm run format:check   # prettier --check (npm run format to fix)
npm test               # vitest run
npm run check          # all of the above, in order
```

## Layout

| Path                  | Responsibility                                                |
| --------------------- | ------------------------------------------------------------- |
| `packages/core`       | Domain models, Zod validation, event contracts, tenant config |
| `packages/connectors` | SES, Google Sheets, webhook adapters behind narrow interfaces |
| `packages/workflow`   | Durable jobs, retries, idempotency, orchestration             |
| `apps/api`            | Public form + signed webhook endpoints, health                |
| `apps/worker`         | Executes jobs, schedules staff reminders                      |
| `apps/operator`       | Guarded CLI for onboarding, status, replay, export/delete     |
| `infra/migrations`    | Versioned SQL migrations                                      |
| `docs/`               | Product, architecture, ADRs, operations, security, brand      |

Business logic lives in `packages/`. Apps are thin wiring: parse input, call package
functions, return output.

## Engineering rules (non-negotiable)

1. **Persist before side effects.** The API returns success only after the inbound event, lead,
   and jobs are committed in one transaction. Third-party calls happen in the worker.
2. **Idempotency everywhere.** Unique `(tenant_id, source, event_id)` on inbound events; unique
   action keys on jobs; Sheets retries reconcile by lead ID before appending.
3. **Tenant scoping.** Every tenant-owned row has `tenant_id`. Every repository function takes
   `tenantId` explicitly. Isolation is covered by tests, not assumed.
4. **No secrets in code, logs, or tests.** `.env` is git-ignored. Logs redact PII and tokens.
   No Supabase `service_role` key in any browser-delivered code.
5. **Mocks are labeled as mocks.** Never report an integration as working unless it was run
   against a real (test) resource with owner approval.
6. **Test-first or test-alongside** for business logic and failure handling.
7. **Explain new dependencies** in the changelog entry that adds them.
8. **Docs change with code.** Update `docs/changelog.md` and affected docs in the same change.
9. **Out of scope → `docs/product/BACKLOG.md`**, not code. Excluded from MVP: dashboard/portal,
   billing, OAuth marketplace, AI features, SMS, CRM sync, visual workflow editor.

## Requires explicit owner approval

Cost, credentials, customer-facing messaging, security exposure, production changes, real email
sends, real lead data, DNS, paid infrastructure, new SaaS subscriptions.

## Brand

Use **Fifth Stone Dev** (master brand) and **Fifth Stone Connect** (working name, internal).
Never invent logos, colors, fonts, testimonials, statistics, or certifications.
See `docs/brand/STYLE_GUIDE.md`.

## End-of-session checklist

1. What changed, in plain language. 2. Changed files and new dependencies. 3. Commands run with
   actual pass/fail (mock vs. real called out). 4. Security/privacy implications and pending
   decisions. 5. Changelog + affected docs updated. 6. The single next smallest deliverable.
