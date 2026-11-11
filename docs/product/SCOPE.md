---
title: 'Product Scope — Missed Call to Booked Job'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.2'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-03'
---

# Product Scope — Missed Call to Booked Job

Version 0.2 replaces the v0.1 Inquiry-to-Action scope (form → acknowledgment email → owner
alert → Google Sheet → reminder). That pipeline is not discarded: its intake, durable jobs,
idempotency and reminders become the backbone of this product.

> **Status:** planning draft approved for direction by the owner on 2026-11-03.
> Architecture changes are recorded in
> [ADR-0002](../adr/0002-scope-v0.2-architecture.md) (Proposed); open details are in
> [DECISIONS_PENDING.md](../adr/DECISIONS_PENDING.md). `CLAUDE.md`, `SYSTEM_OVERVIEW.md` and
> `THREAT_MODEL.md` reflect this version.

## Why the change

v0.1 automated the owner's admin (copying inquiries, sending "we got it" emails). That is
commodity work most tools already do, and owners don't feel enough pain to pay for it.
v0.2 targets lost revenue: calls that go unanswered, leads that go cold, and time slots
that never get offered.

## Who it is for

Businesses of 1–20 people where the person doing the work also answers the phone:
service trades, contractors and tattoo studios. Clinics and other healthcare practices are out
of scope (owner, 2026-11-11; decision 33).

## Offer promise (draft)

"When you can't pick up, the conversation keeps going." A missed call gets a text back, the
customer's details and urgency are gathered by text, open times are offered from the
owner's calendar, and the owner approves the booking with one reply.

Do not use "never miss a lead," "fully hands-off," or invented statistics (style guide).

## The core loop

Every business runs the same five steps. Business types differ only by their settings.

1. **Capture.** A missed call forwards to the tenant's Fifth Stone Connect number. Every
   missed call gets a text, voicemail or not. Texts to that number and forwarded emails
   enter the same way.
2. **Clarify.** If a voicemail exists, it is transcribed and summarized. The system asks only
   for missing details, one question per text, three questions maximum. Urgency is a
   numbered choice (1 emergency today, 2 this week, 3 flexible).
3. **Offer.** Open times are read from the connected calendar, filtered by business hours,
   job length and urgency. Two or three slots are offered. The customer's pick becomes a
   **request**, not a booking, and a tentative hold is placed on the calendar.
4. **Approve.** The approver gets one text: job summary, area, requested time, and numbered
   replies (approve / suggest another time / call them). The same request appears in the
   owner portal. If nobody responds within the tenant's window, the approver is reminded
   and the customer is told the time is being confirmed.
5. **Confirm.** On approval the hold becomes a calendar event (customer, address, job
   summary, link to the lead page) and the customer gets a confirmation by text, plus email
   when an address is known.

## Guardrails

- **AI understands; templates promise.** AI may transcribe, summarize, classify, decide what
  is missing, and draft clarifying questions. Times, confirmations, prices and anything
  binding come only from fixed, owner-approved templates.
- **Emergencies skip the queue.** An emergency answer alerts the approver immediately. For
  safety-related cases (for example gas smell, flooding), the customer first receives a fixed
  safety message. That message is not editable by the AI layer.
- **No automatic rescheduling.** The system may suggest moving a lower-priority job to fit
  an urgent one ("Thu 10am gutter job could move to Fri"). Only the owner moves existing
  customers.
- **Uncertain matches go to a person.** If the system cannot tell whether a contact is new or
  existing, or cannot classify a message, the lead goes to **Needs you** instead of a guess.

## Business types: workflows and trades

A business type is a **workflow** (how a booking works) and a **trade** inside it (owner,
2026-11-11; decision 34). The owner picks both in Setup. Picking loads the trade's starter
questions, AI instructions and job length, and the workflow's starter wording, as new versions the
owner can edit or restore. Every business runs the same five steps; nothing in the engine runs
differently per trade, and the fixed safety messages apply to all of them.

