# Fifth Stone Connect — Claude Execution Guide

**Purpose:** Build a small, production-minded pilot without overengineering.  
**Inputs:** `01_PRODUCT_BUILD_PLAN.md`; existing Fifth Stone Dev brand assets only if supplied.  
**Working assumptions:** TypeScript/Node, Supabase Postgres, Amazon SES, Google Sheets, Cloudflare Turnstile. Confirm actual accounts/configuration, never assume credentials exist.

## Operating instructions for Claude

You are acting as the engineering partner and technical writer for Fifth Stone Dev. **Before coding**, inspect the repository and identify existing architecture, conventions, deployments, and secrets handling. Present an implementation proposal and file list. Work in small increments. Favor readable, secure, boring solutions over generic platform abstractions. If a third-party service is unreachable, implement an adapter and tests using mocks; do not invent successful API verification.

### Never do the following without explicit owner approval

- Register domains, provision paid infrastructure, or change production DNS.
- Send real emails to customers or access real lead data.
- Generate or expose live API keys; commit `.env` files or credentials.
- Change client systems or create SaaS subscriptions.
- Expand MVP to include AI agents, payments, SMS, full CRM, or customer portal.
- Claim an external integration works when it has only been tested with mocks.

## Phase 0 — Repository and documentation foundation

**Tasks**
1. Check whether a repo exists; inventory existing files.
2. Create clear directory structure; initialize TypeScript workspace only if necessary.
3. Add `.gitignore`, `.env.example` with placeholders, formatting/lint/testing scripts.
4. Create `/docs/README.md`, `/docs/brand/STYLE_GUIDE.md`, `/docs/product/SCOPE.md`, `/docs/architecture/SYSTEM_OVERVIEW.md`, `/docs/adr/0001-initial-architecture.md`, `/docs/operations/RUNBOOK.md`, `/docs/security/THREAT_MODEL.md`, `/docs/changelog.md`.
5. Write `/CLAUDE.md` documenting the project purpose, coding constraints, architecture decisions, security rules, documentation update expectations, and exact test commands.
6. Use **Fifth Stone Dev** as the approved master brand; label **Fifth Stone Connect** as working/internal. Do not fabricate an existing logo, fonts, brand color hex values, registered name, testimonials, or certifications.

**Exit:** repository scripts and docs structure are working; architectural assumptions visible.

## Phase 1 — Schema and interfaces

**Tasks**
1. Define canonical TypeScript types and Zod validators for lead, tenant, event, action job, and integration connection.
2. Write versioned migrations for tenant config, leads, inbound events, jobs, attempts, and audits.
3. Add indexes and uniqueness on tenant/source/external event ID and action key.
4. Create connector interfaces e.g. `EmailSender`, `LeadDestination`, `NotificationChannel`.
5. Add a migration/test path using local Postgres or a dedicated nonproduction Supabase project.
6. Prove that tenant A cannot read, update, or process tenant B resources.

**Exit:** schema applies cleanly from empty database, tests pass, and documented rollback/restore strategy exists.

## Phase 2 — Secure intake API

**Tasks**
1. Implement public form submission endpoint with validation, tenant lookup by public opaque ID, size/rate limits, and Turnstile verification.
2. Implement authenticated server-to-server webhook endpoint with per-source signature validation and replay protection.
3. Persist accepted events and enqueue durable actions in a single transaction.
4. Return consistent error codes; avoid logging sensitive customer information.
5. Add tests for malformed submissions, replay, duplicates, concurrency, and disabled tenants.

**Exit:** repeated request produces one logical lead and at most one logical action per destination.

## Phase 3 — Job worker and external connectors

**Tasks**
1. Implement a safe job claim mechanism with leases, timeout recovery, capped attempts, exponential backoff with jitter, and dead-letter status.
2. Write Amazon SES adapter with mockable SDK boundary; support subject, body, verified sender configuration, reply-to, tags/correlation ID.
3. Write Google Sheets adapter using minimal API scope; test spreadsheet and permissions errors, timeouts, retries, and duplicate reconciliation.
4. Implement customer acknowledgment and owner alert as *transactional* templates with a restrained voice.
5. Store action status and external reference identifiers; redact sensitive data in logs.
6. Implement staff reminder worker for overdue `new` leads. Define how pilot staff mark a lead resolved (initially a controlled operator action or approved external status input).

**Exit:** one lead traverses API → storage → queued actions → mocked SES/Sheets; failure and retry tests are green.

## Phase 4 — Operations and reliability

**Tasks**
1. Implement protected operator commands: create tenant, configure destination, enable/disable tenant, list failed jobs, replay safe job, update lead status, and export tenant data.
2. Add health endpoints and structured logging with request/job correlation IDs.
3. Add actionable alerts for failed jobs, sustained API failures, SES bounces/complaints, and Sheets authorization issues.
4. Document backup cadence, retention and restore drill (actual cadence to be decided by owner).
5. Develop onboarding checklist, incident response, credential rotation, data deletion and offboarding procedures.
6. Complete threat-model review and an abuse test against public intake.

**Exit:** operator can explain and recover a known failure using documented steps; backup restore has been tested.

## Phase 5 — Pilot deployment

