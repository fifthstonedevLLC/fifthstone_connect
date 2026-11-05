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

## 2026-11-04 — Phase 1: connector interfaces with labeled mocks

**Change**

- `packages/connectors`: interfaces for every external service in v0.2: `SmsSender`,
  `PhoneEvents` (missed calls, voicemails, received texts, delivery status), `EmailSender`,
  `EmailEvents` (forwarded inquiries, delivery, bounce, complaint), `CalendarProvider` (busy,
  place hold, confirm hold, release hold), `TranscriptionProvider` and `LanguageModel`.
- Every call takes `tenantId` explicitly; side effects take an idempotency key. Calls return a
  result rather than throwing, with errors marked `transient` (retry) or `permanent`
  (dead-letter), matching the error table in `SYSTEM_OVERVIEW.md`. Every adapter carries
  `provider` and `isMock`, so status reporting can refuse to call a mock-only path verified.
- `countSegments` and `findNonGsmCharacters`: billable SMS segment counting (GSM-7 vs UCS-2),
  for the segment limits and cost controls in `SCOPE.md`.
- `@fsc/connectors/mock` (separate entry point, never imported by production wiring): mocks for
  each interface. They issue `MOCK-` references, enforce idempotency per tenant and key, support
  scripted failures, record every request, and throw on any phone number outside
  +1 319 555-0100 to 0199 or any email outside `example.com/.org/.net` (CLAUDE.md rule 17). The
  calendar mock treats holds as busy (no double offers) and simulates revoked access; the
  transcription and model mocks return scripted output for the evaluation set.
- Renamed in `SYSTEM_OVERVIEW.md`: `VoiceEvents` → `PhoneEvents` (it also carries texts),
  `InboundEmail` → `EmailEvents` (it also carries delivery events). `LeadDestination` (Sheets)
  is not defined until decision 20 is resolved.

**New dependencies (in `@fsc/connectors`):** `zod` (already used by `@fsc/core`) validates
inbound event shapes; `@fsc/core` (workspace) supplies `ExternalEventIdSchema`. No new
third-party packages.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 83/83 tests pass (29 new in
`packages/connectors`). Mocks only: no vendor was called.

## 2026-11-03 — v0.2 pricing assumptions

**Change**

- `docs/product/SCOPE.md`: replaced the stale v0.1 pricing note with unvalidated v0.2 working
  numbers: about $1,000 setup, about $199 Standard and $349 Busy per month, base plus overage
  for high volume, and $99/month pilots for three months. Added a rough internal cost floor and
  the cost controls that keep plans profitable (segment limits, send caps, line-type lookup,
  loop limits, email-first confirmations, subaccount usage alerts).
- `docs/adr/DECISIONS_PENDING.md`: decision 21 now points at these working assumptions.

**Rationale:** v0.2 adds ongoing per-tenant texting, number, registration and AI costs that the
v0.1 anchor did not cover. Numbers are owner-reviewed starting points, not market-validated.

**Test evidence:** docs only; `npm run format:check`.

## 2026-11-03 — Twilio ISV profile approved

**Change**

- Owner confirmed Fifth Stone Dev's Twilio ISV business profile is approved. Recorded in
  `SCOPE.md` (build order note: Google OAuth verification is the only remaining approval with a
  waiting period) and ADR-0002 decision 3.

**Test evidence:** documentation only.

## 2026-11-03 — Build order: product on mocks first, integrations later

**Change**

- `SCOPE.md`: "Proposed phasing" replaced by the owner's build order (foundation, portal on mock
  data, engine on mocks, integrations, pilot) with exit criteria per phase, and a separate
  release-scope table (MVP, second release, later). Approvals with real waiting periods (Twilio ISV
  profile, Google OAuth verification) start before Phase 4; Supabase projects are created when
  each environment is needed.
- `CLAUDE.md` current phase rewritten to match; no real adapter before Phase 4.
- `DECISIONS_PENDING.md` decision 13: build order resolved; pilot businesses still open.

**Rationale:** prove the portal and multi-tenant isolation on local Supabase Auth and mock data
before taking on Twilio and SES configuration.