| Workflow           | What the customer books                                              | Approver         | Starter length                     | Trades                                                                                      |
| ------------------ | -------------------------------------------------------------------- | ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Service call       | A visit to fix something; asks how soon (today, this week, flexible) | Owner, by text   | 60 min                             | Heating and cooling, plumbing, electrical, garage doors, other repair or service            |
| Estimate visit     | A visit to look at the job and give a quote                          | Owner, by text   | 60 min                             | Roofing, remodeling, painting, landscaping and hardscape, other project work                |
| Recurring service  | A first visit; a person sets up the regular schedule after that      | Owner, by text   | 60 min (house cleaning 120)        | Lawn care, house cleaning, pool service, pest control, other regular service                |
| Studio appointment | A consult or session at the business                                 | Staff, in portal | 60 min (salon 45, pet grooming 90) | Tattoo studio, salon or barber, pet grooming, photography, other studio or appointment      |
| Shop drop-off      | A time to bring the item in; the work happens at the shop            | Owner, by text   | 30 min                             | Auto repair, small engine repair, phone and computer repair, bike repair, other shop repair |

The starter questions and wording live in `packages/conversation/src/playbooks.ts`; the database
holds the workflow and trade keys (`app.playbooks`, `app.trades`). Starter wording is a draft
until the owner approves it, like all customer-facing wording. Recurring service books the first
visit only: repeat visits are arranged by a person (rule 14, no automatic rescheduling). The
"other" trade in each workflow is for businesses the list does not name.

Not built, still in `BACKLOG.md`: waiver and deposit links for studios, estimate follow-up after
an estimate visit, and times per artist or technician.

**No healthcare.** Clinics, dental offices, therapists and other healthcare practices are not
onboarded (owner, 2026-11-11; decision 33): protected health information brings agreements with
every vendor in the chain and a launch burden this service does not take on. The earlier clinic
minimum-data playbook is retired (migration `retire_clinic_playbook`).

**Marketing claims:** only the tattoo studio trade has a delivered reference build (the
WayMaker Ink request portal). Other tiles describe the workflow, not past results. No client names on public pages without written
permission.

## Owner portal

Each tenant has its own login. Roles: **Owner** (everything below) and **Staff** (view,
reply and approve only).

### Today dashboard

Four lanes:

1. **Needs you:** approvals waiting, emergencies, leads the system was unsure about.
2. **Waiting on customer:** questions sent, no reply yet.
3. **Booked:** today and upcoming.
4. **Went quiet:** no reply within 24 hours, with one-tap nudge or close.

### Lead page (source of truth for each potential client)

Contact details, job category, urgency, two-line summary, voicemail audio and transcript,
full text and email thread, request and booking status, notes, and actions (approve,
suggest time, reply, close). Calls, texts and emails match to one contact by phone number
or email address. Repeat contacts keep one history.

### Settings the owner controls

| Owner can change                                   | Stays with Fifth Stone Dev                         |
| -------------------------------------------------- | -------------------------------------------------- |
| Text and email template wording                    | Required opt-out line, registered sender details   |
| AI instructions, through structured fields         | Locked safety layer and output format              |
| Job types, job lengths, urgency definitions, hours | API keys and vendor configuration                  |
| Alert recipients and approvers                     | Sending limits, deliverability monitoring          |
| Email sender name, reply-to                        | Domain verification, bounce and complaint handling |

- **AI instructions are structured fields, not a raw prompt:** what we do, what we don't do,
  what counts as an emergency, questions to ask before booking, tone. Fields compile into
  the prompt inside the locked safety layer.
- **"Try it" box:** paste or record a sample voicemail and see the reply before saving.
- **Version history** with one-click undo for templates and AI settings. Every change is an
  audit event.
- **Template guardrails:** required pieces cannot be deleted; live character and segment
  count; a warning when an edit changes a message's purpose, since registered texting use
  cases must match what is sent.

### Onboarding inside the portal

