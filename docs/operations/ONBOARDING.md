---
title: 'Tenant Onboarding'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-02'
---

# Tenant Onboarding

Procedure for setting up a new pilot business. Draft; finalized during Phase 4–5.

> Describes v0.1 operator-run onboarding. v0.2 moves tenant onboarding into the owner portal
> (SCOPE.md v0.2), with Fifth Stone Dev approving texting registration, email domain setup and
> calendar connection. Rewrite this procedure when the portal onboarding is built.

## Before setup

- [ ] Signed scope of work and authorization to send email on the business's behalf
- [ ] Processor disclosure (AWS SES, Google, Cloudflare, Supabase, hosting) in the agreement
- [ ] Confirm no regulated data (PHI, card data) will be collected; clinics and other healthcare practices are not onboarded (decision 33)

## In the portal (v0.2, decisions 35 and 36)

Fifth Stone Dev's side runs through the operator CLI (`npm run operator -- <command>`; `list` and
`show <slug>` show where every business stands). `OPERATOR_CONFIRM_ENV` in `.env` names the
database it points at: on development only mock businesses are allowed, and staging or
production changes need `--confirm <environment>`.

1. **Create:** `create --slug <s> --name <n> --owner-name <n> --owner-email <e> [--workflow <w>]`.
   The business starts `onboarding`. The command prints a one-time set-password link; send it to
   the owner yourself (no email is sent). Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. The owner works through Setup. The last step is a choice: send the texting application, or go
   without texting for now.
3. **Number:** buy the Fifth Stone Connect number (cost: owner approval), then
   `number <slug> <+1...>`. The owner forwards unanswered calls to it.
4. **Texting**, only if they applied: submit the application to Twilio (by hand until the Phase 4
   adapter), then `texting <slug> submitted`, later `approved` or `rejected --note "<what to fix>"`.
   On `rejected`, tell the owner what to fix; they send it again from Setup.
5. **Go live:** `go-live <slug>`. It needs finished setup and a number, never texting approval.
   Until texting is approved, missed calls reach the Front Desk to call back and no text is sent.
6. **Staff:** `add-person <slug> --name <n> --email <e> [--mobile <+1...>]` adds a staff member
   and prints their set-password link; the owner decides what staff can do in Settings. A link
   that has expired: `password-link <email>`. Links land on `PORTAL_URL` (local default
   `http://127.0.0.1:5173`), which Supabase Auth must list as a redirect URL.
7. **Offboard:** `disable <slug>`, then release the number in Twilio.

## Setup steps (v0.1)

1. Create tenant (operator CLI, Phase 4): name, time zone, business hours, alert recipients.
2. Email: verify the business's sending domain in SES (DKIM records added by the customer or
   with their DNS access), configure reply-to. _(Pending decision #6.)_
3. Google Sheet: customer creates or picks a Sheet and shares it with the service-account email
   as Editor; record Sheet ID and tab; confirm header row matches column mapping.
4. Intake: issue opaque public form ID; embed form or configure signed webhook source.
5. Customer approves acknowledgment and alert email wording.
6. Acceptance test with test data: submit → ack → alert → Sheet row → reminder.
7. Training: how leads arrive, how to mark one handled, who to contact.

Record setup hours per tenant (Gate C metric).
