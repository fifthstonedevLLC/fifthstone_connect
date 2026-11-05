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

## 2026-11-05 — Phase 2: lead page (API and screen)

**Change**

- `GET /portal/leads/:id` (`apps/api/src/repositories/lead.ts`): the lead with its contact and
  number of earlier leads, the latest voicemail and transcript, the full message thread with
  authors and delivery status, and the latest request with who decided, how, and its hold.
  Another business's lead returns 404, never 403, so the API does not confirm it exists. A
  malformed ID returns 400 `invalid_request`.
- API error handler: validation errors answer `{"error": "invalid_request"}`; anything else is
  logged (redacted) and answers `{"error": "internal"}`, so no internal detail reaches a browser.
- `apps/portal` lead page (`/leads/:id`), from the approved canvas layout:
  - Header with how and when the lead arrived; the five-step line for leads on the normal path
    (none for leads that need a person, went quiet or closed).
  - Decision box: a pending request shows the slot, the hold's expiry and, until portal approval
    is built, "reply 1 to the approval text to approve" instead of a button that does nothing
    (decision 24). Booked shows the slot and who approved it, how and when. Others show why the
    lead needs a person. Every variant has a Call link.
  - One conversation thread: the voicemail (length, time, transcript, a warning when confidence
    is low, "Not transcribed" when there is none) then each text, labeled "You, from your
    template", "You, AI-drafted question", "You" or the customer's name, with "Not delivered"
    where it applies.
  - Details: what they need (labeled as an AI summary), how soon, address, phone, email, history.
  - Today's card names now link to the lead page.
- Portal layout fix: the sidebar is sticky only when it sits beside the content (880px and wider).
  Between phone width and 880px it stacked above the content while still sticky, and covered it
  on scroll.
- Seed fix: in RB-02's thread, Marcus's "1" and the confirmation shared a timestamp, so their
  order varied. The catalog test now rejects tied timestamps within a thread.

**Test evidence:** `npm run check` passes (API: lead page, repeat-customer count, 404 for
another business's lead, 400 for a malformed ID; portal: progress-line and label tests). In the
in-app browser against the local stack: Marcus's page (pending request, active hold, voicemail,
five texts in order, details), Ana's (booked, approved by Rhett in the portal), Ben's (needs a
person, no progress line) and an unknown ID (not-found message). Mock data only.

## 2026-11-05 — Phase 2: portal shell with sign-in and the Today dashboard

**Change**