**Tasks**
1. Provision nonproduction deployment with owner approval and a secrets manager/environment-variable strategy.
2. Configure test SES identity, test Google Sheet, Turnstile test keys, DNS/HTTPS, alert recipients.
3. Run end-to-end tests against **test resources** and document evidence.
4. Perform an owner-led production readiness checklist (auth, data boundaries, logging, email, backups, quotas, support scope).
5. Onboard first paying pilot under a signed scope and authorized credentials.
6. Gather operational metrics for 2–4 weeks before onboarding a second pilot.

**Exit:** first live workflow is stable, documented, and billable; no unsupported availability or SLA claims.

## Phase 6 — Productization

**Tasks**
1. Convert first customer configuration into reusable tenant setup template.
2. Run second pilot with **no application-level customizations** if possible.
3. Measure setup hours, support burden, incident frequency, monthly infrastructure expense, and measurable client value.
4. Create pricing/scope revision proposal based on measured results.
5. Decide whether to add CRM connector, self-service dashboard, or automated status synchronization. Choose at most one.

**Exit:** evidence supports (or rejects) expanding the offering.

## Minimum automated test checklist

- [ ] Valid form submit → durable event + one lead.
- [ ] Invalid Turnstile → rejected, no event stored.
- [ ] Invalid webhook signature → rejected.
- [ ] Duplicate/replayed event → no repeated customer messages or Sheet rows.
- [ ] Concurrent identical requests → no duplicate actions.
- [ ] Tenant mismatch → denied.
- [ ] SES transient failure → bounded retry.
- [ ] SES permanent failure → flagged, no infinite retry.
- [ ] Sheets permission revoked → failed job + operator alert.
- [ ] Worker crash between API attempt and acknowledgment → safe replay/reconcile.
- [ ] Reminder sent only when status is unresolved.
- [ ] Disabled tenant stops future actions appropriately.
- [ ] PII/secrets redacted from logs.
- [ ] Data export/deletion and backup restoration procedures tested.

## Work cadence and checkpoints

At the end of **every** implementation session Claude should:

1. State what changed, in plain language.
2. List changed files and new dependencies.
3. Show actual commands/tests run and pass/fail results; distinguish mocks from real tests.
4. Identify security/privacy implications and pending decisions.
5. Update `/docs/changelog.md` and any affected architecture/runbook docs.
6. Propose the **single next smallest deliverable**.

## Technical documentation branding standard

Internal documents must use the approved company name **Fifth Stone Dev** and the working service name **Fifth Stone Connect**. Use these frontmatter fields when useful:

```yaml
---
title: "<document title>"
product: "Fifth Stone Connect"
organization: "Fifth Stone Dev"
status: "Draft"
version: "0.1"
owner: "Engineering"
last_updated: "YYYY-MM-DD"
---
```

**Voice:** concise, confident, practical, professional, and unembellished. No exaggerated marketing language, invented performance statistics, or claims of compliance certification.

**Documentation design:** consistent H1 and H2 hierarchy, short summary at top, clearly separated decisions and open questions, tables only where helpful, Mermaid diagrams when they clarify flows, links to related ADRs, and copyable commands. If producing a PDF or branded HTML later, request real logos/colors/fonts from the owner first.

### Required docs and what each must contain

| File | Content |
| --- | --- |
| `/docs/product/SCOPE.md` | Offer promise, inclusions/exclusions, acceptance criteria, pricing assumptions |
| `/docs/architecture/SYSTEM_OVERVIEW.md` | Boundaries, data flow, modules, error behavior, deployment topology |
| `/docs/adr/*.md` | Architectural decisions and rejected alternatives |
| `/docs/security/THREAT_MODEL.md` | Assets, entry points, abuse cases, mitigations, owner sign-off |
| `/docs/operations/RUNBOOK.md` | Health checks, alert triage, replay instructions, contacts, recovery |
| `/docs/operations/ONBOARDING.md` | Tenant setup, SES identity, Sheets auth, acceptance test, training |
| `/docs/operations/OFFBOARDING.md` | Data handling, access revocation, retention/deletion confirmation |
| `/docs/brand/STYLE_GUIDE.md` | Approved names, audience, voice, content conventions, missing brand assets |
| `/docs/changelog.md` | Date, change, rationale, test evidence |

## Commercial execution in parallel with engineering

**Week 1:** interview 5–10 owner/operators; record existing apps, manual steps, pain severity, native alternatives, willingness to pay. No new platform features just because one prospect mentions them.

**Week 2:** demo one end-to-end workflow using test data; invite qualified businesses to critique it.

**Week 3:** secure one paid, scope-controlled pilot. Proposed anchor: $1,500 setup + $149/month, adjusted based on sales evidence and implementation cost.

**Weeks 4–6:** configure, launch, monitor first pilot; collect lead-processing metrics and implementation/support time.

**Weeks 7–10:** onboard second customer by configuration and compare delivery cost. Only then consider expansion.

## Stop / re-evaluate signals

Pause new engineering if prospects already get these features from their software, sales require major customization, setup exceeds the planned margin, customer messaging introduces regulated-data requirements, or monitoring/recovery is not reliable enough to justify the monthly fee.
