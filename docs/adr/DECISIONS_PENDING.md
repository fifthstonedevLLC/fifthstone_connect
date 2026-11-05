---
title: 'Pending Decisions'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.2'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-03'
---

# Pending Decisions

Each item has a working default so routine work continues. Owner confirms or overrides; the
answer is then recorded as an ADR.

| #   | Decision                                   | Working default                                                                                                                                                                                    | Needed before                    |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | API framework                              | Fastify                                                                                                                                                                                            | Phase 2                          |
| 2   | Job queue                                  | Hand-written Postgres queue (SKIP LOCKED + leases)                                                                                                                                                 | Phase 3                          |
| 3   | Test database                              | Resolved (ADR-0003): local Supabase CLI stack in Docker Desktop; hosted Supabase projects for staging and production                                                                               | —                                |
| 4   | Tenant isolation                           | One shared project per environment; tenant-scoped repositories + composite FKs + RLS on every tenant-owned table using a transaction-scoped tenant context (ADR-0003 decisions 3 and 6)            | Phase 1                          |
| 5   | Google authorization                       | Sheets (optional export only): Fifth Stone service account, one shared Sheet, `spreadsheets` scope. Calendar: per-tenant OAuth consent, calendar scopes only; submit Google app verification early | Phase 3                          |
| 6   | SES sender model                           | Send from the customer's own domain after DKIM verification in our SES account, reply-to the business; fallback a Fifth Stone-controlled sending subdomain                                         | Phase 3                          |
| 7   | SES event delivery                         | Configuration set → SNS → signed HTTPS endpoint on API for bounces/complaints                                                                                                                      | Phase 4                          |
| 8   | Hosting + secrets                          | api, worker and portal as containers on the Hostinger VPS under Dokploy, connected to hosted Supabase; env-var secrets from Dokploy (ADR-0003 decision 4)                                          | Before pilots                    |
| 9   | Lead status updates                        | Resolved by v0.2: approvals and status changes by numbered text reply or in the owner portal (ADR-0002)                                                                                            | —                                |
| 10  | Reminder timing                            | Approval reminder after 2 business hours with no response; "went quiet" lane after 24 hours with no customer reply; tenant business hours/time zone in config                                      | Phase 3                          |
| 11  | Data retention                             | Leads retained 24 months then deleted; inbound raw payloads 30 days; voicemail audio 90 days (transcript follows the lead)                                                                         | Phase 4 / contract               |
| 12  | Source control                             | Git repo + private GitHub remote                                                                                                                                                                   | Now                              |
| 13  | v0.2 build order and pilots                | Build order resolved (owner, 2026-11-03): foundation → portal on mock data → engine on mocks → integrations → pilot (SCOPE.md). Release scope as in SCOPE.md. Pilot businesses still open          | Before Phase 5                   |
| 14  | v0.2 offer name                            | None; describe plainly ("missed call to booked job")                                                                                                                                               | Before marketing launch          |
| 15  | Transcription and language-model providers | None chosen. Evaluate on data retention, no training on customer data, US data handling, cost per lead                                                                                             | Before AI code runs on real data |
| 16  | Twilio number type                         | Toll-free verification first; local 10DLC later                                                                                                                                                    | Before first registration        |
| 17  | Portal authentication                      | Supabase Auth; portal calls `apps/api` only; roles `owner` and `staff`; MFA offered to owners                                                                                                      | Before portal build              |
| 18  | Portal front-end stack                     | Decided in a short spike; reuse WayMaker Ink request portal patterns where they fit                                                                                                                | Before portal build              |
| 19  | Slot hold timeout                          | Hold released 24 hours after the request or 2 hours before the slot, whichever is sooner                                                                                                           | Phase 3                          |
| 20  | Google Sheets destination                  | Optional export; not built until a pilot asks                                                                                                                                                      | Phase 3                          |
| 21  | v0.2 pricing                               | Working assumptions in SCOPE.md: ~$1,000 setup, ~$199 Standard / ~$349 Busy / base + overage for high volume, $99 pilots; validate with pilots                                                     | Before publishing                |
| 22  | Supabase region and plan                   | Region closest to the VPS data center; plan tier chosen for backups and point-in-time recovery before pilots                                                                                       | Before staging                   |
| 23  | Tenant provisioning                        | Operator CLI `tenant create`, idempotent and audited (ADR-0003 decision 5)                                                                                                                         | Phase 4                          |
