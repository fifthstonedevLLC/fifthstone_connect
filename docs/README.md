---
title: 'Documentation Index'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Engineering'
last_updated: '2026-11-02'
---

# Documentation Index

Internal engineering and operations documentation for Fifth Stone Connect.

| Area         | Document                                              | Purpose                                                                |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Product      | [SCOPE.md](product/SCOPE.md)                          | Offer, inclusions/exclusions, acceptance criteria, pricing assumptions |
| Product      | [BACKLOG.md](product/BACKLOG.md)                      | Out-of-scope ideas parked for later gates                              |
| Architecture | [SYSTEM_OVERVIEW.md](architecture/SYSTEM_OVERVIEW.md) | Boundaries, data flow, modules, error behavior                         |
| Decisions    | [adr/](adr/README.md)                                 | Architecture decision records                                          |
| Decisions    | [DECISIONS_PENDING.md](adr/DECISIONS_PENDING.md)      | Open decisions and current defaults                                    |
| Security     | [THREAT_MODEL.md](security/THREAT_MODEL.md)           | Assets, entry points, abuse cases, mitigations                         |
| Operations   | [RUNBOOK.md](operations/RUNBOOK.md)                   | Health checks, triage, replay, recovery                                |
| Operations   | [ONBOARDING.md](operations/ONBOARDING.md)             | Tenant setup procedure                                                 |
| Operations   | [OFFBOARDING.md](operations/OFFBOARDING.md)           | Access revocation, data deletion                                       |
| Brand        | [STYLE_GUIDE.md](brand/STYLE_GUIDE.md)                | Names, voice, conventions, missing assets                              |
| History      | [changelog.md](changelog.md)                          | Dated changes with test evidence                                       |
| Source       | [handoff/](handoff/README.md)                         | Original plan documents (read-only reference)                          |

## Conventions

- Use the frontmatter block above on every document.
- One H1 per document, followed by a one-paragraph summary.
- Keep decisions and open questions in clearly labeled sections.
- Use Mermaid for flows when it clarifies; tables only where they help.
- Status values: `Draft`, `Review`, `Approved`, `Superseded`.
