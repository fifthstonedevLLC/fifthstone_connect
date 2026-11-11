---
title: 'ADR-0002: Scope v0.2 Architecture'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Proposed'
version: '0.1'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-03'
---

# ADR-0002: Scope v0.2 Architecture

Records the architecture changes required by [SCOPE.md v0.2](../product/SCOPE.md) (missed call
to booked job, owner portal, industry playbooks). ADR-0001's technical decisions stay in force
unless an item below changes them. Items marked **Proposed** need owner sign-off; open details
are in [DECISIONS_PENDING.md](DECISIONS_PENDING.md).

## Context

Owner review on 2026-11-03 found the v0.1 offer (form → acknowledgment email → owner alert →
Google Sheet → reminder) too close to commodity tools. v0.2 targets lost revenue: missed calls,
leads that go cold, and time that is never offered. That adds voice, SMS, AI, calendar access
and a customer-facing portal, all of which v0.1 excluded. The v0.1 foundation (persist before
side effects, durable jobs, idempotency, tenant scoping) is unchanged and carries every new
channel.

## Decisions

### 1. Product direction: missed call to booked job — Accepted (owner, 2026-11-03)

Core loop: capture → clarify → offer → approve → confirm. Fifth Stone Dev operates vendor
accounts and keys; tenants control wording and rules through the portal.

### 2. One engine, industry playbooks as configuration — Accepted (owner, 2026-11-03)

Tattoo, HVAC/plumbing, contractor and clinic tiles are playbooks: default questions, urgency
rules, approver, job lengths and extras, loaded at onboarding into tenant settings. No
industry-specific code paths except where a guardrail requires one (clinic minimum-data rule).

_Updated (owner, 2026-11-11; decision 34):_ the playbooks are now five workflows (service
call, estimate visit, recurring service, studio appointment, shop drop-off), each with trades
that carry starter questions, AI instructions, job lengths and wording. The owner picks the
workflow and trade in Setup instead of Fifth Stone Dev locking it at provisioning
(`20261111181851_business_workflows.sql`). Still no industry-specific code paths.

### 3. Twilio under Fifth Stone Dev as ISV, one subaccount per tenant — Proposed

Fifth Stone Dev registers its own primary business profile as an ISV. Each tenant gets a
subaccount holding its secondary profile, number and messaging service, so one tenant's
traffic problems cannot suspend another tenant. Registration is submitted from the portal
onboarding data through Twilio's APIs. Launch on toll-free verification; add local (10DLC)
numbers later.

_Rejected for now:_ one shared account with per-tenant messaging services (one tenant's
noncompliant traffic can suspend all tenants); texting from the tenant's existing number
(more setup and carrier dependency; backlog).

_Status (Twilio Console, 2026-11-03):_ primary compliance profile approved (Fifth Stone Dev LLC,
Business, ISV Reseller). Fifth Stone Dev's own A2P 10DLC brand is approved (low-volume
standard). One A2P campaign exists as an unsubmitted draft, there are no toll-free
registrations, and the account's one local number has messaging disabled until a campaign is
approved. Client registrations can be submitted once the Twilio adapter exists (Phase 4). The
draft campaign stays unsubmitted until its use case and sample messages can match the built
product.

_Consequence:_ registration lead time per tenant (days, not minutes). The portal shows a
status card and missed-call capture can run before texting is approved.

### 4. Missed-call capture by conditional call forwarding — Proposed

The tenant's existing line forwards unanswered calls to the Fifth Stone Connect number.
Twilio voice webhooks record the call (and voicemail, if left) as an inbound event under the
same persist-before-side-effects rule. Texts therefore come from a different number than the
customer dialed; onboarding says so.

### 5. AI boundary — Accepted as a rule (owner, 2026-11-03); provider Proposed

`packages/ai` compiles the prompt from the tenant's structured AI settings (what we do / don't
do, emergency definition, questions, tone) inside a locked safety layer. Model output must
parse against a Zod schema (summary, category, urgency guess, missing fields, draft question).
Output never triggers an action directly; the conversation engine decides. Times,
confirmations and prices come only from templates. Inbound content is treated as data
(prompt-injection defense). Transcription and language-model providers sit behind
`TranscriptionProvider` and `LanguageModel` interfaces in `packages/connectors`; providers
are chosen after a data-handling review (pending decision 15).

### 6. Conversation as an explicit state machine — Proposed

`packages/conversation` owns lead and request states and the transitions between them. Every
transition is committed with its jobs in one transaction, exactly like v0.1 intake; outbound
texts, emails and calendar writes happen only in the worker with idempotency keys. States are
listed in [SYSTEM_OVERVIEW.md](../architecture/SYSTEM_OVERVIEW.md).

### 7. Calendar: Google Calendar and Acuity behind one interface — Proposed

`CalendarProvider` (read free/busy, place tentative hold, convert hold to event, release
hold). Google Calendar via per-tenant OAuth consent with calendar scopes only; Acuity via API
credentials, as in the WayMaker Ink build. `packages/scheduling` computes slots from hours, job
length, urgency, existing events and holds. The calendar is the source of truth for time; the
lead record is the source of truth for the lead.

_Consequence:_ Google OAuth app verification for calendar scopes must be submitted before
pilots; tokens are high-value secrets (threat model A16).

### 8. Inbound email by forwarding to SES receiving — Proposed

Tenants forward an inquiry address to a Fifth Stone Connect inbound address. No mailbox
OAuth. Full Gmail read access is a restricted scope requiring a paid security assessment and
is not planned.

### 9. Owner portal: `apps/portal` calling `apps/api` only — Proposed

Portal users authenticate with Supabase Auth (as in the WayMaker Ink request portal). The
browser never connects to Postgres and never holds a `service_role` key; it calls
authenticated `apps/api` routes, which resolve the user's tenant and role and apply the same
tenant-scoped repository functions as the worker. This keeps ADR-0001 decision 5 intact. Roles:
`owner`, `staff`. RLS stays defense in depth (pending decision 4).

### 10. Versioned, audited tenant settings — Proposed

Templates and AI settings are stored as versions (`tenant_templates`, `ai_settings`) with
one-click restore. Every change writes an `audit_events` row. Required template pieces and the
safety layer are validated server-side on save and again at send time.

### 11. Clinic minimum-data rule enforced in code — Accepted as a rule (owner, 2026-11-03)

A tenant flag set by the clinic playbook removes clinical fields from questions, skips the AI
path for that tenant's voicemails and messages, and is covered by tests. A full clinical
version (vendor BAAs) is out of scope.

_Superseded in part (owner, 2026-11-11; decision 33):_ clinics and other healthcare practices are
out of scope entirely. The clinic playbook is retired (`20261111160257_retire_clinic_playbook.sql`) and the
minimum-data guard is gone from the code; the deprecated flag columns must stay false until a
later migration drops them.

## Consequences

- More vendors on the critical path (Twilio, transcription, language model, Google, Acuity).
  Each sits behind an interface with a mock for tests; nothing is reported as working until run
  against a real test resource with owner approval.
- New public entry points (Twilio webhooks, SES inbound) and an authenticated web app expand
  the threat model; see THREAT_MODEL.md v0.2.
- Per-lead running costs (texts, transcription, model calls) become part of pricing.
- Onboarding lead time is now set by compliance registration and OAuth verification, not by
  configuration work.

## Owner and date

Phil, Fifth Stone Dev — 2026-11-03 (direction accepted; Proposed items pending sign-off).
