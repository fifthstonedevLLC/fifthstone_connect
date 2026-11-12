# CLAUDE.md — Fifth Stone Connect

Instructions for Claude (and any engineer) working in this repository. Read this first, then
`docs/handoff/01_PRODUCT_BUILD_PLAN.md` and `docs/handoff/02_EXECUTION_GUIDE.md`.

## Purpose

**Fifth Stone Connect** (approved name, provisional pending trademark search) is a managed
service from **Fifth Stone Dev** for 1–20 person businesses where the person doing the work
also answers the phone. Product scope is `docs/product/SCOPE.md` **v0.2**:

missed call / text / forwarded email → lead record → clarifying texts (only what's missing,
numbered urgency) → open times offered from the tenant's calendar with a tentative hold →
owner or staff approves by text or in the owner portal → calendar event + confirmation.

Each tenant gets an owner portal (Today dashboard, lead pages, owner-editable templates and
AI settings, onboarding with a test call). Business types are configuration on one engine,
not separate products: five workflows (service call, estimate visit, recurring service, studio
appointment, shop drop-off), each with trades the owner picks in Setup (decision 34). Healthcare practices are
out of scope (decision 33). Fifth Stone Dev
operates the plumbing (Twilio ISV account, SES, keys, deliverability); owners control wording
and rules.

The v0.1 Inquiry-to-Action pipeline (form → SES ack → owner alert → Sheets → reminder) is the
foundation: its intake, durable jobs, idempotency and reminders carry forward.

## Current phase

Build order (owner, 2026-11-03; `docs/product/SCOPE.md`): 1 foundation → 2 portal on mock data
→ 3 engine on mocks → 4 integrations → 5 pilot. Real vendors (Twilio, SES, calendars, AI
providers) are planned and stay behind interfaces with mocks, but no real adapter is built until
Phase 4, after the portal works and multi-tenant isolation is proven.

Phase 1 complete. Done: core types and validation (`packages/core`), connector interfaces
with labeled mocks (`packages/connectors`), the tenancy migration (`app.tenants`,
`app.portal_users`, RLS) with its isolation tests, the mock-data catalog with generated seed files
for the mock tenants and local logins (four tenants and six logins: the clinic was retired, and
Cedar Lane is a business still onboarding), the lead-domain migration (contacts through calendar holds) with scenario leads for
every mock tenant, and the settings and operations
migration (playbooks, config, versioned settings, registrations, connections, jobs, opt-outs,
audit) with its seed. Phase 1 is complete: `db:reset` builds cleanly and isolation tests pass for
every table.

Phase 2 complete: `apps/api` (Fastify) serves `/health`, `/portal/me`, `/portal/today` and
`/portal/leads/:id`, `POST /portal/leads/:id/actions`, `POST /portal/leads/:id/replies` and the
settings routes with Supabase sign-in and tenant-scoped transactions; `apps/portal` (React + Vite) shows the Front Desk (work queues)
with counts (`nextStep` and `QUEUES` in `packages/conversation`), the selected lead open beside
the list, and the full lead page, takes actions (approve, suggest another time, nudge, close; owners and staff, decision 25) and sends replies: owner-approved templates, or the person's own words where the owner
switched free text on (decision 39). Each action writes
the decision, its jobs and an audit event in one transaction; the portal shows only
server-confirmed state (decision 24). The Templates & AI page edits versioned templates and AI
settings with restore (`/portal/settings`; owner-only writes, decision 27); template rules live in
`packages/conversation/src/templates.ts` and run on the server before any version is written.
The Calendar page shows the week: business hours, held and booked appointments, busy time synced
from the connected calendar (Google, Outlook or Acuity; start and end only) and the open time left
(`/portal/calendar`, `packages/scheduling`; the sync itself is mocked until Phase 4). The Setup page walks the owner through onboarding (business type, details for texting
registration, hours and calendar, template review, approvers) and a labeled simulated test call
(decision 29); nothing is sent to a vendor. Business type is a workflow and a trade
(`packages/conversation/src/playbooks.ts`, `app.playbooks`, `app.trades`); picking one applies its
starter templates, AI instructions and job length as new versions (decision 34). Until a business
is live it is locked (decision 35): status `onboarding` signs in to Setup and Templates & AI only,
the API refuses the working pages (`not_live`), setup step 7 is a choice (send the texting
application or go without texting; decision 36), and nothing runs for it until Fifth Stone Dev turns
it on with `npm run operator -- go-live <slug>` (finished setup and a number; never texting
approval). The Settings page (`/portal/business`) holds the team, what staff can do
(capabilities in `packages/core/src/permissions.ts`, checked on every API route; decision 40), the
free-text switch and the Act now limit; new people choose a password from a one-time link the
operator CLI prints. That completes the Phase 2 screens.

