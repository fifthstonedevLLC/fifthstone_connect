---
title: 'Threat Model'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Engineering'
last_updated: '2026-11-02'
---

# Threat Model

Initial threat model for the Inquiry-to-Action MVP. Reviewed again at end of Phase 4 with an
abuse test against public intake. **Owner sign-off: pending.**

## Assets

| Asset                                                        | Sensitivity                                           |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Inquirer contact data (name, email, phone, address, message) | PII — minimize, redact from logs                      |
| Tenant configuration and recipient lists                     | Confidential; cross-tenant leak is a serious incident |
| SES credentials / sender identities                          | High — abuse damages deliverability for every tenant  |
| Google service-account key                                   | High — grants access to every shared Sheet            |
| Webhook signing secrets, Turnstile secret                    | High                                                  |
| Database credentials and backups                             | High                                                  |

## Entry points

1. Public form endpoint (unauthenticated, internet-facing).
2. Signed webhook endpoint (server-to-server).
3. SES/SNS event endpoint (Phase 4).
4. Operator CLI (requires DB credentials; run by owner only).
5. Deployment platform and Supabase dashboard (human admin access).

## Abuse cases and mitigations

| #   | Abuse case                                                                            | Mitigation                                                                                                  | Phase |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----- |
| A1  | Bots spam the form                                                                    | Turnstile verified server-side, honeypot, per-IP and per-tenant rate limits                                 | 2     |
| A2  | Attacker uses acknowledgment email to spam third parties (form with victim's address) | Turnstile + rate limits; ack content is fixed template, no free text echoed back; per-tenant daily send cap | 2–3   |
| A3  | Forged or replayed webhook                                                            | HMAC with constant-time compare, timestamp window, event-ID uniqueness                                      | 2     |
| A4  | Tenant enumeration / cross-tenant writes                                              | Opaque public form IDs; tenantId required in every repo call; composite FKs; isolation tests                | 1–2   |
| A5  | Oversized or malformed payloads                                                       | Body-size caps, Zod schemas, strict content types                                                           | 2     |
| A6  | Header/HTML injection into emails                                                     | Escape all user fields; no user input in headers except validated reply-to                                  | 3     |
| A7  | Formula injection into Sheets (`=`, `+`, `-`, `@` prefixes)                           | Prefix-escape cell values; write with `RAW` input option                                                    | 3     |
| A8  | PII or secrets in logs                                                                | Logger redaction paths; `no-console` lint rule; redaction tests                                             | 0 / 4 |
| A9  | Credential leak from repo                                                             | `.gitignore`, hygiene tests, secrets only in deployment store                                               | 0     |
| A10 | Lost events during vendor outage                                                      | Persist-before-call, durable jobs, dead-letter alerts                                                       | 2–3   |
| A11 | Admin account takeover                                                                | MFA on Supabase, AWS, Google, Cloudflare, hosting; audit events                                             | 4     |

## Out of scope for MVP

Regulated data (PHI, cardholder data), customer-facing authentication, compliance certification.