- New workspace `apps/portal` (React + Vite, decision 18):
  - Sign-in with email and password through Supabase Auth (local mock logins), with plain error
    messages. The browser holds only the public anon key; all data comes from `apps/api`.
  - "No portal access" screen for a login without an active business (Old Mill's owner), and a
    retry screen for API errors. An expired session returns to sign-in.
  - Shell from the approved canvas: brand tile, sidebar navigation (Leads, Calendar, Templates &
    AI and Settings listed as "Soon" rather than hidden), service status from the API, account and
    sign-out. The sidebar stays in view on wide screens and stacks on phones.
  - Today: a summary sentence naming who needs the owner, the five-step line, and the four lanes
    from `/portal/today`, with status lines in plain words, times in the business's time zone,
    emergency flags and a "Call" link (the only action on this screen for now).
  - Vite forwards `/api` to `apps/api` in development, so no CORS rules are needed.
  - `apps/portal/.env.example` documents the two browser values; `.env.local` is git-ignored.
- Decision 24 (owner, 2026-11-05): the portal shows only true, server-confirmed state, with no
  optimistic UI. After Approve a lead reads "Confirming" until the calendar event exists.
- `/portal/me` now also returns the tenant's time zone, texting and email status, and calendar
  connection, so the sidebar shows real status instead of fixed text.
- Tooling: root `tsconfig.json` excludes `apps/portal`, which has its own config (DOM types,
  JSX, bundler resolution), and `npm run typecheck` checks both. ESLint applies the React hooks
  rules to the portal. The hygiene test allows `apps/portal/vite.config.ts`. `.claude/launch.json`
  starts the API and the portal for in-app preview.

**New dependencies:** in `@fsc/portal`: `react` and `react-dom` (UI), `react-router` (screens
and links; the lead page is next), `@supabase/supabase-js` (browser sign-in and session refresh);
dev-only `vite` and `@vitejs/plugin-react` (dev server and build), `@types/react` and
`@types/react-dom`. Root dev-only: `eslint-plugin-react-hooks` (catches hooks called out of
order, a common source of stale or wrong data on screen).

**Known gaps:** response types in `apps/portal/src/types.ts` mirror the API's Zod schemas by
hand for now. On phones the sidebar comes before the lanes; a collapsible menu is a follow-up.
Marcus's seeded thread says "Thu 2:00 PM" while his seeded slot is relative to load time, so
the card and the thread can name different times.

**Test evidence:** `npm run check`: typecheck (both configs), lint and format pass, all tests
pass (including 7 new portal formatting tests and the updated `/portal/me` test).
`npm run build -w @fsc/portal` succeeds. In the in-app browser against the local stack: Rhett
signs in and sees Riverbend's four lanes (9 / 7 / 2 / 1) with emergencies first; a wrong
password shows the mismatch message; Owen (Old Mill, disabled) sees "No portal access"; Carla
signs in at 375px wide with no horizontal scroll. Mock data only.

## 2026-11-05 — Phase 2 begins: Fastify API skeleton with portal sign-in

**Change**

- `apps/api` is now a Fastify app (decision 1 resolved: Fastify, owner 2026-11-05):
  - `config.ts`: environment validated with Zod at startup; errors name variables, never values.
  - `db.ts`: every query runs in a transaction as `fsc_app` (`set local role`), with the tenant
    context set for tenant work (`withTenant`) or absent before sign-in (`withoutTenant`).
  - `auth.ts`: verifies Supabase access tokens (ES256) against the project's published keys,
    then `app.resolve_portal_user`. 401 without a valid token; 403 for a disabled user or tenant.
  - Routes: `GET /health`, `GET /portal/me`, `GET /portal/today` (the four lanes, built from the
    `LANE_STATES` mapping in `@fsc/core`). Request and response shapes are Zod schemas; repository
    queries filter by tenant explicitly on top of row-level security.
  - Logging through Fastify's Pino logger with redaction of authorization headers, cookies, phone
    numbers, emails, message bodies, summaries and transcripts (CLAUDE.md rule 4).
  - `npm run dev -w @fsc/api` and `npm run start -w @fsc/api`.
- Migration `20261105165057_admin_can_act_as_app_role.sql`: `grant fsc_app to postgres`, so the
  API's `set local role fsc_app` works on an admin connection (ledger row added).
- `tsconfig.json`: `strict: true` stated explicitly (owner). It was already on through
  `tsconfig.base.json`, so behavior is unchanged.
- Root `package.json` lists `zod` as a dependency (owner). Each workspace already declares its own
  `zod`, so this is redundant but harmless.

**New dependencies (`@fsc/api`):** `fastify` (HTTP server; per-route body parsing for signed
webhooks, encapsulated plugins for per-route security, built-in Pino logging with redaction,
`inject()` for tests without a network); `fastify-type-provider-zod` (validates and types routes
with the same Zod schemas as `@fsc/core`); `pg` and `@types/pg` (Postgres client; plain SQL with
transactions, matching the migration-first approach); `jose` (verifies Supabase JWTs against the
published JWKS, no network call per request after the keys are cached).

**Test evidence:** `npm run db:reset` applies all four migrations and seeds; `npm run db:test`
passes; `apps/api/src/app.test.ts` (7 tests, local stack): health, 401 without or with a bad
token, 403 for Old Mill's owner, `/portal/me`, Riverbend's lanes (9 / 7 / 2 / 1, Riverbend leads
only), no tokens or customer details in logs, and a real local Supabase token accepted while a
tampered one is refused. Manual: the server process answered `/health`, refused `/portal/today`
without a token (401) and returned Riverbend's lanes to Rhett's real token. Local stack and mock
data only.

## 2026-11-05 — Phase 1: settings and operations migration

**Change**

- Migration `20261105161651_settings_and_operations.sql` (ledger row added):
  - `playbooks`: the industry catalog (HVAC/plumbing, tattoo, contractor, clinic) as reference
    data in the migration, read-only to the application.
  - `tenant_config`: playbook, number, inbound address, hours, job length, approval window, hold
    length, daily text limit, email sender. The playbook and the clinic minimum-data flag are
    locked: the application can update only the owner-editable columns (CLAUDE.md rule 13).
  - `tenant_templates` and `ai_settings`: write-once versions with one active per tenant, so undo
    is activating an earlier version and history never changes.
  - `service_registrations` (status cards; adds a `disabled` state for offboarding) and
    `integration_connections` (secret names only): read-only to the application.
  - `calendar_connections`, `jobs` and `job_attempts` (unique idempotency key per tenant; a
    running job always has a lease), `opt_outs`, `email_events`, and an append-only
    `audit_events`.
  - Trigger on `app.messages`: an outbound text to a number that opted out of that tenant is
    refused, as a second lock behind the engine (CLAUDE.md rule 12).
  - `app.resolve_inbound_tenant(channel, address)`: maps the number called or address mailed to
    an active tenant before any context exists.
  - `app.claim_jobs(limit, lease_seconds)`: the worker's single cross-tenant path; leases due,
    retryable and stale-lease jobs from active tenants with `for update skip locked`.
- `@fsc/core` `states.ts`: adds service registration states; the drift test now also covers job
  statuses and registration states.
- `packages/mock-data/src/operations.ts` and seed files `03`, `04`, `10`, `11`, `12`; `01` now
  also seeds tenant config and status cards. Riverbend has two versions of each setting (X-06),
  jobs exist in every status with attempts (X-09, including a stale lease for X-04), Wes is opted
  out (RB-12), Ana has a delivered and a bounced email (RB-07, RB-21), and the audit trail covers
  provisioning, offboarding, settings and decisions.
- Tests: `settings_operations.test.sql` (24) and `seed_operations.test.sql` (8).

**Decisions made inside defaults (review):** approval window 120 minutes, hold 24 hours and
daily text limit 200 per tenant as column defaults (owner-editable except the limit); the
playbook catalog lives in a migration because production needs it; required template pieces are
checked by `apps/api`, not the database.

**Test evidence:** `npm run db:reset` builds and seeds from empty; `npm run db:test`: 84/84 pass;
`npm run check`: typecheck, lint and format pass, 97/97 tests. Local stack only.

## 2026-11-05 — Phase 1: lead-domain migration and Riverbend scenarios

**Change**

- Migration `20261105155805_leads_and_conversations.sql` (ledger row added): `contacts`,
  `inbound_events`, `leads`, `calls`, `voicemails`, `ai_analyses`, `conversations`, `messages`,
  `requests` and `calendar_holds` in schema `app`. Every table has `tenant_id`, composite
  foreign keys to its parents (a row can never point into another tenant), row-level security,
  and no delete privilege for the application. Rules held by the schema itself:
  - Intake idempotency: unique `(tenant_id, source, external_event_id)` on inbound events, which
    are append-only to the application (CLAUDE.md rule 2).
  - Templates promise: outbound message authors are only `template` (with its key), `staff` or
    `ai_question`; there is no free-form AI author (rule 10).
  - At most one pending request per lead; decided requests must record who, how and when.
  - Two active holds can never overlap on one calendar (exclusion constraint, `btree_gist`).
  - Contacts are unique per tenant by phone and by email; the same number in two tenants is two
    contacts.
- `@fsc/core` `states.ts`: lead, source, urgency, request and hold state lists, plus the portal
  lane mapping. `tests/schema-constants.test.ts` fails if they drift from the migration's checks.
- `packages/mock-data`: Riverbend's scenario leads (RB-01 to RB-25, without RB-21, which needs
  email events), their contacts, the 12 evaluation-set voicemails, Marcus's scripted thread, and
  requests and holds in pending, approved, changed and expired states. New seed files `05` to `09`.
  `@fsc/mock-data` now depends on `@fsc/connectors` (workspace) for segment counts.
