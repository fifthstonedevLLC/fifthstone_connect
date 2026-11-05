---
title: 'Backlog — Out of MVP Scope'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-03'
---

# Backlog — Out of MVP Scope

Ideas parked until a validation gate (build plan §7) justifies them. Add a line, don't build.
Gate E rule: add a feature only when multiple customers request substantially the same thing.

| Idea                                                  | Source         | Gate / trigger to revisit                                            |
| ----------------------------------------------------- | -------------- | -------------------------------------------------------------------- |
| ~~Customer-facing dashboard / lead status UI~~        | Build plan     | Moved into scope in SCOPE.md v0.2 (owner portal)                     |
| Signed one-click "mark handled" link in staff emails  | Phase 0 review | Candidate answer to ADR "lead status update" — decide before Phase 3 |
| CRM / field-service connector (Jobber, Housecall Pro) | Build plan     | Gate E; choose at most one in Phase 6                                |
| ~~SMS notifications~~                                 | Build plan     | Moved into scope in SCOPE.md v0.2 (core loop)                        |
| n8n bridge for one-off integrations                   | Build plan     | Concrete integration that benefits                                   |
| ~~Self-service onboarding~~                           | Build plan     | Moved into scope in SCOPE.md v0.2 (portal onboarding)                |
| Billing / payments                                    | Build plan     | Not planned                                                          |
| ~~AI triage or reply drafting~~                       | Build plan     | Moved into scope in SCOPE.md v0.2, behind template guardrails        |
| Automatic rescheduling of existing customers          | SCOPE v0.2     | After pilots show how owners use the suggest-only version            |
| Multi-technician routing and per-tech calendars       | SCOPE v0.2     | Gate E                                                               |
| Outlook / Microsoft 365 calendar                      | SCOPE v0.2     | First tenant on Microsoft 365                                        |
| Texting from the tenant's existing number             | SCOPE v0.2     | Tenant demand after toll-free launch                                 |
| Product-seller playbook (quotes, availability)        | SCOPE v0.2     | A client to build it with                                            |
| Full clinical playbook (BAAs across vendors)          | SCOPE v0.2     | Clinic demand plus vendor BAA review                                 |
| Deposits and quoting for trades                       | SCOPE v0.2     | Gate E                                                               |
| Full mailbox connection (Gmail/Outlook read)          | SCOPE v0.2     | Not planned; forwarding covers intake                                |
| Twilio fallback webhook URL for VPS downtime          | ADR-0003       | Before scaling past pilots                                           |
