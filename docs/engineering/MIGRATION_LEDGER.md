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

| File                                         | Purpose                                                                                                                                       | Status | Superseded by | Staging | Production |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------- | ---------- |
| `20261105050016_tenancy_foundation.sql`      | Private `app` schema, `fsc_app` role, tenant context, `tenants` and `portal_users` with RLS, sign-in resolution                               | active |               |         |            |
| `20261105155805_leads_and_conversations.sql` | Lead domain: contacts, inbound events, leads, calls, voicemails, AI analyses, conversations, messages, requests, calendar holds, all with RLS | active |               |         |            |

## Squash record

No squash yet. One squash is allowed before the first staging push.