- Tests: `lead_isolation.test.sql` (20) proves cross-tenant reads, writes and references fail and
  each schema rule holds; `seed_leads.test.sql` (6) reads Riverbend as Carla through the
  application role and checks every Today lane, the RB-02 thread, the active hold and the
  transcripts.

**Decisions made inside defaults (review):** voicemail recordings stay with the provider (only
references stored); raw webhook payloads are not stored (hash only); the clinic no-transcript
rule is enforced in code, not the schema, until tenant playbooks exist in the database.

**Test evidence:** `npm run db:reset` builds and seeds from empty; `npm run db:test`: 52/52 pass;
`npm run check`: typecheck, lint and format pass, 95/95 tests. Local stack only.

## 2026-11-05 — Phase 1: mock-data catalog and seed for tenants and logins

**Change**

- New workspace `packages/mock-data`: the four mock tenants and seven portal users from
  `MOCK_DATA.md` as typed objects, each parsed through schemas that enforce the mock rules
  (`mock-` slugs, +1 319 555-0100 to 0199, `example.com/.org/.net`, normalized values).
  Deterministic name-based UUIDs from scenario keys (`mockUuid`).
- `npm run seed:build` generates `supabase/seed/01_tenants_and_config.sql` (tenants) and
  `02_portal_users.sql` (local Supabase Auth users and identities, password `mock-local-only`,
  plus `app.portal_users`). Seed files are never edited by hand; a test fails if they drift
  from the catalog.
