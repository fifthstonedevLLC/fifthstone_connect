---
title: 'Threat Model'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.2'
owner: 'Engineering'
last_updated: '2026-11-03'
---

# Threat Model

Threat model for SCOPE.md v0.2 (missed call to booked job, owner portal). A1–A11 carry over
from v0.1; A12–A24 cover voice, SMS, AI, calendar and the portal. Reviewed again at end of
Phase 4 with an abuse test against public intake and the Twilio webhooks. **Owner sign-off:
pending.**

## Assets

| Asset                                                        | Sensitivity                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Inquirer contact data (name, email, phone, address, message) | PII — minimize, redact from logs                                                  |
| Tenant configuration and recipient lists                     | Confidential; cross-tenant leak is a serious incident                             |
| Business details: legal name, EIN, address, contact          | Confidential; owner-only writes, kept out of logs and audit details; SSNs refused |
| SES credentials / sender identities                          | High — abuse damages deliverability for every tenant                              |
| Google service-account key                                   | High — grants access to every shared Sheet                                        |
| Webhook signing secrets, Turnstile secret                    | High                                                                              |
| Database credentials and backups                             | High                                                                              |
| Voicemail audio, transcripts, text and email threads         | PII — may contain addresses, household details; minimize, short audio retention   |
| Twilio parent-account credentials and subaccount tokens      | High — abuse sends traffic billed to Fifth Stone Dev and can suspend every tenant |
| Calendar OAuth tokens and Acuity credentials                 | High — read/write access to tenants' schedules                                    |
| AI and transcription provider keys; data sent to them        | High; provider terms reviewed before real data                                    |
| Portal sessions and user accounts                            | High — owner role controls templates and approvals                                |
| Tenant templates, AI settings, opt-out list                  | Confidential; opt-out list is a compliance record                                 |

## Entry points

1. Public form endpoint (unauthenticated, internet-facing).
2. Signed webhook endpoint (server-to-server).
3. SES/SNS event endpoint (Phase 4).
4. Operator CLI (requires DB credentials; run by owner only).
5. Deployment platform and Supabase dashboard (human admin access).
6. Twilio voice and SMS webhooks (server-to-server, internet-facing).
7. SES inbound email endpoint (forwarded inquiries).
8. Owner portal and its authenticated API routes (internet-facing, logged-in users).
9. Calendar OAuth callback.
10. AI and transcription providers (outbound; inbound content passes through them).

## Abuse cases and mitigations

| #   | Abuse case                                                                            | Mitigation                                                                                                                                                             | Phase |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| A1  | Bots spam the form                                                                    | Turnstile verified server-side, honeypot, per-IP and per-tenant rate limits                                                                                            | 2     |
| A2  | Attacker uses acknowledgment email to spam third parties (form with victim's address) | Turnstile + rate limits; ack content is fixed template, no free text echoed back; per-tenant daily send cap                                                            | 2–3   |
| A3  | Forged or replayed webhook                                                            | HMAC with constant-time compare, timestamp window, event-ID uniqueness                                                                                                 | 2     |
| A4  | Tenant enumeration / cross-tenant writes                                              | Opaque public form IDs; tenantId required in every repo call; composite FKs; isolation tests                                                                           | 1–2   |
| A5  | Oversized or malformed payloads                                                       | Body-size caps, Zod schemas, strict content types                                                                                                                      | 2     |
| A6  | Header/HTML injection into emails                                                     | Escape all user fields; no user input in headers except validated reply-to                                                                                             | 3     |
| A7  | Formula injection into Sheets (`=`, `+`, `-`, `@` prefixes)                           | Prefix-escape cell values; write with `RAW` input option                                                                                                               | 3     |
| A8  | PII or secrets in logs                                                                | Logger redaction paths; `no-console` lint rule; redaction tests                                                                                                        | 0 / 4 |
| A9  | Credential leak from repo                                                             | `.gitignore`, hygiene tests, secrets only in deployment store                                                                                                          | 0     |
| A10 | Lost events during vendor outage                                                      | Persist-before-call, durable jobs, dead-letter alerts                                                                                                                  | 2–3   |
| A11 | Admin account takeover                                                                | MFA on Supabase, AWS, Google, Cloudflare, hosting; audit events                                                                                                        | 4     |
| A12 | Forged or replayed Twilio webhook                                                     | Validate `X-Twilio-Signature` on every request; unique CallSid/MessageSid; reject unknown numbers                                                                      | 2     |
| A13 | SMS pumping / toll fraud (bots trigger texts to premium or foreign numbers)           | Texts only to numbers that called or texted first; US/Canada geo permissions only; per-number and per-tenant rate limits and daily caps                                | 2–3   |
| A14 | Prompt injection through voicemail, text or email content                             | Content passed as data, never instructions; output must match Zod schema; AI cannot trigger actions or produce times, prices or commitments                            | 3     |
| A15 | Owner edit removes required template pieces or changes the registered use case        | Server-side validation on save and at send; locked fields; purpose-change warning; versioned with audit events                                                         | 3     |
| A16 | Calendar token theft or over-broad scope                                              | Calendar scopes only; tokens encrypted at rest; revocation and reconnect path; never sent to the browser                                                               | 3     |
| A17 | Portal cross-tenant access                                                            | Tenant resolved server-side from session; tenant-scoped repositories; isolation tests on every portal route                                                            | 2–3   |
| A18 | Portal account takeover                                                               | Supabase Auth; MFA offered to owners; session expiry; audit events on settings and approvals                                                                           | 3–4   |
| A19 | Texting after opt-out                                                                 | Opt-out recorded on receipt and checked before every outbound text; covered by tests                                                                                   | 2–3   |
| A20 | Clinical data reaches the AI layer or is requested                                    | Healthcare practices are not onboarded (decision 33); no playbook asks for clinical detail                                                                             | 3     |
| A21 | Double booking through concurrent picks                                               | Tentative hold placed in one transaction before confirmation; slot excluded while held                                                                                 | 3     |
| A22 | Spoofed forwarded email                                                               | Accept only from verified tenant forwarding addresses; SES spam/virus verdicts honored                                                                                 | 4     |
| A23 | Voicemail audio or transcripts in logs                                                | Logger redaction; store recording references, not audio, in logs                                                                                                       | 2–4   |
| A24 | Runaway per-lead cost (looping conversation, repeated model calls)                    | Three-question cap; per-lead and per-tenant AI call caps; dead-letter on loops                                                                                         | 3     |
| A25 | Mock data or test scripts reach production                                            | Seed files local only, never `db push --include-seed`; `mock-` slugs and reserved number and email ranges; operator environment check; hygiene test bans stray scripts | 1     |
| A26 | Unreviewed schema change in a hosted project                                          | Changes only via ledgered migrations and `supabase db push`; no SQL editor changes; emergency fixes become migrations the same day                                     | 1     |
| A27 | Service-role key leaks from an app container                                          | Key used only by the operator CLI on the owner machine; never in API, worker, portal or browser environments                                                           | 1     |

## Out of scope for MVP

Regulated data (PHI, cardholder data) and healthcare practices (decision 33, A20);
compliance certification; texting from tenants' existing numbers.
