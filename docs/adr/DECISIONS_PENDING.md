---
title: 'Pending Decisions'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-02'
---

# Pending Decisions

Each item has a working default so routine work continues. Owner confirms or overrides; the
answer is then recorded as an ADR.

| #   | Decision                           | Working default                                                                                                                                            | Needed before         |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | API framework                      | Fastify                                                                                                                                                    | Phase 2               |
| 2   | Job queue                          | Hand-written Postgres queue (SKIP LOCKED + leases)                                                                                                         | Phase 3               |
| 3   | Test database                      | Disposable local Postgres (Docker on owner machine) for integration tests; dedicated non-production Supabase project for deployment tests                  | Phase 1               |
| 4   | Tenant isolation                   | Shared pilot DB; app-level tenant scoping + composite FKs + isolation tests; RLS evaluated as defense in depth                                             | Phase 1               |
| 5   | Google authorization               | Fifth Stone service account; customer shares one specific Sheet with it; `spreadsheets` scope only, no Drive scope                                         | Phase 3               |
| 6   | SES sender model                   | Send from the customer's own domain after DKIM verification in our SES account, reply-to the business; fallback a Fifth Stone-controlled sending subdomain | Phase 3               |
| 7   | SES event delivery                 | Configuration set → SNS → signed HTTPS endpoint on API for bounces/complaints                                                                              | Phase 4               |
| 8   | Hosting + secrets                  | Existing Dokploy/Traefik VPS, containers for api + worker, env-var secrets from Dokploy                                                                    | Phase 5 (spike first) |
| 9   | Lead status updates (no dashboard) | Operator CLI for pilots; consider signed one-click "mark handled" link in staff emails                                                                     | Phase 3               |
| 10  | Reminder timing                    | One reminder at +1 business day (tenant business hours/time zone in config)                                                                                | Phase 3               |
| 11  | Data retention                     | Leads retained 24 months then deleted; inbound raw payloads 30 days                                                                                        | Phase 4 / contract    |
| 12  | Source control                     | Git repo + private GitHub remote                                                                                                                           | Now                   |
