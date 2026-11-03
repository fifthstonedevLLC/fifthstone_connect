---
title: 'Operations Runbook'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-02'
---

# Operations Runbook

How the operator checks health, triages alerts, and recovers failed work. Sections marked
_(Phase N)_ are placeholders until that phase ships; do not rely on them yet.

## Contacts

| Role                                | Who                   |
| ----------------------------------- | --------------------- |
| Operator / on-call (business hours) | Phil, Fifth Stone Dev |
| Escalation                          | **TBD**               |

Support coverage is business hours only. No 24/7 commitment.

## Health checks _(Phase 4)_

- `GET /healthz` — process up.
- `GET /readyz` — database reachable.
- Worker heartbeat — last job-loop tick timestamp.

## Alert triage _(Phase 4)_

| Alert                   | First step                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Dead-letter jobs > 0    | List failed jobs for the tenant; read last attempt error                                         |
| SES bounce/complaint    | Check recipient; pause tenant sends if complaint rate rises                                      |
| Sheets permission error | Confirm the Sheet is still shared with the service account; follow reconnect steps in ONBOARDING |
| Sustained API errors    | Check `/readyz`, database status, recent deploy                                                  |

## Replay a failed job _(Phase 4)_

Replay is safe only for jobs whose action is idempotent or reconciled (Sheets lookup by lead
ID). Exact CLI commands are added when the operator CLI ships.

## Backups and restore _(Phase 4)_

Backup cadence: **TBD by owner.** A restore drill must succeed before the first production
tenant. Record each drill in `docs/changelog.md`.