Phase 3 complete (engine on mocks): `apps/worker` claims due jobs of the types it has
handlers for (`app.claim_jobs` with action types), runs them against labeled mock connectors and
settles each in one transaction with retries and dead-letter (`packages/workflow`). Handlers so
far: `confirm_calendar_event` (approved lead becomes booked, confirmation text queued),
`send_text`, `release_hold`, `sync_calendar` (busy times into `app.calendar_busy` every 15
minutes, without this service's own holds and events; a revoked calendar is marked and offers
pause), `send_slot_offer` (two or three numbered open times by text, recorded in
`app.slot_offers`) and `handle_offer_reply` (a numbered reply becomes a pending request with a
calendar hold; a taken time is re-offered; anything else goes to a person). Offer rules live in
`packages/conversation/src/offers.ts`, slot calculation in `packages/scheduling`. Intake:
`POST /webhooks/phone` (signed; the labeled `MockPhoneEvents` until Phase 4) records each missed
call, voicemail and text with its lead in one transaction (`planInbound` in
`packages/conversation/src/intake.ts`): a new caller gets `send_text_back`, a reply to open times
goes to `handle_offer_reply`, STOP and START are honored at once, and any other text goes to a
person. Approving by text: a pick queues `send_approval_request` (the owner's `approval_request`
template to each approver, playbooks that approve by text), recorded in `app.approver_texts`; an
approver's 1, 2 or 3 goes through the same `applyAction` as the portal (decided by text). The clarify step:
a customer's text queues `clarify_lead`; the model (via `packages/ai`: locked safety layer, prompt
compiler, Zod-validated output) only says which of the owner's questions are answered, and
`planClarify` asks the next one word for word, offers times, or hands the lead to a person.
Locally the worker uses `MockRulesModel` (fixed rules, not AI). Voicemails:
intake queues `transcribe_voicemail`; the transcript is read by the same step,
and the text-back follows from it (`{need}`, a guarded phrase, and `{question}`, the owner's first
unanswered question). Locally the worker uses the mock transcriber. The loop runs end to end on
mocks with no step done by hand. If nobody decides:
`approval_reminder` texts the approvers once after the approval window (business hours,
`afterOpenMinutes`), and `expire_hold` releases the hold when it runs out (decision 19), marks the
request expired and puts the lead in front of a person. Emergencies skip the
queue: a hazard in the customer's own words (gas, flooding, crisis language; a fixed phrase list in
`packages/conversation/src/safety.ts`, never AI) sends a fixed message that
owners cannot edit (`send_safety_message`; crisis points to 911 only) and alerts the approvers at
once; a clarify-step emergency alerts them too (`emergency_alert`). The exact wording waits on
decision 32, the customer's "still confirming" text on decision 31. Phase 3 closed on
2026-11-10 after a review of the loop's edge cases (changelog). Next: Phase 4 integrations, each
real adapter run against a real test resource with owner approval: provider choices (decisions 6,
15, 16), Twilio toll-free registration, SES domain verification and Google/Microsoft calendar app
verification, plus the wording in decisions 31 and 32 (`docs/adr/0003-database-platform-and-hosting.md`). The proposed order of work after that (every channel, free-text replies, permissions, order
support, and the Contacts, Reporting and Settings pages) is `docs/product/ROADMAP.md`; its open
choices are decisions 38 to 43. Track status in `docs/changelog.md`; open
decisions live in `docs/adr/DECISIONS_PENDING.md`.

## Commands

```bash
npm install            # install dev dependencies (re-run on each OS; native binaries differ)
npm run typecheck      # tsc --noEmit across all workspaces
npm run lint           # eslint
npm run format:check   # prettier --check (npm run format to fix)
npm test               # vitest run
npm run check          # all of the above, in order

npm run db:start       # local Supabase stack in Docker Desktop (migrations + seed applied)
npm run db:reset       # rebuild the local database from migrations, then load seed data
npm run db:new -- name # new migration in supabase/migrations/
npm run db:test        # pgTAP tests in supabase/tests/
npm run db:stop
npm run seed:build     # regenerate supabase/seed/ from packages/mock-data (never edit seeds by hand)
npm run dev -w @fsc/api # API on http://127.0.0.1:8787 (reads .env; needs the local stack)
npm run dev -w @fsc/portal # portal on http://127.0.0.1:5173 (apps/portal/.env.local; needs the API)
npm run dev:phone -w @fsc/portal # portal for a phone on the same Wi-Fi, http://<this PC's IP>:5174 (mock data)
npm run dev -w @fsc/worker # worker, polling for due jobs (mock connectors only)
npm run once -w @fsc/worker # run every due job once, then exit
npm run operator -- list  # operator CLI: list, show, create, add-person, password-link, number, texting, go-live, disable (guarded)
```

Database rules, environments and local setup: `docs/engineering/DATABASE.md`.

CI (`.github/workflows/ci.yml`) runs on every pull request and push to `main`: `npm run check` and
the portal build, then a throwaway local Supabase stack for `db:reset`, `db:test` and the API route
and worker tests (which must run there, not skip). Mock data only; no secrets.

## Layout

