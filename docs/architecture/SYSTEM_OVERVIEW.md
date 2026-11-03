---
title: 'System Overview'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Engineering'
last_updated: '2026-11-02'
---

# System Overview

A TypeScript API accepts inquiries and commits them, with their follow-up jobs, to Postgres in
one transaction. A separate worker process executes those jobs against Amazon SES and Google
Sheets with retries and idempotency. An operator CLI handles configuration and recovery. There
is no customer UI in MVP. Defaults below follow [ADR-0001](../adr/0001-initial-architecture.md).

## Boundaries

| Inside the system                          | Outside (integrated, not owned)                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| API, worker, operator CLI, Postgres schema | Customer website, Cloudflare Turnstile, Amazon SES, Google Sheets, customer inboxes |

## Data flow

```mermaid
sequenceDiagram
    participant V as Visitor / Source
    participant API as apps/api
    participant DB as Postgres
    participant W as apps/worker
    participant SES as Amazon SES
    participant GS as Google Sheets

    V->>API: POST form (Turnstile token) or signed webhook
    API->>API: Validate schema, Turnstile/HMAC, tenant, rate limit
    API->>DB: BEGIN; insert inbound_event (unique tenant+source+event_id);<br/>upsert lead; enqueue jobs (unique action keys); COMMIT
    API-->>V: 202 Accepted (after commit, before any vendor call)
    W->>DB: Claim due job (FOR UPDATE SKIP LOCKED, lease)
    W->>SES: Send acknowledgment / owner alert
    W->>GS: Reconcile by lead ID, then append row
    W->>DB: Record attempt, external IDs, status / backoff / dead-letter
    W->>DB: At due time: if lead still `new`, send staff reminder
```

## Modules

| Module                | Owns                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core`       | Lead/tenant/event types, Zod validators, normalization, status rules                     |
| `packages/connectors` | `EmailSender`, `LeadDestination`, `NotificationChannel` interfaces + SES/Sheets adapters |
| `packages/workflow`   | Job claim/lease, backoff with jitter, attempt caps, dead-letter, idempotency keys        |
| `apps/api`            | HTTP: public form, signed webhooks, health                                               |
| `apps/worker`         | Job loop, reminder scheduler                                                             |
| `apps/operator`       | CLI: tenants, destinations, enable/disable, failed jobs, replay, status, export/delete   |

## Data entities (planned, Phase 1)

`tenants`, `tenant_config`, `integration_connections`, `inbound_events`, `leads`, `jobs`,
`job_attempts`, `email_events`, `audit_events`. All tenant-owned rows carry `tenant_id`.
Secrets are referenced by name, never stored in plain tenant config.

## Error behavior

| Failure                                                      | Behavior                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Invalid input / Turnstile / signature                        | Rejected before persistence; nothing stored                                   |
| Duplicate event                                              | Unique constraint → return original result; no new jobs                       |
| DB unavailable at intake                                     | 503; source may retry; no partial state                                       |
| Vendor transient error (429, 5xx, timeout)                   | Retry with exponential backoff + jitter up to cap                             |
| Vendor permanent error (rejected sender, revoked permission) | Mark failed/dead-letter, alert operator, no infinite retry                    |
| Worker crash mid-job                                         | Lease expires; job reclaimed; reconcile before repeating non-idempotent calls |
| Tenant disabled                                              | Pending jobs skipped and marked; no new intake                                |

## Deployment topology (proposed, pending ADR)

Two long-running Node processes (api, worker) as containers on existing Fifth Stone Dev
infrastructure (Dokploy/Traefik VPS candidate), HTTPS at the proxy, Supabase-managed Postgres,
secrets injected as environment variables from the deployment platform. Decided after a
deployment spike; nothing provisioned yet.
