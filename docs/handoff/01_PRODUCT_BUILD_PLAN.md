# Fifth Stone Connect — Product Build Plan

**Owner:** Fifth Stone Dev  
**Document status:** Proposed / Pre-validation  
**Version:** 0.1  
**Last updated:** 2026-11-02  
**Working product name:** Fifth Stone Connect (not approved as a customer-facing brand)

> **Product thesis:** Give small service businesses a reliable bridge between incoming customer inquiries, their existing records, and timely follow-up—without requiring them to replace their current software.

## 1. Executive decision

Build a **managed integration service with a reusable codebase**, not a general-purpose automation builder or SaaS. The first packaged workflow is **Inquiry-to-Action**: accept a website inquiry, normalize and save it, send an authorized transactional acknowledgment, notify the business, write a row to a configured Google Sheet, and schedule a *staff-facing* reminder if the inquiry remains unresolved.

We will initially operate the system ourselves. Customers will **not** receive a new dashboard or self-service workflow designer in MVP. The service integrates with their current workflow, and the operator controls configuration, support, and monitoring.

**Launch target:** home-service businesses that lack reliable inquiry handling (contractors, small repair businesses, local service teams). This is a hypothesis; validate before scaling.

### Guardrails

- One standardized trigger: a hosted or embedded web form, or a verified webhook from a supported source.
- One standardized workflow; no arbitrary drag-and-drop automation.
- One Google Sheets destination per customer in v1; optional when a customer only needs email + storage.
- Transactional email through **Amazon SES** (the owner's existing provider), not Resend.
- Supabase Postgres for storage; a TypeScript API and worker for business logic.
- n8n **not required** in MVP. Evaluate only when a concrete integration benefits from it.
- No payment processing, advanced CRM sync, SMS, AI decisioning, healthcare/PHI workflows, or accounting integrations in v1.
- Avoid building an expansive multi-tenant admin portal. Model customer isolation from day one, but first deploy only controlled pilot accounts.

## 2. Ideal customer and problem

**Ideal customer profile (ICP):** 1–20-person service company with incoming inquiries from a website, a shared inbox or spreadsheet, no dedicated systems administrator, and an owner who values timely follow-up.

**Pain points to verify in interviews:**
1. Inquiry details copied manually from a form/email into a spreadsheet.
2. Customers do not consistently receive acknowledgment.
3. Staff forget to follow up on requests.
4. The owner cannot quickly identify unhandled inquiries.

**Disqualification:** the business already uses and is satisfied with a CRM/field-service platform that handles these problems natively. Do not sell redundant integration work.

**Outcome metrics:** median time to acknowledgment, count of unhandled leads older than 1 business day, manual minutes saved per lead, successful sync percentage, support minutes per customer/month.

## 3. MVP scope and acceptance criteria

| Capability | MVP behavior | Acceptance criterion |
| --- | --- | --- |
| Form intake | Customer-specific hosted form or embedded submission to API | Valid submissions stored; invalid submissions rejected with helpful errors |
| Abuse prevention | Cloudflare Turnstile validated server-side; request throttling | Bot token cannot be bypassed on public form endpoint |
| Webhook security | HMAC signatures for supported server-to-server webhook sources | Invalid signature or replay denied |
| Lead normalization | Required contact fields, optional service/request fields, metadata | Documented canonical lead shape and validation tests |
| Deduplication | Stable request/event ID; avoid repeat processing | Same external event causes no duplicate side effects |
| Lead store | Postgres record with tenant ID, source, status, timestamps | Tenant-scoped queries; migrations and indexes reviewed |
| SES acknowledgment | Configurable transactional template, verified identity, reply-to | Delivery accepted by SES and event status observable |
| Owner notification | Email notification on new valid inquiry | Recipient list configured per tenant, no cross-tenant leakage |
| Google Sheets connector | Append lead data into an authorized customer Sheet | Idempotent sync, stable column mapping, failures retried |
| Follow-up reminder | If still `new` at due time, email business owner/staff | No automated marketing email to customer in MVP |
| Operator tools | CLI or protected minimal admin endpoints for config and status | Can onboard, disable, replay failures, and inspect job status |
| Error handling | Persisted jobs, retry with backoff, dead-letter review | API outage does not silently lose events |
| Visibility | Structured logs, correlation IDs, daily health summary | Operator can trace a sample lead end to end |
| Privacy lifecycle | Retention settings, export/delete process, minimal PII | Operator can honor customer-approved deletion request |

**Definition of done:** two pilot businesses can be onboarded by configuration, not custom code, and the owner can diagnose a failed sync using logs and the operator tools. Target onboarding time **under 3 hours after initial setup**; treat this as a goal, not a guaranteed result.

## 4. Recommended stack and design

- **Language:** TypeScript (Node.js supported LTS); use one typed codebase for API, worker, and connectors. Python reserved for future utilities if needed.
- **API:** Fastify or Express (choose one, document rationale); Zod or similar schema validation.
- **Database:** Supabase-managed PostgreSQL; versioned SQL migrations. Consider Supabase Auth **only when** there are human logins. Do not require user authentication for public form submissions.
- **Background processing:** durable Postgres jobs/outbox table claimed safely by a worker; a schedule runner handles due jobs and reminders. Avoid in-memory timers and best-effort fire-and-forget tasks.
- **Email:** Amazon SES SDK v3; verified sender identity per tenant/domain strategy; use SNS or SES event publishing for bounces/complaints if feasible in pilot.
- **Spreadsheet:** Google Sheets API using scoped credentials and explicit customer authorization; prefer least-privilege credentials and a per-customer Sheet share, not broad Drive access.
- **Bot defense:** Turnstile token verified server-side, basic rate limiting, honeypot as supplementary defense.
- **Hosting:** existing suitable infrastructure (VPS/container or managed service). Decide after a deployment spike; production needs HTTPS, secret management, health checks, and backups.
- **Monitoring:** structured JSON logs, redaction, alerts for failing jobs and error-rate thresholds.
- **Testing:** unit, integration (database/queue), contract tests for connectors, end-to-end with sandbox emails and test Sheets.

### Logical modules

```text
packages/
  core/                 # tenant config, domain models, validation, event contracts
  connectors/           # SES, Sheets, webhook adapters
  workflow/             # durable jobs, orchestration, idempotency
apps/
  api/                  # forms, inbound webhook endpoints, status endpoints
  worker/               # queued actions, scheduled reminders
  operator/             # guarded CLI scripts initially; no full UI
infra/
  migrations/           # Postgres schema and policies
  deployment/           # deployment manifests and runbooks
  monitoring/           # alert rules and health checks
docs/                   # branded internal engineering and operations documentation
```

Suggested data entities: `tenants`, `tenant_config`, `leads`, `inbound_events`, `jobs`, `job_attempts`, `integration_connections`, `audit_events`, `email_events`. All tenant-owned rows include `tenant_id` and have tested isolation. Store Sheets row identifiers/mappings where supported so retries do not duplicate rows. Keys and tokens belong in secrets storage, not in plain tenant configuration or logs.

### Processing contract

1. Receive submission and validate request + Turnstile or source signature.
2. Persist inbound event with unique `(tenant_id, source, event_id)` key.
3. Normalize lead; transactionally insert/update lead and enqueue action jobs.
4. Return success once durable persistence completes (not after third-party calls).
5. Worker executes actions using stable idempotency keys and exponential backoff.
6. Record outcomes, timestamps, and external identifiers; alert on permanent failure.
7. Scheduled job creates staff reminder only while lead status remains unresolved.

**Failure and concurrency cases to test:** duplicate webhook, two simultaneous submissions, SES 429 / rejected sender, Sheets quota exceeded, invalid Sheets permission, worker crash during action, network timeout after external success, malformed contact data, tenant disabled mid-job, late job replay. For non-idempotent APIs such as append-only Sheets calls, design an external marker/lookup reconciliation approach instead of assuming exactly-once execution.

## 5. Security and privacy baseline

- Follow least privilege. No privileged Supabase `service_role` key in browser code; operator/service credentials server-side only.
- Test row-level tenant boundaries if RLS is used; service-role access still requires explicit tenant scoping and checks.
- Authenticate administrative operations; audit changes; apply MFA to production admin accounts where supported.
- Encrypt credentials at rest, rotate on compromise, and exclude PII/secrets from logs.
- Verify webhook signatures with constant-time comparisons and replay windows where supported.
- Use HTTPS, secure headers, schema validation, body-size caps, and per-tenant quotas.
- Collect the minimum customer information needed; specify retention and deletion workflow in contracts.
- Obtain business authorization before accessing customer systems and sending messages; disclose processors in agreements.
- No PHI, cardholder data, regulated data, or sensitive case notes in initial pilots.
- Implement backups plus a **tested restore procedure** before production onboarding.

## 6. Brand and customer packaging

**Master brand:** Fifth Stone Dev (use existing approved identity).  
**Service label:** Fifth Stone Connect (internal working name; confirm brand and domain availability before public adoption).  
**Offer label:** Inquiry-to-Action Setup.

**Voice:** practical, direct, professional, understated. Avoid buzzwords and claims such as “never miss a lead” or “fully hands-off.”

**One-line positioning:** “We connect the tools your business already uses and keep the workflows running.”

**Illustrative pricing to validate:** $1,500 setup + $149/month managed integration. Project fee includes one source, one Sheets destination, SES messages, a reminder, training, and launch testing. Monthly scope includes hosting, monitoring, retry management, and up to 30 minutes of minor changes; extra development and vendor subscription charges are separate. Verify service cost, support load, and willingness to pay before publishing prices.

**Non-goals:** replace Jobber/Housecall Pro, promise security compliance certification, manage client IT infrastructure, or provide 24/7 response coverage.

## 7. Validation gates and economics

**Gate A — Buyer problem:** 5–10 owner interviews; at least 3 describe a recurring, costly workflow gap that existing software doesn't solve well.

**Gate B — Paid demand:** at least 2 signed pilot customers who pay something meaningful for implementation. Avoid free custom builds.

**Gate C — Repeatability:** second customer uses the same code path and configuration with no bespoke branch; track onboarding hours.

**Gate D — Sustainability:** target support under 30 minutes/customer/month after stabilization, documented incident response, and positive contribution margin after infrastructure, API and support costs.

**Gate E — Scale:** only add more integrations or a customer-facing portal when multiple customers request substantially the same feature.

Treat targets as go/no-go hypotheses, not promised market facts.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Existing platforms already solve problem | Qualify and disqualify; integrate only where gap is real |
| Scope creep | Fixed workflow contract, extras quoted separately |
| Email reputation/deliverability | Verified sender identities, SES event monitoring, transactional scope |
| Google API changes/permissions | Connector contract tests, clear reconnect procedure |
| Duplicated leads/actions | Event IDs, DB uniqueness, action reconciliation |
| High support hours | Monitor labor by customer, price adjustments, automation of diagnostics |
| Business owner's limited availability | Business-hours SLA; alerting; explicit emergency exclusions |
| Premature platform development | CLI-first operator control, no drag/drop builder, strict release gates |

## 9. Explicit decisions to record in ADRs

1. Backend framework (Fastify vs Express).
2. Worker scheduling/deployment method.
3. Tenant isolation enforcement and whether pilot database is shared.
4. Google authorization model (customer-shared Sheet/service account vs OAuth).
5. SES sender verification and event delivery model.
6. Hosting/runtime and secret storage.
7. Lead status update method without a customer dashboard.

Each ADR should include context, options, decision, consequences, owner, and date.

## 10. Success criteria for the first release

- End-to-end pilot runs on production-grade hosting with HTTPS and durable jobs.
- Two paying pilots are configured without custom connector code.
- Evidence of tenant isolation, webhook/form abuse protection, retries, and backup restore test.
- Runbook lets operator identify and replay a failed job safely.
- Clear customer-facing scope of service and internal support escalation rules.
- Cost, implementation hours, support hours, and outcome metrics recorded for each pilot.