1. Pick business type: a workflow and a trade (loads starter questions, wording and job length).
2. Business details: legal name, EIN, address, website. Feeds texting registration.
3. Hours and calendar connection.
4. Review pre-filled questions and templates.
5. Approvers and staff logins.
6. **Test it:** call the new number, hang up, receive the text back.
7. **Apply for texting:** review what goes to the carriers (business details, how texts are
   used, how customers agree to them, sample messages from the owner's own templates), confirm
   it is accurate and send it.

**Locked until live** (owner, 2026-11-11; decision 35). A business signs in to a portal that
shows only Setup and Templates & AI until it is live. After the application is sent, the owner
sees a status page (setup finished, texting registration, going live); staff see only that
page. The Front Desk, lead pages and calendar stay locked on the server, and no calls, texts,
jobs or calendar syncs run for the business. Fifth Stone Dev submits the application (by hand
until the Phase 4 adapter), moves the texting status card, and turns the business on once
texting is approved.

## Channels and vendors

| Channel                        | Approach                                                                              | Notes                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calls and texts                | Twilio, ISV model: one subaccount per tenant, Fifth Stone Dev as the registered ISV   | Fifth Stone Dev's own business profile must be approved first. Launch on toll-free verification; local (10DLC) numbers later. Missed calls reach the number by conditional call forwarding from the tenant's existing line, so texts come from a different number than the one dialed. Tell the tenant up front. |
| Email out                      | Amazon SES                                                                            | Confirmations with calendar invite, owner alerts, weekly summary. Domain verification is done by Fifth Stone Dev during approval.                                                                                                                                                                                |
| Email in                       | Tenant forwards an inquiry address (info@, bookings@) to an SES inbound address       | No mailbox access. Full Gmail read access is a restricted scope that requires a paid security assessment.                                                                                                                                                                                                        |
| Website form                   | Existing v0.1 form intake                                                             | Feeds the same loop.                                                                                                                                                                                                                                                                                             |
| Calendar                       | Google Calendar and Outlook / Microsoft 365 (read, tentative hold, write), and Acuity | Google requires app verification for calendar scopes; Microsoft needs an app registration with publisher verification. Outlook added by the owner 2026-11-09 (decision 30). Acuity is already proven in the WayMaker Ink build.                                                                                  |
| Voicemail transcription and AI | Provider to be chosen (ADR-0002)                                                      | Data handling and retention terms reviewed before any real lead data is processed.                                                                                                                                                                                                                               |

The calendar is the source of truth for time. Fifth Stone Connect is the source of truth for
the lead. Neither copies the other.

## Build order (owner, 2026-11-03)

Build and prove the product on mocks and local Supabase Auth first; connect real vendors only
after the portal works and multi-tenant isolation is proven.

| Phase                      | Includes                                                                                                                                                                                                                                         | Exit                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **1. Foundation**          | Core types; connector interfaces with labeled mocks; migrations with row-level security; mock seed data; local Auth users for the mock tenants; tenant-isolation tests                                                                           | `db:reset` builds cleanly from empty; isolation tests pass                                  |
| **2. Portal on mock data** | Portal API routes and `apps/portal`: sign-in through local Supabase Auth, Today dashboard, lead page, versioned template and AI settings, onboarding screens (details captured, nothing submitted to vendors), owner and staff roles             | Every mock user signs in and sees only their own tenant; settings save, version and restore |
| **3. Engine on mocks**     | Conversation state machine, scheduling and holds, AI boundary against the mock language model and the evaluation set; operator CLI simulator that sends mock calls, texts and emails through the real intake path (refuses to run outside local) | Full loop end to end for T1 and T2 on mocks, visible in the portal; multi-tenant proven     |
| **4. Integrations**        | Twilio (ISV, toll-free), SES send and receive, Google Calendar, Acuity, transcription and language-model providers; staging environment                                                                                                          | Each adapter run against a real test resource with owner approval; staging matches local    |
| **5. Pilot**               | Production Supabase project, VPS deployment, monitoring and alerts, two pilot tenants                                                                                                                                                            | Pilots onboarded through the portal; test call → booked event without operator help         |

Fifth Stone Dev's Twilio ISV business profile is approved (owner, 2026-11-03). The one
approval with a real waiting period left is Google OAuth verification for calendar access. The
Google OAuth client and consent screen can be set up at any time in testing mode (listed test
users only); the verification submission needs a working connect flow to demonstrate, so it
goes in once the Calendar tab's connect screen works (Phase 2). Creating the staging and
production Supabase projects takes minutes and happens when each environment is needed.

## Release scope

| Release            | Includes                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MVP**            | Core loop; the five workflows and their trades (decision 34); Twilio toll-free texting; Google Calendar; portal with Today dashboard, lead page, template and AI settings, onboarding and test call; SES confirmations and alerts; operator tools |
| **Second release** | Estimate follow-up for estimate visits; Acuity; forwarded email intake; weekly owner summary email; local 10DLC numbers                                                                                                                           |
| **Later**          | See `BACKLOG.md`                                                                                                                                                                                                                                  |

## Exclusions

Automatic rescheduling of existing customers · routing across multiple technicians or
calendars per job · deposits and payments outside existing booking tools · quoting and
pricing · Jobber, Housecall Pro and other field-service
sync · full mailbox connection · texting from the tenant's existing number · clinics, dental,
therapy and other healthcare practices · clinical or other regulated data · marketing or promotional texts · visual workflow editor · 24/7
support · compliance certification.

## Acceptance criteria

| Capability           | Accepted when                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Missed-call capture  | Every forwarded missed call creates one lead and one text-back, with or without voicemail |
| Deduplication        | The same call, text or email never creates duplicate leads or duplicate texts             |
| Clarifying questions | Only missing details are asked; three questions maximum; numbered urgency choice          |
| Template boundary    | No AI-generated text states a time, price or commitment; covered by tests                 |
| Emergency path       | Emergency answer alerts the approver immediately; safety message sent where configured    |
| Slot offer           | Offered slots fall inside hours, respect job length, and avoid existing events and holds  |
| Holds                | A held slot cannot be offered to a second customer; hold released on decline or timeout   |
| Approval             | Text reply and portal action both work; no reply within window triggers a reminder        |
| Confirmation         | Approved request creates the calendar event and sends the confirmation once               |
| Owner settings       | Edits are versioned, audited and reversible; required template pieces cannot be removed   |
| Tenant isolation     | No portal user can read or change another tenant's data; covered by tests                 |
| Opt-out              | STOP is honored immediately and recorded; no further texts to that number                 |
| Error handling       | A vendor outage never silently loses a call, text or email                                |
| Visibility           | A sample lead is traceable end to end by correlation ID                                   |
| Privacy              | A customer-approved deletion request can be honored                                       |

**Definition of done (MVP):** two pilot businesses onboarded through the portal, each
receiving a test call → text → request → approval → calendar event without operator help.

## Open decisions

1. Which two pilot businesses.
2. Voicemail transcription and AI provider, and its data retention terms.
3. Approval reminder window and slot hold timeout defaults.
4. Whether the v0.1 Google Sheets destination stays as an optional export.
5. Pricing for the new offer: working assumptions below; validate with pilots before publishing.

## Pricing assumptions (unvalidated)

Working numbers for v0.2, set 2026-11-03. Not tested with customers. **Validate before
publishing.** The v0.1 anchor ($1,500 setup + $149/month) was set for the form-to-sheet offer
and no longer applies. No vendor prices in customer-facing material.

| Plan        | Price                     | Includes                                                                                                                                                                                    |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup       | ~$1,000 once ($750–1,500) | Texting registration (with resubmissions), calendar connection, playbook setup, template approval, test call, training. Carrier registration fees: pass through or include, stated up front |
| Standard    | ~$199                     | One number, one calendar, owner portal, one playbook, a monthly segment allowance (1,500–2,000), about 30 minutes of template or rule changes                                               |
| Busy        | ~$349                     | Larger segment allowance, staff logins, multiple approvers, emergency alerts to more than one person                                                                                        |
| High volume | Base + overage            | Per-segment overage above the allowance; MMS priced separately                                                                                                                              |

- **Term:** month-to-month; the setup fee covers upfront work. No long contracts.
- **Pilots (two, per the definition of done):** setup waived or at cost and about $99/month
  for three months, in exchange for detailed feedback. Ask in writing before naming a pilot.
- **Market position:** done-for-you service with owner approval and calendar holds, between
  self-serve text-back tools and all-in-one messaging platforms. Check competitors' current
  published prices before committing.

**Cost floor (internal, rough; verify in the Twilio and AWS consoles):** a typical tenant at
about 2,000 segments a month costs roughly $40–65 in hard costs (texting with carrier fees
$20–30, number and campaign fees $10–15, transcription and model calls $5–10, hosting share
$5–10), plus about an hour a month of operator time. Carrier fees change, so contracts should
allow pass-through adjustments.

**Cost controls that keep plans profitable:** a server-enforced segment limit per template
(and GSM-7-safe characters, since one emoji or curly quote shrinks segments to 70
characters), per-tenant daily and monthly send caps with operator alerts, line-type lookup
before text-back so landlines are skipped, a per-conversation loop limit against auto-replies,
email as the primary confirmation when an address is known, and usage alerts per Twilio
subaccount.