**Test evidence:** documentation only. `npm run check`: typecheck, lint and format pass; 54/54 tests pass.

## 2026-11-03 — Local Supabase, migration rules, mock data plan, hosting plan

**Change**

- Development database is a local Supabase stack in Docker Desktop. Added the Supabase CLI as a
  dev dependency (`supabase`, so every contributor runs the same CLI version through `npm`
  instead of a global install), ran `supabase init`, and set `project_id`, local-only seed path
  `./seed/*.sql`, and turned off the unused edge runtime and analytics services. Added
  `db:start`, `db:stop`, `db:reset`, `db:new` and `db:test` scripts. `.env.example` now points at
  the local stack.
- Retired `infra/migrations/` (deleted); migrations live in `supabase/migrations/`.
- `docs/engineering/DATABASE.md` (new): environments, local setup, migration rules
  (forward-only, header, ledger, one pre-staging squash, deprecation by superseding migration,
  expand/contract, no secrets, push only via `supabase db push`), seed rules (local only,
  reserved values) and the no-cleanup-scripts rule.
- `docs/engineering/MIGRATION_LEDGER.md` (new, empty).
- `tests/repo-hygiene.test.ts` now enforces: no scratch, temporary, cleanup, backup or
  one-off files; no shell scripts; JavaScript and TypeScript only where allowlisted; SQL only
  under `supabase/`; `supabase/` holds only config, migrations, seed and tests; migration names
  and headers; every migration in the ledger; seed phone numbers in 555-0100 to 555-0199 and
  emails on reserved domains; `_KEY` variables in `.env.example` are placeholders.
- `docs/product/MOCK_DATA.md` (new): four `mock-` tenants, seven users, 49 scenario leads
  covering every state and edge case, cross-tenant cases, a 24-voicemail and 8-text evaluation
  set, three conversation scripts, and the import plan (typed catalog → generated seed files →
  local only; staging through the operator CLI; never production).
- `docs/adr/0003-database-platform-and-hosting.md` (new): Supabase plus local CLI stack and
  CLI-managed migrations accepted; one project per environment, app on the Hostinger VPS under
  Dokploy, operator-CLI tenant provisioning, and RLS with a transaction-scoped tenant context
  proposed. ADR-0001 decision 6 marked superseded in part.
- `CLAUDE.md`: database commands, layout, rules 15–17, migration pushes added to owner
  approvals. `SYSTEM_OVERVIEW.md`: hosting diagram and environments. `DECISIONS_PENDING.md`:
  3 resolved, 4 and 8 updated, 22–23 added. `THREAT_MODEL.md`: A25–A27. `BACKLOG.md`: Twilio
  fallback URL. `infra/deployment/README.md` updated.

**Rationale:** the owner wants an airtight repo: every hosted schema change reviewable and
replayable, no lingering scripts, and mock data that can never reach production.

**Not done here:** `npm install` was not run, so the CLI binary is not yet in `node_modules`.
Run `npm install` on Windows, start Docker Desktop, then `npm run db:start`. The package lock was
updated without installing.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 54/54 tests pass (11 new
hygiene tests). The hygiene tests were also run against deliberately bad files (a `cleanup.sh`
and a seed file with a real-looking number and a gmail address) and failed as intended; the bad
files were removed.

## 2026-11-03 — Scope v0.2: missed call to booked job

**Change**

- `docs/product/SCOPE.md` rewritten as v0.2 (planning draft). The product moves from
  form-to-sheet admin automation to a missed-call-to-booked-job loop: capture, clarify,
  offer times, owner approval, confirmation. Adds industry playbooks (tattoo, HVAC and
  plumbing, contractors, clinics with a minimum-data rule), an owner portal (Today dashboard,
  lead page, owner-editable templates and AI settings, onboarding with a test call), channel
  and vendor approach (Twilio ISV with toll-free first, SES, forwarded email, Google Calendar
  and Acuity), guardrails, proposed phasing, acceptance criteria and open decisions.
- `docs/product/BACKLOG.md`: dashboard, SMS, self-service onboarding and AI triage marked as
  moved into scope; new parked items added from the v0.2 exclusions.

