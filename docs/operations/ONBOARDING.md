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

## In the portal (v0.2, decision 35)

1. Fifth Stone Dev creates the business with status `onboarding` and the owner's login. The
   owner can sign in, but sees only Setup and Templates & AI; nothing runs for the business.
2. The owner works through Setup and sends the texting application (step 7).
3. Fifth Stone Dev reviews it, submits it to Twilio (by hand until the Phase 4 adapter) and moves
   the texting status card (`submitted`, then `approved` or `rejected`). On `rejected`, tell the
   owner what to fix; they send it again from Setup.
4. Once texting is approved and the number is in place, Fifth Stone Dev sets the business to
   `active`. The Front Desk opens and calls and texts start flowing.

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