| Path                    | Responsibility                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core`         | Domain models, Zod validation, event contracts, tenant config                                                     |
| `packages/connectors`   | Interfaces to Twilio, SES, calendars, transcription and models; labeled mocks in `@fsc/connectors/mock`           |
| `packages/workflow`     | Durable jobs: how a run settles (retry with backoff and jitter, dead-letter)                                      |
| `packages/conversation` | Portal actions, queues, templates, intake, clarify, offers, approvals and safety rules (built)                    |
| `packages/scheduling`   | Open windows from business hours, open slots, day capacity, business-hours timing (built)                         |
| `packages/ai`           | Prompt compiler, locked safety layer, AI output schemas (built: the clarify step)                                 |
| `packages/mock-data`    | Mock tenants, users and scenarios (MOCK_DATA.md) and the seed generator; local only                               |
| `apps/api`              | Form, signed webhooks, Twilio voice/SMS webhooks, SES inbound, portal API, health                                 |
| `apps/worker`           | Runs every engine job (built, on labeled mocks until Phase 4): texts, calendar, clarify, offers, approvals        |
| `apps/portal`           | Owner portal (React + Vite): sign-in, Front Desk, lead pages, Templates & AI, Setup; calls only `apps/api`        |
| `apps/operator`         | Guarded CLI (built: create, number, texting status, go-live, disable, list, show; later replay, export/delete)    |
| `apps/marketing`        | Static marketing page (local review only, not deployed)                                                           |
| `supabase/migrations`   | Every schema change; the only SQL that reaches a hosted database (ledger: `docs/engineering/MIGRATION_LEDGER.md`) |
| `supabase/seed`         | Local-only mock data, `NN_name.sql`, loaded by `db:reset`                                                         |
| `supabase/tests`        | pgTAP database tests                                                                                              |
| `infra/deployment`      | Dokploy/VPS deployment notes                                                                                      |
| `docs/`                 | Product, architecture, ADRs, operations, security, brand                                                          |

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
9. **Out of scope → `docs/product/BACKLOG.md`**, not code. SCOPE.md v0.2 is the list of what
   is in. Excluded: automatic rescheduling of existing customers, multi-technician routing,
   billing/payments, quoting, field-service sync (Jobber, Housecall Pro), full
   mailbox access, texting from a tenant's existing number, clinics and other healthcare
   practices, clinical or other regulated data,
   promotional texts, visual workflow editor.
10. **AI understands; templates promise.** AI may transcribe, summarize, classify, find
    missing details and draft clarifying questions. Times, confirmations, prices and any
    commitment come only from owner-approved templates. AI output is validated against a Zod
    schema and never triggers an action on its own. Inbound call, text and email content is
    data, never instructions to the AI layer.
11. **Locked layers are enforced server-side.** Required template pieces (business name,
    opt-out line), the AI safety layer and the emergency safety message cannot be removed by
    owner edits. The portal UI is not the enforcement point.
12. **Opt-out is absolute.** STOP is honored immediately, recorded per tenant and number,
    and checked before every outbound text.
13. **No healthcare practices** (owner, 2026-11-11; decision 33). Clinics, dental offices,
    therapists and other healthcare practices are not onboarded, and no playbook asks for
    clinical detail. The clinic playbook is retired (`retire_clinic_playbook` migration); its
    deprecated `clinic_minimum_data` columns must stay false until a later migration drops them.
14. **No automatic rescheduling.** The system may suggest moving a job; only a person moves
    an existing customer.
15. **Schema changes only through migrations** (`npm run db:new`), with the header, ledger row
    and forward-only rules in `docs/engineering/DATABASE.md`. Never edit a migration that has
    reached staging or production; deprecate with a superseding migration.
16. **No stray files.** No scratch, temporary, cleanup, teardown, backup or one-off scripts or
    SQL anywhere in the repo. Tests clean up after themselves (rolled-back transactions or
    `db:reset`). `tests/repo-hygiene.test.ts` enforces this.
17. **Mock data stays mock.** Only `mock-` tenants, 555-0100 to 555-0199 phone numbers and
    `example.com`/`.org`/`.net` email addresses, per `docs/product/MOCK_DATA.md`. Seed files are
    local only and never pushed.

## Requires explicit owner approval

Cost, credentials, customer-facing messaging, security exposure, production changes, real email
sends, pushing migrations to staging or production, real texts or calls, Twilio number purchases and compliance registrations, sending lead
data to an AI or transcription provider, real lead data, DNS, paid infrastructure, new SaaS
subscriptions.

## Brand

Use **Fifth Stone Dev** (master brand) and **Fifth Stone Connect** (service name, approved
2026-11-03; domain `connect.fifthstonedev.com`). "Inquiry-to-Action" named the v0.1 offer; the
v0.2 offer name is pending (DECISIONS_PENDING). Until then describe it plainly ("missed call
to booked job").
Never invent logos, colors, fonts, testimonials, statistics, or certifications.
See `docs/brand/STYLE_GUIDE.md`.

## End-of-session checklist

1. What changed, in plain language. 2. Changed files and new dependencies. 3. Commands run with
   actual pass/fail (mock vs. real called out). 4. Security/privacy implications and pending
   decisions. 5. Changelog + affected docs updated. 6. The single next smallest deliverable.
