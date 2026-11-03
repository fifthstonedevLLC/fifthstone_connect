---
title: 'MVP Scope — Inquiry-to-Action'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-02'
---

# MVP Scope — Inquiry-to-Action

One standardized workflow, operated by Fifth Stone Dev, for small home-service businesses.
Everything not listed under Inclusions is out of scope and goes to [BACKLOG.md](BACKLOG.md).

## Offer promise (draft)

"We connect the tools your business already uses and keep the workflows running."
When someone submits your website form, they get a confirmation email, you get an alert, the
request is added to your Google Sheet, and your team gets a reminder if it hasn't been handled.

## Inclusions

1. One intake source per customer: hosted/embedded form (Turnstile-protected) **or** one
   supported signed webhook.
2. Canonical lead record stored in Postgres with tenant isolation.
3. Transactional acknowledgment email to the inquirer via Amazon SES (customer-approved template).
4. Owner/staff alert email on each new valid inquiry.
5. One Google Sheets destination (optional), idempotent row append with stable column mapping.
6. Staff follow-up reminder while the lead remains `new` past its due time.
7. Operator-run configuration, monitoring, retries, and failed-job replay.
8. Data export and deletion on customer request.

## Exclusions (MVP)

Customer dashboard or portal · billing/payments · OAuth marketplace · AI features · SMS ·
CRM/field-service sync · accounting · visual workflow editor · marketing/drip email to
inquirers · PHI, cardholder, or other regulated data · 24/7 support · compliance certification.

## Acceptance criteria

| Capability         | Accepted when                                                         |
| ------------------ | --------------------------------------------------------------------- |
| Form intake        | Valid submissions stored; invalid rejected with helpful errors        |
| Abuse prevention   | Turnstile verified server-side; cannot be bypassed on public endpoint |
| Webhook security   | Invalid signature or replay denied                                    |
| Deduplication      | Same external event produces no duplicate side effects                |
| Lead store         | Tenant-scoped queries; migrations and indexes reviewed                |
| SES acknowledgment | Accepted by SES; delivery events observable                           |
| Owner notification | Per-tenant recipients; no cross-tenant leakage                        |
| Sheets             | Idempotent sync; failures retried; permission loss alerts operator    |
| Reminder           | Sent only while lead unresolved; never to the inquirer                |
| Operator tools     | Onboard, disable, replay failures, inspect job status                 |
| Error handling     | API/vendor outage never silently loses an event                       |
| Visibility         | A sample lead traceable end to end by correlation ID                  |
| Privacy            | Customer-approved deletion request can be honored                     |

**Definition of done:** two pilot businesses onboarded by configuration only; operator can
diagnose a failed sync from logs and tools. Onboarding target under 3 hours after initial setup
(goal, not a guarantee).

## Pricing assumptions (unvalidated)

Illustrative anchor: $1,500 setup + $149/month. Setup covers one source, one Sheet, SES messages,
one reminder rule, training, and launch testing. Monthly covers hosting, monitoring, retry
management, and up to 30 minutes of minor changes. Extra development and vendor subscriptions
are separate. **Validate before publishing.**