- `supabase/tests/seed_sign_in.test.sql` (5 pgTAP tests): the four tenants load with Old Mill
  disabled, only `mock-` tenants exist, each active login resolves to its own tenant and role,
  the disabled tenant's owner cannot sign in, and all seven logins have a password, confirmed
  email and email identity.
- `tenant_isolation.test.sql` fixtures renamed to test-only tenants (`mock-test-*`) so they never
  collide with seed data.
- `DECISIONS_PENDING.md` decision 18: portal front end is React + Vite, matching the WayMaker
  Ink request portal (owner, 2026-11-05).
- Docs: `CLAUDE.md` (layout, commands, phase), `DATABASE.md` (seed generation),
  `MOCK_DATA.md` (catalog status, local password).

**New dependency:** `tsx` (root dev dependency) runs `seed:build`. Node 22 can strip types but
cannot resolve this repo's `.js` import specifiers to `.ts` sources; `tsx` can. Dev-only, never
shipped.

**Test evidence:** `npm run db:reset` loads both seed files; `npm run db:test`: 26/26 pass;
`npm run check`: typecheck, lint and format pass, 89/89 tests. Manual check against
the local Auth API: Rhett and Jules sign in with the mock password (HTTP 200, token issued); a
wrong password is refused (HTTP 400). Local stack only.

## 2026-11-04 — Phase 1: tenancy migration and isolation tests

**Change**

- First migration, `supabase/migrations/20261105050016_tenancy_foundation.sql` (ledger row
  added):
  - Private `app` schema. Tenant data never lives in `public`, so the Supabase Data API cannot
    expose it; the browser roles `anon` and `authenticated` have no privileges in `app`.
  - `fsc_app` application role, created without login or password (each environment enables it).
  - `app.current_tenant_id()` reads the transaction-scoped `app.tenant_id`; missing or malformed
    context matches no rows.
  - `app.tenants` (read-only to the application: only the operator creates or disables tenants)
    and `app.portal_users` (owner/staff, one login per tenant, disabled rather than deleted,
    `unique (tenant_id, id)` for composite foreign keys), both under row-level security.
  - `app.resolve_portal_user(auth_user_id)`: the one cross-tenant read the application gets,
    returning a login's tenant and role only when both the user and the tenant are active.
- `supabase/tests/tenant_isolation.test.sql`: 21 pgTAP tests. As the application role in one
  tenant: sees only its own tenant and users; cannot read, add, edit or move users across
  tenants; cannot create or change tenants or delete users. No or malformed context sees
  nothing. Disabled tenants and disabled users cannot sign in. `anon` and `authenticated` are
  denied. Fixtures are mock values inside a rolled-back transaction.
- `supabase/.gitignore` and `tests/repo-hygiene.test.ts`: local Studio's `supabase/snippets/`
  folder (saved SQL queries) is git-ignored and treated as CLI state, so scratch SQL can never be
  committed.
- `DATABASE.md`: connection rules now name the `app` schema, the `fsc_app` role and sign-in
  resolution.

**Decisions made inside defaults (review):** tables live in schema `app` rather than `public`;
one login belongs to one tenant in MVP; deleting a Supabase Auth user is blocked while a portal
user still points to it. The operator CLI will write through a direct database connection
(the service-role Data API cannot see `app`); settled when the CLI is built.

**Test evidence:** `npm run db:reset` builds cleanly from empty; `npm run db:test`: 21/21 pass;
`npm run check`: typecheck, lint and format pass, 84/84 tests. Local Supabase stack only.

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
