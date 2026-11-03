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

## Before setup

- [ ] Signed scope of work and authorization to send email on the business's behalf
- [ ] Processor disclosure (AWS SES, Google, Cloudflare, Supabase, hosting) in the agreement
- [ ] Confirm no regulated data (PHI, card data) will be collected

## Setup steps

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
