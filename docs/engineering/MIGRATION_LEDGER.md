---
title: 'Migration Ledger'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Approved'
version: '1.0'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-04'
---

# Migration Ledger

One row per file in `supabase/migrations/`, in the same order. `tests/repo-hygiene.test.ts` fails
if a migration file has no row here or a row names a file that does not exist. Rules:
[DATABASE.md](DATABASE.md).

Status values: `active` (in force), `superseded` (replaced by a later migration; the file stays
so the database can be rebuilt from empty). Applied dates are filled in when `supabase db push`
succeeds against that environment.

| File                                           | Purpose                                                                                                                                                                                                | Status | Superseded by | Staging | Production |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------- | ------- | ---------- |
| `20261105050016_tenancy_foundation.sql`        | Private `app` schema, `fsc_app` role, tenant context, `tenants` and `portal_users` with RLS, sign-in resolution                                                                                        | active |               |         |            |
| `20261105155805_leads_and_conversations.sql`   | Lead domain: contacts, inbound events, leads, calls, voicemails, AI analyses, conversations, messages, requests, calendar holds, all with RLS                                                          | active |               |         |            |
| `20261105161651_settings_and_operations.sql`   | Playbook catalog, tenant config, versioned templates and AI settings, registrations, connections, jobs, opt-outs (with outbound guard), email and audit events; inbound-tenant and job-claim functions | active |               |         |            |
| `20261105165057_admin_can_act_as_app_role.sql` | `grant fsc_app to postgres`, so admin connections run tenant work as the application role                                                                                                              | active |               |         |            |
| `20261105225952_onboarding.sql`                | Onboarding: business details for texting registration, setup progress, and `portal_users.approves_requests`, with RLS                                                                                  | active |               |         |            |
| `20261106011219_claim_jobs_by_type.sql`        | `app.claim_jobs(limit, lease, action_types, tenant)`: claim only job types with handlers, optionally for one tenant                                                                                    | active |               |         |            |
| `20261109181751_calendar_sync.sql`             | Outlook (Microsoft) as a calendar provider, `calendar_connections.last_synced_at`, and `calendar_busy` (synced busy times, start and end only) with RLS                                                | active |               |         |            |
| `20261109190304_schedule_calendar_syncs.sql`   | `app.schedule_calendar_syncs(minutes, tenant)`: queues one `sync_calendar` job per connected calendar of each active business per period, never doubled                                                | active |               |         |            |
| `20261109191515_slot_offers.sql`               | `slot_offers`: the numbered times each customer was offered, one open time per number per lead, with RLS                                                                                               | active |               |         |            |
| `20261109194419_approver_texts.sql`            | `approver_texts`: approval requests, approver replies and answers, kept apart from the customer thread, with RLS                                                                                       | active |               |         |            |
| `20261109210831_voicemail_transcripts.sql`     | Column-level update grant on `voicemails` (`transcript`, `transcript_confidence`) for the worker                                                                                                       | active |               |         |            |
| `20261110002752_emergency_alerts.sql`          | `approver_texts.kind` adds `alert`, for emergency alerts to approvers                                                                                                                                  | active |               |         |            |

## Squash record

No squash yet. One squash is allowed before the first staging push.