**Rationale:** owner review found the v0.1 offer too close to commodity tools to earn an
"I need this" reaction. v0.2 targets lost revenue instead of admin time. The v0.1 intake,
job queue, idempotency and reminders remain the foundation.

**Aligned in the same change**

- `CLAUDE.md`: purpose, current phase and layout describe v0.2; rule 9 exclusions replaced
  with the v0.2 list; new rules 10–14 (AI/template boundary, server-enforced locked layers,
  opt-out, clinic minimum-data, no automatic rescheduling); owner-approval list adds real
  texts/calls, Twilio registrations and sending data to AI providers.
- `docs/adr/0002-scope-v0.2-architecture.md` (new, Proposed): Twilio ISV with per-tenant
  subaccounts and toll-free first, conditional call forwarding, AI boundary, conversation
  state machine, calendar interface, forwarded inbound email, portal calling the API only,
  versioned settings, clinic rule. ADR-0001 notes that its product context is v0.1 and its
  technical decisions remain in force. ADR index updated.
- `DECISIONS_PENDING.md`: decisions 5, 9, 10, 11 revised; 13–21 added (phasing and pilots,
  offer name, AI providers, number type, portal auth and stack, hold timeout, Sheets, pricing).
- `SYSTEM_OVERVIEW.md` v0.2: boundaries, core-loop sequence diagram, proposed states and
  portal lanes, new modules, owner-editable vs locked, new entities, new error cases.
- `THREAT_MODEL.md` v0.2: new assets, entry points 6–10, abuse cases A12–A24.
- `SITE_BRIEF.md` v0.2: landing page with industry tiles; the existing `apps/marketing/` page
  is marked as built from v0.1 and needing rework.
- `STYLE_GUIDE.md`, `README.md`, `ONBOARDING.md`: offer name marked pending, audience widened,
  v0.1 onboarding flagged for rewrite.

**Test evidence:** documentation only. `npm run check`: typecheck, lint and format pass; 43/43 tests pass.

## 2026-11-03 — Marketing page (local draft)

**Change**

- `apps/marketing/`: static marketing page for Inquiry-to-Action, built from
  `docs/marketing/SITE_BRIEF.md`. Sections: hero with a sample request card, before/after,
  six-step pipeline (the line fills as it scrolls into view where the browser supports it; it is
  static under reduced motion), what stays the same, included/not included (from `SCOPE.md`), and
  a soft call to action. Plain HTML/CSS, no JavaScript.
- Brand applied from the owner's brand guide and `fifth-stone-brand.css`: palette, Archivo and
  Space Mono, Fifth Stone Dev logo PNGs copied to `apps/marketing/public/assets/`. Recorded in
  `docs/brand/STYLE_GUIDE.md`. Bronze buttons use Charcoal text for contrast (owner to confirm).
- Canonical and Open Graph tags point to `https://connect.fifthstonedev.com/`. The page carries
  `noindex, nofollow` until launch is approved. Nothing deployed; no DNS changes.
- Call to action links to a placeholder (`#contact-todo`) until the owner supplies a real email
  or booking link.
- `apps/marketing/serve.mjs`: dependency-free local preview server bound to 127.0.0.1
  (`npm run preview -w @fsc/marketing`, http://localhost:4321/). `.claude/launch.json` points at it.
- `eslint.config.js`: Node globals for `*.mjs` scripts.

**No new npm dependencies.** The page loads Archivo and Space Mono from Google Fonts, as the
brand guide specifies. That request shares visitors' IP addresses with Google; consider
self-hosting the fonts before launch.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 43/43 tests pass. Page
reviewed in a browser at 1366px and 375px wide (no horizontal scroll). No integrations involved.

## 2026-11-03 — Brand approval and marketing site brief

**Change**

- Owner approved **Fifth Stone Connect** as the public service name (provisional, trademark
  search pending) and **connect.fifthstonedev.com** as the service domain. Updated
  `STYLE_GUIDE.md`, `CLAUDE.md`, `README.md`, `package.json`.
- Added `docs/marketing/SITE_BRIEF.md` for the first marketing page, to be built locally under
  `apps/marketing/`. No DNS or deployment changes.

**Test evidence:** `npm run check` — all checks pass, 43/43 tests.

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
