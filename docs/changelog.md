---
title: 'Changelog'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Engineering'
last_updated: '2026-11-02'
---

# Changelog

Newest first. Each entry: date, change, rationale, test evidence.

## 2026-11-09 — Calendar: the week as the business works it (on mocks)

**Change** (owner: a calendar of events that syncs with Google, Outlook and other popular
calendars, read and write; build the concept before the connections):

- **Outlook is in scope** (decision 30). Google Calendar, Outlook / Microsoft 365 and Acuity,
  read and write. SCOPE.md, CLAUDE.md rule 9 and BACKLOG.md are updated; Apple iCloud and other
  calendars are a backlog line until Google and Outlook work. Real connections stay in Phase 4.
- **`packages/scheduling`** (new, no dependencies):
  - `openWindows` turns weekly business hours into open time, day by day, in the business's time
    zone, through daylight-saving changes;
  - `subtractBusy` takes busy time out; `openSlots` cuts whole jobs on the hour grid, never in the
    past; `dayCapacity` says how full each day is.
  - Business hours decide what can ever be offered; the connected calendar can only close time.
- **Migration `20261109181751_calendar_sync`:** `microsoft` as a calendar provider,
  `calendar_connections.last_synced_at`, and `app.calendar_busy`, the busy times the worker's sync
  will store. Only start and end are kept, never titles, attendees or descriptions of the owner's
  events. RLS and grants like every tenant table; pgTAP `calendar_sync.test.sql`.
- **`GET /portal/calendar?from=&days=`:** a week from Monday by default. Hours, held and booked
  appointments, synced busy time, open slots (from now) and day capacity. It reads only the
  database; no calendar provider is called (rule 1).
- **The Calendar page** (`/calendar`, in the sidebar):
  - **Week strip:** each day's date, a meter of how full it is, and the free time left. Today
    wears the bronze edge.
  - **Week grid:** open hours are lit and the rest of the day stays dark. Booked jobs are solid
    with a Sage edge; times a customer picked but nobody has approved are pencilled in with a
    dashed Bronze outline; the owner's own events are hatched "Busy" blocks; what is left shows
    as open stretches ("Open 9 AM–2 PM, 5 times to offer"). A Bronze line marks now, and the part
    of today that has gone by is dimmed. Times are set in Space Mono, the brand's label face.
  - **Rail:** Next up (with a countdown, Call and Open contact), Pencilled in (each hold with when
    it is released, linking to the Approve queue), the week's totals, and a key.
  - **Phones:** the strip becomes seven day buttons and the chosen day is an agenda list.
  - **Choosing a job** (owner request) outlines it and shows its details at the top of the rail:
    when, what, the address, and **Navigate**, Call and Open contact. Navigate opens driving
    directions in the phone's maps app: Apple Maps on an iPhone or Mac (with a "Use Google Maps"
    link beside it), Google Maps everywhere else. It uses the maps apps' public links, so nothing
    is set up and only the address is sent, when the person taps. Jobs without an address (studio
    and clinic visits) show no Navigate. Next up has the same buttons. On a phone the job opens in
    place in the day list. Escape or choosing the job again closes it.
  - The sync line names the calendar, says it is two-way and when it last synced, and is labelled
    "Sample sync" (rule 5). Nothing on the page moves a job (rule 14).
- **Mock data:** Prairie Path now uses Outlook. Riverbend, Northline and Prairie Path have busy
  times on their calendars, seeded after requests and skipping any that overlap an appointment,
  as the real sync must skip events and holds this service wrote itself (a Phase 4 rule).
- **Fonts:** Space Mono (owner-supplied brand font) is now loaded with Archivo from Google Fonts.
  No new npm dependencies; `@fsc/scheduling` is a workspace package.

**Test evidence:** `npm run check`: 259 passed (1 skipped locally without the anon key);
`npm run db:test`: 114 passed across 9 files; portal build 569 kB. New tests: scheduling (12),
calendar display rules and directions links (10), API calendar routes (5) and pgTAP `calendar_sync` (9). In the in-app
browser as Carla: the week of 9–15 November with Tom H. booked Monday, Ana G. Tuesday and Marcus
T. pencilled in Wednesday; next and previous week; at 375 px the agenda for Wednesday, with no
sideways scroll. Mock data only; the sync is simulated.

## 2026-11-09 — Portal: the Leads board is now the Front Desk

**Change** (owner: "Leads" reads like sales opportunities, not service requests; the name should
be relevant and not "Dashboard"):

- The main page and its sidebar item are named **Front Desk**: where calls, texts and emails land
  and get worked. It fits every playbook (HVAC, contractors, tattoo, clinics).
- `LeadsPage.tsx` is renamed `FrontDeskPage.tsx` (component `FrontDeskPage`), so it no longer
  sits next to `LeadPage.tsx` (one lead) with a one-letter difference. `App.tsx` imports it.
- The lead page's back link reads "Back to Front Desk"; Setup says requests wait "in the Approve
  queue on the Front Desk".
- On screen, "lead" is now **contact** everywhere (owner: "lead" sounds like sales). The close
  button reads "Close out" ("Close contact" reads like proximity), and the one-nudge message says
  "Only one is sent per request".
- **Tiles sort by priority** (owner): Act now stays first, then every queue holding a red
  (urgent) contact, then amber, then quiet queues, each group in its usual order. Tiles reorder
  as priorities change. As Carla at 1400 px: Act now, Call back, Review and Follow up on the first
  row; Approve, Reply and Listen next.
- The route stays `/`, and code, API routes and database names keep "lead" as the domain noun.
- **Contacts and Reporting** are in the sidebar as "Soon" (owner, 2026-11-09), like Calendar and
  Settings. Both are in `docs/product/BACKLOG.md` with what they should hold and what to settle
  first (call-recording consent, clinic minimum data, which measures to report).

**Test evidence:** typecheck, format and tests pass (232 passed, 1 skipped locally without the anon
key); portal build 548 kB. In the in-app browser as Carla: the sidebar and title read Front Desk,
and a lead page links "Back to Front Desk". Mock data only.

## 2026-11-08 — Portal: Leads as work queues, with the lead open beside the list

**Change** (owner feedback, in two rounds: the dashboard should not read as "today only", should
say exactly what each lead needs, and should work like a queue-based workflow tool with counts;
then: drop informal copy such as "Your move" and merge redundant queues):

- **"Today" is now "Leads", a queue board.**
  - One tile per queue, each with a count.
  - **Act now** comes first and opens by default: every red lead (someone may be at risk, or it
    has waited over a day), whatever its task. If it is empty, the first queue with work opens.
  - **Task queues:** Approve, Reply, Call back (urgent calls included, at the top), Reschedule or
    cancel, Listen, Review, Follow up; then Waiting on customer and Booked, set apart. Every lead
    is in exactly one task queue.
  - An earlier draft had a "Needs you" roll-up and a separate "Call now" queue beside the red
    level, which said the same thing three ways; both were folded into Act now. The "Your move /
    Not your move" headings are gone (the groups keep plain screen-reader labels, "Needs action"
    and "No action needed").
  - Empty queues stay in place but dimmed, so the board doesn't jump around. On a phone they are
    hidden.
  - The disabled "Leads (Soon)" item is gone.
- **List and lead side by side.** Choosing a queue lists its leads in working order. Choosing a
  lead opens all of it beside the list without leaving the page: progress, the decision and every
  action, template replies, the conversation and details.
  - The pane shows "1 of 4 in Act now", with Previous, Next and Full page.
  - The lead page is now `LeadWorkspace`, shared by the full page and the pane.
- **Working order** (`orderForQueue`):
  - **Queues that need action:** most urgent first, then longest waiting.
  - **Waiting on customer:** the most recent first.
  - **Booked:** the soonest appointment first.
- **Rows** show each lead's need with an icon, how long it has waited, and a one-line summary.
  Emergency and crisis leads carry the bronze top edge.
- **The lead's next step leads its decision box,** matched to what it needs: "Call Ava T. to
  reschedule", "Reply" (to the reply templates), "Listen to the voicemail". Approve and Nudge
  remain the leading actions where they apply. A lead that needs a person also says what to do
  (`guidanceFor`), for example "Bookings are never moved automatically" (CLAUDE.md rule 14).
- **Working faster:**
  - **Keyboard:** ↑ ↓ (or j/k) move through the list, and Home/End jump to either end.
  - **Counts:** they update after every action.
  - **Auto-advance:** when a lead leaves the queue (approved, nudged, closed), the next one opens
    with a short message: "Dee H. is closed. Next: Ben C."
  - **Refresh:** the list refreshes quietly every 30 s while visible, and when the tab comes back
    into view. A lead the worker books moves to Booked by itself.
  - **Deep links:** the queue and lead are in the address (`?queue=approve&lead=…`), so links
    and Back work.
- **Shared, tested rules** (`packages/conversation`):
  - `nextStep`: each lead's need and its one fitting action.
  - `QUEUES`, `inQueue` (Act now asks `priorityOf`; the rest match needs), `queueFor`,
    `isOwnerQueue` and `orderForQueue`. `OWNER_NEEDS` in `next-step.ts` lists the needs that are
    the business's to act on.
  - The API returns `next` on every list card and on the lead page, with `waitingSince` and
    whether a nudge is queued. The portal never guesses (decision 24).
- **Phones:**
  - The sidebar folds behind a Menu button.
  - Queues show two to a row.
  - Choosing a queue brings its list into view.
  - Tapping a lead opens its full page.
- **Priority colours** (owner request: red, yellow, green outlines that get the owner's
  attention). `priorityOf` in `packages/conversation/src/priority.ts` decides each lead's level
  from its need, whether someone may be at risk, and how long it has waited:
  - **Act now (red):** someone may be at risk, or a lead needing action has waited over a day.
    The row is fully outlined in red, and a task tile shows "2 urgent". Inside the Act now queue
    the rows drop the repeated chip.
  - **Soon (amber):** any other lead that needs a response. The row has an amber edge.
  - **On track (green, the brand Sage):** waiting on the customer, confirming or booked.
  - Tiles take the colour of their most urgent lead, and the side pane shows the level and why
    ("Act now · Someone may be at risk", "Soon · Needs a response", "On track · No action
    needed").
  - A legend explains the three levels, and every level is shown with its words, never colour
    alone. Screen readers hear "Call back, 4 leads, 2 urgent".
  - A lead turns red on its own once it has waited too long; the list refreshes every 30 s.
  - Selection is now a light ring, so it can't be confused with a priority colour.
  - The colours are recorded in the style guide as functional only.
- **Brand fixes:**
  - The template "Edited" tag and the Setup field notes used bronze text, which the brand guide
    reserves for fills and decoration. They are now white with a bronze dot.
  - The unused lane and card styles are removed, as are the five-step strip and the summary
    sentence under the title (owner: cleaner without them; both are in git history).
- Setup now says requests wait "in the Approve queue".

**Test evidence:** `npm run check`: 232 passed (1 skipped locally without the anon key). New tests:

- `nextStep` (7), the queue rules (7): every need in exactly one task queue, Act now holds only
  red leads, urgent calls file under Call back, links, and the three working orders; and the
  priority rule (4).
- Portal wording: waiting labels, the nudged line, guidance, single periods after initials.

API suite with the anon key, 44 of 44. The list test checks the next step for Marcus (approve),
Dana (call now), Ivy (reply), Sam (nudge) and Priya (their move). The lead test checks Marcus's
next step.

In the in-app browser as Rhett:

- **Approve queue:** approved Marcus from the pane. Approve went to 0 and Booked to 3, with
  "Marcus T. moved to Booked. Approve is clear."
- **Needs you** (before the merge): ↓ ↓ moved the list and pane to "3 of 9".
- **After the merge, as Carla:** Act now opened first with Dana, Greg, Rosa and Sam; Call back
  showed "2 urgent"; no "Your move" or "Their move" text anywhere on the page.
- **Follow up:** Nudge moved Sam to Waiting on customer.
- **Call back:** closing Dee opened Ben.
- **At 375 px:** no sideways scroll, empty queues hidden, and tapping a lead opens its page.

The smooth scroll to the list on phones could not be watched in the test pane; the instant
scroll works. The local database was reset afterwards. The portal bundle is 547 kB. Mock data
only.

## 2026-11-06 — Phase 3 (part 1): the worker runs jobs on mocks

**Change**

- **`apps/worker`:** claims due jobs, runs each one, and settles it.
  - Each handler reads its facts in a short transaction, calls the connector outside any
    transaction, and returns its result.
  - The worker then writes the handler's results, the job's new status and an attempt record in
    one transaction. A lead is never marked booked by a job that isn't marked done, and the
    reverse can't happen either.
  - A handler that throws counts as a transient failure, so the job retries instead of vanishing.
  - `npm run dev -w @fsc/worker` polls continuously. `npm run once -w @fsc/worker` runs every due job
    and exits.
  - Every connector is a labeled mock (CLAUDE.md rule 5), and the worker logs a warning saying so
    at startup.
- **`packages/workflow`:** `settleJob` decides how a run ends.
  - **Success:** the job is done, and the provider's reference is kept.
  - **Skipped:** the job is closed with its reason, not as a failure.
  - **Transient failure:** retried with capped exponential backoff (30 s doubling to 1 h, with
    ±20% jitter), or the provider's own wait if that's longer.
  - **Permanent failure, or the last attempt:** the job is dead-lettered.
- **Handlers:**
  - **`confirm_calendar_event`** (queued by Approve):
    - The hold becomes a calendar event and the lead becomes booked, with a `lead.booked` audit
      event.
    - The confirmation text is queued from the owner's `confirmation` template, filled by the new
      `renderTemplate` and `formatSlot`.
    - The text is not queued when texting isn't live, the customer opted out, or the template
      can't be filled; the booking stands either way.
    - If the event can't be made, the lead goes back to Needs you as `booking_failed`.
  - **`send_text`:**
    - Opt-out is checked again right before sending (rule 12), and nothing is sent while texting
      isn't approved.
    - A sent message records the provider reference and becomes "Sent".
    - An opted-out or dead message becomes "Not delivered".
  - **`release_hold`:** releasing a hold that is already gone is not an error.
- **Mock calendar:** `restoreHold` mirrors a hold the database records, because the mock keeps
  calendars in memory only. Real calendars never need this.
- **Migration `20261106011219_claim_jobs_by_type.sql`:**
  - `app.claim_jobs(limit, lease, action_types, tenant)` claims only job types with handlers, so
    seeded jobs of other types stay queued instead of being dead-lettered.
  - The optional tenant scopes a claim to one business (operator replay, tests).
- **CI:** the stack job now runs the worker tests too.
- **New dependency:** `pino` in `apps/worker`, for structured logs. It's the logger Fastify already
  uses in `apps/api`, so the version in the tree doesn't change.

**Test evidence:** `npm run check`: 228 passed, 1 skipped locally without the anon key.

- **`packages/workflow`** (7 tests): backoff, jitter, provider wait, dead-lettering and error codes.
- **Template rendering and slot formatting:** 3 tests.
- **Mock calendar:** `restoreHold`.
- **Worker on the local stack** (6 tests, test-only business, claims scoped to it):
  - every handled job runs, and an unhandled type stays queued;
  - an approved lead is booked, with its hold converted, an audit event and the confirmation
    queued;
  - a hold is released;
  - a reply is sent, and an opted-out customer is never texted;
  - an unbookable lead goes back to a person, with every attempt recorded;
  - the confirmation goes out on the next pass, and then nothing is left;
  - a transient failure retries later and then succeeds on attempt 2.
- **API and worker suites with the anon key:** 50 of 50.
- **`db:test`:** 110 of 110, including the new `claim_jobs_by_type.test.sql`:
  - claims filter by type and by business;
  - an empty list of types is refused;
  - an unhandled type is left untouched;
  - anon can't claim.

End to end in the in-app browser as Rhett, all on mocks:

1. Approved Marcus; the lead page showed "Confirming".
2. Ran `npm run once -w @fsc/worker`.
3. Marcus read "Booked", and the confirmation text from Riverbend's template showed as "Sent".

The local database was reset afterwards. Mock connectors only; nothing was sent.

## 2026-11-05 — Phase 2: onboarding screens with a simulated test call

**Change**

- **New Setup page** (`/setup`, `apps/portal/src/SetupPage.tsx`). Six steps from SCOPE.md v0.2,
  each saved on its own, with a check beside each finished step. The page opens on the first
  unfinished one.
  1. **Business type:** shows the playbook and how requests are approved, plus the minimum-data
     note for clinics, and asks the owner to confirm it. Changing it goes through Fifth Stone Dev
     (decision 28; confirmed by the owner 2026-11-05: businesses confirm and cannot change it).
  2. **Business details for texting registration:**
     - legal name, EIN (optional), address, website (optional) and a contact;
     - normalized by `BusinessProfileSchema` in `@fsc/core`, with plain notes under any field that
       needs a fix;
     - a value written like a Social Security number is refused, with its own message.
  3. **Hours and calendar:** day toggles and open/close times, in blocks. A lunch break is allowed;
     overlapping blocks are not. The calendar connection shows its status only, because connecting
     from the portal comes in Phase 4.
  4. **Templates and questions:** the live template version and the AI questions, a link to
     Templates & AI, and "I've reviewed them".
  5. **Who approves requests:** choose approvers from the team. A note appears when a text approver
     has no mobile number. New logins still go through Fifth Stone Dev.
  6. **Test it:** a labeled simulation (decision 29). It plays a missed call through the tenant's
     own live templates (`simulateTestCall` in `@fsc/conversation`), shows the approval by text or
     in the portal, and ends with the confirmation. Nothing is called, texted or created.

  Staff see Setup read-only. "Setup" is added to the sidebar.

- **Migration `20261105225952_onboarding.sql`:**
  - `app.business_profiles`, with database checks on every shape. An EIN must look like an EIN, so a
    Social Security number can't be stored.
  - `app.onboarding_progress`, for the acknowledged steps.
  - `portal_users.approves_requests`.
  - Row-level security and grants, as for every tenant table.
- **API:**
  - `GET /portal/onboarding`.
  - `POST /portal/onboarding/business-type` and `PUT /portal/onboarding/details`.
  - `PUT /portal/onboarding/hours` and `POST /portal/onboarding/templates-reviewed`.
  - `PUT /portal/onboarding/approvers` and `POST /portal/onboarding/test-call`.
  - Writes are owner-only and each returns the setup as it now stands. Field problems come back as
    422 with a message per field.
  - Every write is audited. Audit details name the changed fields but never their values, so no EIN
    is stored there. Logs redact `ein`, `contactPhone` and `contactEmail`.
- **Shared rules:**
  - `onboardingSteps` decides when each step is done, from data only. Hours count as done only with
    a connected calendar.
  - `BusinessHoursListSchema`.
  - US states in a Zod-free `@fsc/core/regions`.
  - `sampleText` now takes playbook-specific sample values, so a tattoo shop's example doesn't
    mention a furnace.
- **Seed (`13_onboarding.sql`):**
  - Riverbend is done except the test call.
  - Northline is partway.
  - Prairie Path is done.
  - Mock EINs start with `00-`, a prefix the IRS never assigns.
- **Docs:** decisions 28 (working default) and 29, a threat-model row for business details, the
  ledger row, SYSTEM_OVERVIEW and MOCK_DATA.
- No new third-party dependencies.

**Test evidence:** `npm run check`: 211 passed, 1 skipped locally without the anon key. The API
suite was also run with the anon key: 44 of 44. New tests:

- **Core:** EIN normalization and the Social Security number refusal, profile normalization and
  errors, hours overlap, step completion.
- **Conversation:** the simulation for text and portal approval, a missing template, and clinic
  samples with no clinical detail.
- **API onboarding routes** (9 tests on a test-only business):
  - staff refused;
  - business type confirmed;
  - field errors, including a Social Security number;
  - details normalized and audited without values;
  - hours, with overlap refused and the step waiting for a calendar;
  - templates reviewed only once they exist;
  - approvers limited to this business;
  - the test call returns a simulation and creates no lead, message or job;
  - the clinic shows no AI questions.

`db:test`: 105 of 105, including the new `onboarding.test.sql` (9 checks):

- another business's details and progress can't be read or written;
- a Social Security number can't be stored as an EIN;
- the anon and authenticated roles have no access.

In the in-app browser:

- **As Rhett:** ran the simulated test call; the page stays on the step and shows the whole
  thread from Riverbend's templates.
- **As Mara:**
  - an SSN-shaped EIN and a missing ZIP each showed their own note;
  - a valid save normalized the EIN and finished the step;
  - Northline's simulation shows the approval waiting in the portal.
- **As the Prairie Path front desk:** everything is read-only.
- **At 375px:** no sideways scroll, and no control under 40px tall.

The local database was reset afterwards. The portal bundle is 535 kB (519 kB before). Mock data
only.

## 2026-11-05 — Phase 1 seed: Northline, Prairie Path and Old Mill scenarios

**Change**

- **Northline Ink (T2), 12 leads (NL-01 to NL-12), tattoo playbook.**
  - Kira's request for Mara (pending, with an active hold) and Mei's consult, approved by Jules in
    the portal.
  - A price question, a caller under 18, a Spanish voicemail, a request to move a booking, and a
    call from before texting was live.
  - Two leads waiting for details, a touch-up offer, a quiet lead, and a form that just came in
    (the only `new` lead in the data).
- **Prairie Path Counseling (T3), 9 leads (PP-01 to PP-09), minimum-data playbook.**
  - Voicemails are kept as recordings with **no transcript**. No lead has a summary, category,
    urgency or AI analysis (CLAUDE.md rule 13).
  - Covers the front desk's pending request, a booked visit, a cancellation and a waitlist offer.
  - Also a text with private details (stored, never echoed back) and Ray's STOP.
  - An after-hours crisis text got the fixed crisis message, which points to 988 and 911 and is
    not an owner template.
- **Old Mill Roofing (T4, disabled).**
  - A booked lead and a closed lead, both from before offboarding.
  - A call after offboarding, recorded as an ignored inbound event with no lead and no jobs.
- **Cross-tenant cases.**
  - Marcus's number is also a separate Prairie Path contact (X-01).
  - Wes's opted-out number is a Northline contact who is not opted out there (X-07).
  - Mei's confirmation email has a complaint event (X-08).
- **Mock-data changes.**
  - Voicemails may have no transcript and leads may have no summary; both are absent only for
    minimum-data tenants.
  - New `IGNORED_EVENTS`.
  - Seeded jobs now carry `created_at`, from when they were due.
  - Email event IDs include the status, so one message can be both delivered and complained.
- **Northline texting status.** Marked approved, because its scenarios include text threads; NL-08
  is from before approval. MOCK_DATA.md is updated to match. Deposit links are dropped from it,
  since payments are out of scope.
- **Portal.** Plain labels for the new reasons, for example "May be under 18", "Voicemail to listen
  to" and "Crisis message sent".
- **Decision 27 confirmed** (owner, 2026-11-05): only the owner changes templates and AI settings;
  staff can read them.

**Test evidence:** `npm run check`: 185 passed, 1 skipped locally without the anon key.

New catalog tests:

- every lead, request and hold state is covered;
- every tenant has leads;
- minimum-data leads have no transcript, summary, category, urgency or AI jobs;
- the disabled tenant has nothing after offboarding except ignored events;
- shared numbers stay separate contacts.

`db:test` 96/96. The new `seed_other_tenants` file has 12 checks, read as each business's own
login:

- Mara sees only Northline's 12 leads, in every Today lane;
- X-07 opt-outs are per tenant;
- Northline's requests and approver are right;
- Prairie Path's 2 voicemails are untranscribed, with no summaries or AI analyses;
- X-01 contacts are separate;
- Owen gets no tenant context;
- OM-03's call is ignored and starts no lead;
- Old Mill has nothing new since offboarding.

In the in-app browser:

- **As Mara:** Northline's Today shows 6 / 4 / 1 / 1 leads across the four lanes, with the new
  labels.
- **As Prairie Path's front desk:** Today shows reasons only. A voicemail lead reads "Not
  transcribed."

Mock data only; the local database was reset with the new seed.

**Urgent leads first** (owner, 2026-11-05):

- New rule `isUrgent` / `urgentFirst` in `packages/conversation/src/attention.ts`: an emergency, a
  safety message or a crisis message makes a "needs attention" lead urgent.
- `/portal/today` puts urgent leads at the top of Needs you, however old, and marks each card
  `urgent`.
- The portal flags the card from that server field, "Crisis" or "Emergency", with a Call button,
  instead of guessing from urgency. Clinic crisis leads have no urgency, so the old check missed
  them.
- Tests: 3 rule tests, a flag-label test, and an API test that Prairie Path's crisis lead, its
  oldest needing attention, comes first. In the browser as the front desk, the crisis card is first
  with its flag and Call button.

**Seen but not changed here:**

- Seeded slot times are relative to load time, so some fall outside business hours.
- Every tenant shares the base reply templates, including "address for the visit" for the clinic.

## 2026-11-05 — Phase 2: versioned templates and AI settings

**Change**

- New **Templates & AI** page in the portal (`/templates`, `apps/portal/src/SettingsPage.tsx`):
  - **Text templates:** grouped as texts to customers, replies, and texts to you. Each shows what
    it must keep, which placeholders it may use, an example as sent, and a live segment and
    character count.
  - **AI instructions:** structured fields only (what you do, what you don't, emergencies,
    questions, tone), never a raw prompt.
  - **Version history:** every save makes a new live version. "Make live" restores an earlier one,
    and each older version lists how it differs from the live one.
  - Staff see everything read-only. Minimum-data (clinic) businesses have no AI instructions to
    set. The page shows only what the server confirmed (decision 24).
- **Template rules** (`packages/conversation/src/templates.ts`, CLAUDE.md rule 11). Owners change
  wording, not which templates exist. Each template keeps its required pieces:
  - the business name in the first text and the confirmation, written out or as `{business}`;
  - the opt-out line where required;
  - `{slots}` and `{slot}` in offers and confirmations.

  Templates may use only the placeholders the engine can fill there. Curly quotes, emoji and stray
  braces are refused, and a template must fit in 2 segments with typical values filled in. The
  API runs these checks before writing; the portal runs the same functions for its live notes.

- **AI settings schema** (`packages/core/src/ai-settings.ts`): strict Zod object, every field
  optional, with limits in a Zod-free `ai-limits.ts` that the portal shares.
- **API** (`apps/api/src/repositories/settings.ts`):
  - `GET /portal/settings`.
  - `PUT /portal/settings/templates` and `PUT /portal/settings/ai`, each with
    `{ id, baseVersion, content }`.
  - `POST /portal/settings/:kind/restore` with `{ version, baseVersion }`.
  - Writes are **owner-only** (403 `owner_only`; decision 27, working default).
  - Each write locks the live version, refuses a stale `baseVersion` (409), and writes the new
    version, the flip of `active`, and an audit event (`settings.templates_saved`,
    `settings.ai_restored`, and so on, listing what changed) in one transaction.
  - The client-made `id` makes a double submit write one version. Restoring the live version is a
    no-op. A version that fails today's rules is not restored.
  - Template problems come back as 422 with the problem list. AI writes are refused for
    minimum-data tenants (rule 13).
- **Reply rendering** now fills `{business}` from the tenant's name, so owners can use the
  placeholder in reply templates.
- **Segment counting** moved from `@fsc/connectors` to `@fsc/core`, with a `@fsc/core/segments`
  entry point that keeps Zod out of the browser. `@fsc/connectors` re-exports it unchanged.
- **New workspace dependencies:** `@fsc/conversation` and `@fsc/core` in `apps/portal` (shared
  rules), and `@fsc/conversation` in `packages/mock-data` (a test that every seeded version passes
  the rules, since restore re-checks them). No new third-party packages.
- **Not built yet** from SCOPE.md's settings list: the "Try it" box, and the warning when an edit
  changes a message's purpose.

**Test evidence:** `npm run check`: 180 passed (1 skipped locally without the anon key). New
tests:

- template rules, 12 tests;
- AI schema and limits, 4 tests;
- reply `{business}` filling;
- settings wording in the portal;
- seeded versions passing the rules.

API settings route tests, 8 of 8 against the local stack:

- staff read-only and refused (403);
- save once with audit, and a double submit;
- a stale base refused (409);
- required pieces refused (422) with each problem named;
- an added template refused;
- restore and repeat restore;
- a missing version (404);
- raw AI prompt refused (400) and AI fields saved;
- clinic AI unavailable and refused.

`db:test` 84/84. In the in-app browser as Rhett:

- removing `{slots}` showed the note and blocked Save;
- a valid edit saved as Version 3;
- "Make live" on Version 2 restored it;
- six AI questions showed the limit note, and four saved as AI Version 3.

As Carla at 375px: every field was read-only, with no Save or "Make live" and no sideways scroll.
The local database was reset afterwards. The portal bundle is 519 kB, against 502 kB before this
change; Vite's 500 kB warning predates it. Mock data only.

## 2026-11-05 — Phase 2: template replies from the lead page

**Change**

- Decision 26 (owner, 2026-11-05): replies from the portal are template-only for now. Owners and
  staff pick an owner-approved reply; nothing typed in the portal reaches a customer.
- `packages/conversation/src/replies.ts`: a template is a reply when its key starts with `reply_`.
  `renderReply` fills only `{name}` (first name; "Thanks, {name}." becomes "Thanks." when unknown)
  and refuses any other placeholder instead of sending braces. `replyAllowed` refuses closed
  leads and opted-out contacts (CLAUDE.md rule 12).
- `POST /portal/leads/:id/replies` with `{ templateKey, messageId }`
  (`apps/api/src/repositories/replies.ts`): renders the active template version for this lead,
  records the message as **queued** with its segment count, queues a `send_text` job and an audit
  event (template key and version), all in one transaction, and returns the lead page. The
  client-made `messageId` means a double submit records one message. Refusals are 409 with a
  short code. The database's opt-out trigger remains the second lock.
- Lead page: `replyOptions` lists the replies this lead can be sent, already filled in (empty for
  closed leads and opted-out contacts). The portal shows them as a "Reply with a template" choice
  under the conversation, and outbound texts now show "Queued" or "Sent" until delivered.
- Seed: three reply templates in every tenant's template set (`reply_will_call`,
  `reply_need_address`, `reply_after_hours`).

**Test evidence:** `npm run check`: 151 passed (1 skipped locally without the anon key), including
5 reply-rule tests. API route tests 26/26, adding: replies offered and filled in, a reply recorded
as queued with its job and audit event, one message on a double submit, a non-reply template
refused, an opted-out contact refused with no options, a closed lead refused. `db:test` 84/84.
In the in-app browser as Carla: sent "will call you shortly" to Dana, saw it queued in the thread
and "Sending your reply: queued". The local database was reset afterwards. Mock data only.

## 2026-11-05 — Phase 2: lead actions (approve, suggest another time, nudge, close)

**Change**

- New workspace `packages/conversation` with `planAction`: the rules for each portal action as a
  pure function from a lead snapshot to a plan (request decision, lead change, jobs to queue,
  jobs to skip, audit event) or a refusal reason.
  - **Approve:** needs a pending request with an active, unexpired hold. Records the approval and
    queues `confirm_calendar_event`. The lead is **not** marked booked; the worker does that once
    the event exists (decision 24).
  - **Suggest another time:** marks the request changed, queues `release_hold` and
    `send_slot_offer`. Refused for an opted-out contact (CLAUDE.md rule 12).
  - **Nudge:** quiet leads only, once per lead (unique job key), never to an opted-out contact.
  - **Close:** declines a pending request and releases its hold, closes the lead, skips queued
    follow-ups. Refused for booked leads: the job is on the calendar, and only a person moves an
    existing customer (rule 14).
  - Every action skips a now-pointless approval reminder where relevant.
- Decision 25 (owner, 2026-11-05): owners and staff can take every action; each is audited with
  the person who took it.
- `POST /portal/leads/:id/actions` (`apps/api/src/repositories/actions.ts`): locks the lead and
  its request, applies the plan in one transaction (decision with who, `portal` and when; lead
  change; jobs with `on conflict do nothing`; skipped jobs; audit event) and returns the lead page
  as it now stands. Refusals are 409 with a short code and write nothing; another business's lead
  is 404; an unknown action is 400.
- Lead page now lists pending work for the lead (queued, running, retrying or failed jobs). Today
  cards carry the request state: an approved request moves to **Booked** as "Approved ·
  confirming … with your calendar"; a changed one to **Waiting on customer** as "Sending new
  times".
- Portal: action buttons that show "Approving…" (and so on) while working, then the server's
  response; an inline "Close this lead?" confirmation; plain-language messages for refused
  actions, after which the page reloads the latest state. Nudge disappears once a nudge is queued.

**Test evidence:** `npm run check`: 140 passed (1 skipped locally without the anon key),
including 9 rule tests in `packages/conversation`. `apps/api/src/actions.test.ts` (9 tests, on a
test-only business created and removed by the test): approve writes the decision, queues the
calendar job, skips the reminder and audits the staff user; a second approval and a lapsed hold
are refused with nothing written; suggest another time, one nudge only, close, booked refused,
404 across businesses, 400 for an unknown action, and Today lane placement. API route tests
20/20 and `db:test` 84/84. In the in-app browser as Carla: approved Marcus ("Approved.
Confirming with your calendar", calendar job queued, card moved to Booked), nudged Sam, closed
Ben after the confirmation. The local database was reset afterwards. Mock data only.

## 2026-11-05 — Continuous integration (GitHub Actions)

**Change**

- `.github/workflows/ci.yml`, on every pull request and every push to `main`:
  - **Checks job:** `npm ci`, `npm run check` (typecheck, lint, format, unit tests) and the
    portal build.
  - **Database job:** starts a local Supabase stack in the runner with only Postgres, Auth and
    the gateway, rebuilds it from empty (`db:reset`: every migration and the seed), runs the
    pgTAP tests (`db:test`), then the API route tests with the stack's own anon key, including
    a real sign-in token.
  - Read-only repository permissions, a newer push cancels the older run, time limits per job.
    No secrets, no hosted database, no vendor calls.
- `apps/api/src/app.test.ts`: with `FSC_REQUIRE_LOCAL_STACK=1` (set in CI) the route tests fail
  if the stack or anon key is missing, instead of skipping. Local runs without Docker still skip
  with a warning.

**Rationale:** until now every check ran only on the owner's machine. CI runs the same checks,
including tenant isolation, on every PR, and shows the result on GitHub. GitHub Actions is part
of the existing GitHub account; private repositories have a monthly allowance of free minutes.

**Test evidence:** locally, the database job's exact steps with the same excluded services
(only `db`, `auth` and `kong` running): `db:reset` from empty, `db:test` 84/84, route tests
11/11 with none skipped. With the stack unreachable and `FSC_REQUIRE_LOCAL_STACK=1`, the route
tests fail with a clear message. The lockfile is in sync for `npm ci`. The workflow itself has
not run on GitHub yet; it runs on the first push.

## 2026-11-05 — Phase 2: lead page (API and screen)

**Change**

- `GET /portal/leads/:id` (`apps/api/src/repositories/lead.ts`): the lead with its contact and
  number of earlier leads, the latest voicemail and transcript, the full message thread with
  authors and delivery status, and the latest request with who decided, how, and its hold.
  Another business's lead returns 404, never 403, so the API does not confirm it exists. A
  malformed ID returns 400 `invalid_request`.
- API error handler: validation errors answer `{"error": "invalid_request"}`; anything else is
  logged (redacted) and answers `{"error": "internal"}`, so no internal detail reaches a browser.
- `apps/portal` lead page (`/leads/:id`), from the approved canvas layout:
  - Header with how and when the lead arrived; the five-step line for leads on the normal path
    (none for leads that need a person, went quiet or closed).
  - Decision box: a pending request shows the slot, the hold's expiry and, until portal approval
    is built, "reply 1 to the approval text to approve" instead of a button that does nothing
    (decision 24). Booked shows the slot and who approved it, how and when. Others show why the
    lead needs a person. Every variant has a Call link.
  - One conversation thread: the voicemail (length, time, transcript, a warning when confidence
    is low, "Not transcribed" when there is none) then each text, labeled "You, from your
    template", "You, AI-drafted question", "You" or the customer's name, with "Not delivered"
    where it applies.
  - Details: what they need (labeled as an AI summary), how soon, address, phone, email, history.
  - Today's card names now link to the lead page.
- Portal layout fix: the sidebar is sticky only when it sits beside the content (880px and wider).
  Between phone width and 880px it stacked above the content while still sticky, and covered it
  on scroll.
- Seed fix: in RB-02's thread, Marcus's "1" and the confirmation shared a timestamp, so their
  order varied. The catalog test now rejects tied timestamps within a thread.

**Test evidence:** `npm run check` passes (API: lead page, repeat-customer count, 404 for
another business's lead, 400 for a malformed ID; portal: progress-line and label tests). In the
in-app browser against the local stack: Marcus's page (pending request, active hold, voicemail,
five texts in order, details), Ana's (booked, approved by Rhett in the portal), Ben's (needs a
person, no progress line) and an unknown ID (not-found message). Mock data only.

## 2026-11-05 — Phase 2: portal shell with sign-in and the Today dashboard

**Change**

- New workspace `apps/portal` (React + Vite, decision 18):
  - Sign-in with email and password through Supabase Auth (local mock logins), with plain error
    messages. The browser holds only the public anon key; all data comes from `apps/api`.
  - "No portal access" screen for a login without an active business (Old Mill's owner), and a
    retry screen for API errors. An expired session returns to sign-in.
  - Shell from the approved canvas: brand tile, sidebar navigation (Leads, Calendar, Templates &
    AI and Settings listed as "Soon" rather than hidden), service status from the API, account and
    sign-out. The sidebar stays in view on wide screens and stacks on phones.
  - Today: a summary sentence naming who needs the owner, the five-step line, and the four lanes
    from `/portal/today`, with status lines in plain words, times in the business's time zone,
    emergency flags and a "Call" link (the only action on this screen for now).
  - Vite forwards `/api` to `apps/api` in development, so no CORS rules are needed.
  - `apps/portal/.env.example` documents the two browser values; `.env.local` is git-ignored.
- Decision 24 (owner, 2026-11-05): the portal shows only true, server-confirmed state, with no
  optimistic UI. After Approve a lead reads "Confirming" until the calendar event exists.
- `/portal/me` now also returns the tenant's time zone, texting and email status, and calendar
  connection, so the sidebar shows real status instead of fixed text.
- Tooling: root `tsconfig.json` excludes `apps/portal`, which has its own config (DOM types,
  JSX, bundler resolution), and `npm run typecheck` checks both. ESLint applies the React hooks
  rules to the portal. The hygiene test allows `apps/portal/vite.config.ts`. `.claude/launch.json`
  starts the API and the portal for in-app preview.

**New dependencies:** in `@fsc/portal`: `react` and `react-dom` (UI), `react-router` (screens
and links; the lead page is next), `@supabase/supabase-js` (browser sign-in and session refresh);
dev-only `vite` and `@vitejs/plugin-react` (dev server and build), `@types/react` and
`@types/react-dom`. Root dev-only: `eslint-plugin-react-hooks` (catches hooks called out of
order, a common source of stale or wrong data on screen).

**Known gaps:** response types in `apps/portal/src/types.ts` mirror the API's Zod schemas by
hand for now. On phones the sidebar comes before the lanes; a collapsible menu is a follow-up.
Marcus's seeded thread says "Thu 2:00 PM" while his seeded slot is relative to load time, so
the card and the thread can name different times.

**Test evidence:** `npm run check`: typecheck (both configs), lint and format pass, all tests
pass (including 7 new portal formatting tests and the updated `/portal/me` test).
`npm run build -w @fsc/portal` succeeds. In the in-app browser against the local stack: Rhett
signs in and sees Riverbend's four lanes (9 / 7 / 2 / 1) with emergencies first; a wrong
password shows the mismatch message; Owen (Old Mill, disabled) sees "No portal access"; Carla
signs in at 375px wide with no horizontal scroll. Mock data only.

## 2026-11-05 — Phase 2 begins: Fastify API skeleton with portal sign-in

**Change**

- `apps/api` is now a Fastify app (decision 1 resolved: Fastify, owner 2026-11-05):
  - `config.ts`: environment validated with Zod at startup; errors name variables, never values.
  - `db.ts`: every query runs in a transaction as `fsc_app` (`set local role`), with the tenant
    context set for tenant work (`withTenant`) or absent before sign-in (`withoutTenant`).
  - `auth.ts`: verifies Supabase access tokens (ES256) against the project's published keys,
    then `app.resolve_portal_user`. 401 without a valid token; 403 for a disabled user or tenant.
  - Routes: `GET /health`, `GET /portal/me`, `GET /portal/today` (the four lanes, built from the
    `LANE_STATES` mapping in `@fsc/core`). Request and response shapes are Zod schemas; repository
    queries filter by tenant explicitly on top of row-level security.
  - Logging through Fastify's Pino logger with redaction of authorization headers, cookies, phone
    numbers, emails, message bodies, summaries and transcripts (CLAUDE.md rule 4).
  - `npm run dev -w @fsc/api` and `npm run start -w @fsc/api`.
- Migration `20261105165057_admin_can_act_as_app_role.sql`: `grant fsc_app to postgres`, so the
  API's `set local role fsc_app` works on an admin connection (ledger row added).
- `tsconfig.json`: `strict: true` stated explicitly (owner). It was already on through
  `tsconfig.base.json`, so behavior is unchanged.
- Root `package.json` lists `zod` as a dependency (owner). Each workspace already declares its own
  `zod`, so this is redundant but harmless.

**New dependencies (`@fsc/api`):** `fastify` (HTTP server; per-route body parsing for signed
webhooks, encapsulated plugins for per-route security, built-in Pino logging with redaction,
`inject()` for tests without a network); `fastify-type-provider-zod` (validates and types routes
with the same Zod schemas as `@fsc/core`); `pg` and `@types/pg` (Postgres client; plain SQL with
transactions, matching the migration-first approach); `jose` (verifies Supabase JWTs against the
published JWKS, no network call per request after the keys are cached).

**Test evidence:** `npm run db:reset` applies all four migrations and seeds; `npm run db:test`
passes; `apps/api/src/app.test.ts` (7 tests, local stack): health, 401 without or with a bad
token, 403 for Old Mill's owner, `/portal/me`, Riverbend's lanes (9 / 7 / 2 / 1, Riverbend leads
only), no tokens or customer details in logs, and a real local Supabase token accepted while a
tampered one is refused. Manual: the server process answered `/health`, refused `/portal/today`
without a token (401) and returned Riverbend's lanes to Rhett's real token. Local stack and mock
data only.

## 2026-11-05 — Phase 1: settings and operations migration

**Change**

- Migration `20261105161651_settings_and_operations.sql` (ledger row added):
  - `playbooks`: the industry catalog (HVAC/plumbing, tattoo, contractor, clinic) as reference
    data in the migration, read-only to the application.
  - `tenant_config`: playbook, number, inbound address, hours, job length, approval window, hold
    length, daily text limit, email sender. The playbook and the clinic minimum-data flag are
    locked: the application can update only the owner-editable columns (CLAUDE.md rule 13).
  - `tenant_templates` and `ai_settings`: write-once versions with one active per tenant, so undo
    is activating an earlier version and history never changes.
  - `service_registrations` (status cards; adds a `disabled` state for offboarding) and
    `integration_connections` (secret names only): read-only to the application.
  - `calendar_connections`, `jobs` and `job_attempts` (unique idempotency key per tenant; a
    running job always has a lease), `opt_outs`, `email_events`, and an append-only
    `audit_events`.
  - Trigger on `app.messages`: an outbound text to a number that opted out of that tenant is
    refused, as a second lock behind the engine (CLAUDE.md rule 12).
  - `app.resolve_inbound_tenant(channel, address)`: maps the number called or address mailed to
    an active tenant before any context exists.
  - `app.claim_jobs(limit, lease_seconds)`: the worker's single cross-tenant path; leases due,
    retryable and stale-lease jobs from active tenants with `for update skip locked`.
- `@fsc/core` `states.ts`: adds service registration states; the drift test now also covers job
  statuses and registration states.
- `packages/mock-data/src/operations.ts` and seed files `03`, `04`, `10`, `11`, `12`; `01` now
  also seeds tenant config and status cards. Riverbend has two versions of each setting (X-06),
  jobs exist in every status with attempts (X-09, including a stale lease for X-04), Wes is opted
  out (RB-12), Ana has a delivered and a bounced email (RB-07, RB-21), and the audit trail covers
  provisioning, offboarding, settings and decisions.
- Tests: `settings_operations.test.sql` (24) and `seed_operations.test.sql` (8).

**Decisions made inside defaults (review):** approval window 120 minutes, hold 24 hours and
daily text limit 200 per tenant as column defaults (owner-editable except the limit); the
playbook catalog lives in a migration because production needs it; required template pieces are
checked by `apps/api`, not the database.

**Test evidence:** `npm run db:reset` builds and seeds from empty; `npm run db:test`: 84/84 pass;
`npm run check`: typecheck, lint and format pass, 97/97 tests. Local stack only.

## 2026-11-05 — Phase 1: lead-domain migration and Riverbend scenarios

**Change**

- Migration `20261105155805_leads_and_conversations.sql` (ledger row added): `contacts`,
  `inbound_events`, `leads`, `calls`, `voicemails`, `ai_analyses`, `conversations`, `messages`,
  `requests` and `calendar_holds` in schema `app`. Every table has `tenant_id`, composite
  foreign keys to its parents (a row can never point into another tenant), row-level security,
  and no delete privilege for the application. Rules held by the schema itself:
  - Intake idempotency: unique `(tenant_id, source, external_event_id)` on inbound events, which
    are append-only to the application (CLAUDE.md rule 2).
  - Templates promise: outbound message authors are only `template` (with its key), `staff` or
    `ai_question`; there is no free-form AI author (rule 10).
  - At most one pending request per lead; decided requests must record who, how and when.
  - Two active holds can never overlap on one calendar (exclusion constraint, `btree_gist`).
  - Contacts are unique per tenant by phone and by email; the same number in two tenants is two
    contacts.
- `@fsc/core` `states.ts`: lead, source, urgency, request and hold state lists, plus the portal
  lane mapping. `tests/schema-constants.test.ts` fails if they drift from the migration's checks.
- `packages/mock-data`: Riverbend's scenario leads (RB-01 to RB-25, without RB-21, which needs
  email events), their contacts, the 12 evaluation-set voicemails, Marcus's scripted thread, and
  requests and holds in pending, approved, changed and expired states. New seed files `05` to `09`.
  `@fsc/mock-data` now depends on `@fsc/connectors` (workspace) for segment counts.
- Tests: `lead_isolation.test.sql` (20) proves cross-tenant reads, writes and references fail and
  each schema rule holds; `seed_leads.test.sql` (6) reads Riverbend as Carla through the
  application role and checks every Today lane, the RB-02 thread, the active hold and the
  transcripts.

**Decisions made inside defaults (review):** voicemail recordings stay with the provider (only
references stored); raw webhook payloads are not stored (hash only); the clinic no-transcript
rule is enforced in code, not the schema, until tenant playbooks exist in the database.

**Test evidence:** `npm run db:reset` builds and seeds from empty; `npm run db:test`: 52/52 pass;
`npm run check`: typecheck, lint and format pass, 95/95 tests. Local stack only.

## 2026-11-05 — Phase 1: mock-data catalog and seed for tenants and logins

**Change**

- New workspace `packages/mock-data`: the four mock tenants and seven portal users from
  `MOCK_DATA.md` as typed objects, each parsed through schemas that enforce the mock rules
  (`mock-` slugs, +1 319 555-0100 to 0199, `example.com/.org/.net`, normalized values).
  Deterministic name-based UUIDs from scenario keys (`mockUuid`).
- `npm run seed:build` generates `supabase/seed/01_tenants_and_config.sql` (tenants) and
  `02_portal_users.sql` (local Supabase Auth users and identities, password `mock-local-only`,
  plus `app.portal_users`). Seed files are never edited by hand; a test fails if they drift
  from the catalog.
- `supabase/tests/seed_sign_in.test.sql` (5 pgTAP tests): the four tenants load with Old Mill
  disabled, only `mock-` tenants exist, each active login resolves to its own tenant and role,
  the disabled tenant's owner cannot sign in, and all seven logins have a password, confirmed
  email and email identity.
- `tenant_isolation.test.sql` fixtures renamed to test-only tenants (`mock-test-*`) so they never
  collide with seed data.
- `DECISIONS_PENDING.md` decision 18: portal front end is React + Vite, matching the WayMaker
  Ink request portal (owner, 2026-11-05).
- Docs: `CLAUDE.md` (layout, commands, phase), `DATABASE.md` (seed generation),
  `MOCK_DATA.md` (catalog status, local password).

**New dependency:** `tsx` (root dev dependency) runs `seed:build`. Node 22 can strip types but
cannot resolve this repo's `.js` import specifiers to `.ts` sources; `tsx` can. Dev-only, never
shipped.

**Test evidence:** `npm run db:reset` loads both seed files; `npm run db:test`: 26/26 pass;
`npm run check`: typecheck, lint and format pass, 89/89 tests. Manual check against
the local Auth API: Rhett and Jules sign in with the mock password (HTTP 200, token issued); a
wrong password is refused (HTTP 400). Local stack only.

## 2026-11-04 — Phase 1: tenancy migration and isolation tests

**Change**

- First migration, `supabase/migrations/20261105050016_tenancy_foundation.sql` (ledger row
  added):
  - Private `app` schema. Tenant data never lives in `public`, so the Supabase Data API cannot
    expose it; the browser roles `anon` and `authenticated` have no privileges in `app`.
  - `fsc_app` application role, created without login or password (each environment enables it).
  - `app.current_tenant_id()` reads the transaction-scoped `app.tenant_id`; missing or malformed
    context matches no rows.
  - `app.tenants` (read-only to the application: only the operator creates or disables tenants)
    and `app.portal_users` (owner/staff, one login per tenant, disabled rather than deleted,
    `unique (tenant_id, id)` for composite foreign keys), both under row-level security.
  - `app.resolve_portal_user(auth_user_id)`: the one cross-tenant read the application gets,
    returning a login's tenant and role only when both the user and the tenant are active.
- `supabase/tests/tenant_isolation.test.sql`: 21 pgTAP tests. As the application role in one
  tenant: sees only its own tenant and users; cannot read, add, edit or move users across
  tenants; cannot create or change tenants or delete users. No or malformed context sees
  nothing. Disabled tenants and disabled users cannot sign in. `anon` and `authenticated` are
  denied. Fixtures are mock values inside a rolled-back transaction.
- `supabase/.gitignore` and `tests/repo-hygiene.test.ts`: local Studio's `supabase/snippets/`
  folder (saved SQL queries) is git-ignored and treated as CLI state, so scratch SQL can never be
  committed.
- `DATABASE.md`: connection rules now name the `app` schema, the `fsc_app` role and sign-in
  resolution.

**Decisions made inside defaults (review):** tables live in schema `app` rather than `public`;
one login belongs to one tenant in MVP; deleting a Supabase Auth user is blocked while a portal
user still points to it. The operator CLI will write through a direct database connection
(the service-role Data API cannot see `app`); settled when the CLI is built.

**Test evidence:** `npm run db:reset` builds cleanly from empty; `npm run db:test`: 21/21 pass;
`npm run check`: typecheck, lint and format pass, 84/84 tests. Local Supabase stack only.

## 2026-11-04 — Phase 1: connector interfaces with labeled mocks

**Change**

- `packages/connectors`: interfaces for every external service in v0.2: `SmsSender`,
  `PhoneEvents` (missed calls, voicemails, received texts, delivery status), `EmailSender`,
  `EmailEvents` (forwarded inquiries, delivery, bounce, complaint), `CalendarProvider` (busy,
  place hold, confirm hold, release hold), `TranscriptionProvider` and `LanguageModel`.
- Every call takes `tenantId` explicitly; side effects take an idempotency key. Calls return a
  result rather than throwing, with errors marked `transient` (retry) or `permanent`
  (dead-letter), matching the error table in `SYSTEM_OVERVIEW.md`. Every adapter carries
  `provider` and `isMock`, so status reporting can refuse to call a mock-only path verified.
- `countSegments` and `findNonGsmCharacters`: billable SMS segment counting (GSM-7 vs UCS-2),
  for the segment limits and cost controls in `SCOPE.md`.
- `@fsc/connectors/mock` (separate entry point, never imported by production wiring): mocks for
  each interface. They issue `MOCK-` references, enforce idempotency per tenant and key, support
  scripted failures, record every request, and throw on any phone number outside
  +1 319 555-0100 to 0199 or any email outside `example.com/.org/.net` (CLAUDE.md rule 17). The
  calendar mock treats holds as busy (no double offers) and simulates revoked access; the
  transcription and model mocks return scripted output for the evaluation set.
- Renamed in `SYSTEM_OVERVIEW.md`: `VoiceEvents` → `PhoneEvents` (it also carries texts),
  `InboundEmail` → `EmailEvents` (it also carries delivery events). `LeadDestination` (Sheets)
  is not defined until decision 20 is resolved.

**New dependencies (in `@fsc/connectors`):** `zod` (already used by `@fsc/core`) validates
inbound event shapes; `@fsc/core` (workspace) supplies `ExternalEventIdSchema`. No new
third-party packages.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 83/83 tests pass (29 new in
`packages/connectors`). Mocks only: no vendor was called.

## 2026-11-03 — v0.2 pricing assumptions

**Change**

- `docs/product/SCOPE.md`: replaced the stale v0.1 pricing note with unvalidated v0.2 working
  numbers: about $1,000 setup, about $199 Standard and $349 Busy per month, base plus overage
  for high volume, and $99/month pilots for three months. Added a rough internal cost floor and
  the cost controls that keep plans profitable (segment limits, send caps, line-type lookup,
  loop limits, email-first confirmations, subaccount usage alerts).
- `docs/adr/DECISIONS_PENDING.md`: decision 21 now points at these working assumptions.

**Rationale:** v0.2 adds ongoing per-tenant texting, number, registration and AI costs that the
v0.1 anchor did not cover. Numbers are owner-reviewed starting points, not market-validated.

**Test evidence:** docs only; `npm run format:check`.

## 2026-11-03 — Twilio ISV profile approved

**Change**

- Owner confirmed Fifth Stone Dev's Twilio ISV business profile is approved. Recorded in
  `SCOPE.md` (build order note: Google OAuth verification is the only remaining approval with a
  waiting period) and ADR-0002 decision 3.

**Test evidence:** documentation only.

## 2026-11-03 — Build order: product on mocks first, integrations later

**Change**

- `SCOPE.md`: "Proposed phasing" replaced by the owner's build order (foundation, portal on mock
  data, engine on mocks, integrations, pilot) with exit criteria per phase, and a separate
  release-scope table (MVP, second release, later). Approvals with real waiting periods (Twilio ISV
  profile, Google OAuth verification) start before Phase 4; Supabase projects are created when
  each environment is needed.
- `CLAUDE.md` current phase rewritten to match; no real adapter before Phase 4.
- `DECISIONS_PENDING.md` decision 13: build order resolved; pilot businesses still open.

**Rationale:** prove the portal and multi-tenant isolation on local Supabase Auth and mock data
before taking on Twilio and SES configuration.

**Test evidence:** documentation only. `npm run check`: typecheck, lint and format pass; 54/54 tests pass.

## 2026-11-03 — Local Supabase, migration rules, mock data plan, hosting plan

**Change**

- Development database is a local Supabase stack in Docker Desktop. Added the Supabase CLI as a
  dev dependency (`supabase`, so every contributor runs the same CLI version through `npm`
  instead of a global install), ran `supabase init`, and set `project_id`, local-only seed path
  `./seed/*.sql`, and turned off the unused edge runtime and analytics services. Added
  `db:start`, `db:stop`, `db:reset`, `db:new` and `db:test` scripts. `.env.example` now points at
  the local stack.
- Retired `infra/migrations/` (deleted); migrations live in `supabase/migrations/`.
- `docs/engineering/DATABASE.md` (new): environments, local setup, migration rules
  (forward-only, header, ledger, one pre-staging squash, deprecation by superseding migration,
  expand/contract, no secrets, push only via `supabase db push`), seed rules (local only,
  reserved values) and the no-cleanup-scripts rule.
- `docs/engineering/MIGRATION_LEDGER.md` (new, empty).
- `tests/repo-hygiene.test.ts` now enforces: no scratch, temporary, cleanup, backup or
  one-off files; no shell scripts; JavaScript and TypeScript only where allowlisted; SQL only
  under `supabase/`; `supabase/` holds only config, migrations, seed and tests; migration names
  and headers; every migration in the ledger; seed phone numbers in 555-0100 to 555-0199 and
  emails on reserved domains; `_KEY` variables in `.env.example` are placeholders.
- `docs/product/MOCK_DATA.md` (new): four `mock-` tenants, seven users, 49 scenario leads
  covering every state and edge case, cross-tenant cases, a 24-voicemail and 8-text evaluation
  set, three conversation scripts, and the import plan (typed catalog → generated seed files →
  local only; staging through the operator CLI; never production).
- `docs/adr/0003-database-platform-and-hosting.md` (new): Supabase plus local CLI stack and
  CLI-managed migrations accepted; one project per environment, app on the Hostinger VPS under
  Dokploy, operator-CLI tenant provisioning, and RLS with a transaction-scoped tenant context
  proposed. ADR-0001 decision 6 marked superseded in part.
- `CLAUDE.md`: database commands, layout, rules 15–17, migration pushes added to owner
  approvals. `SYSTEM_OVERVIEW.md`: hosting diagram and environments. `DECISIONS_PENDING.md`:
  3 resolved, 4 and 8 updated, 22–23 added. `THREAT_MODEL.md`: A25–A27. `BACKLOG.md`: Twilio
  fallback URL. `infra/deployment/README.md` updated.

**Rationale:** the owner wants an airtight repo: every hosted schema change reviewable and
replayable, no lingering scripts, and mock data that can never reach production.

**Not done here:** `npm install` was not run, so the CLI binary is not yet in `node_modules`.
Run `npm install` on Windows, start Docker Desktop, then `npm run db:start`. The package lock was
updated without installing.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 54/54 tests pass (11 new
hygiene tests). The hygiene tests were also run against deliberately bad files (a `cleanup.sh`
and a seed file with a real-looking number and a gmail address) and failed as intended; the bad
files were removed.

## 2026-11-03 — Scope v0.2: missed call to booked job

**Change**

- `docs/product/SCOPE.md` rewritten as v0.2 (planning draft). The product moves from
  form-to-sheet admin automation to a missed-call-to-booked-job loop: capture, clarify,
  offer times, owner approval, confirmation. Adds industry playbooks (tattoo, HVAC and
  plumbing, contractors, clinics with a minimum-data rule), an owner portal (Today dashboard,
  lead page, owner-editable templates and AI settings, onboarding with a test call), channel
  and vendor approach (Twilio ISV with toll-free first, SES, forwarded email, Google Calendar
  and Acuity), guardrails, proposed phasing, acceptance criteria and open decisions.
- `docs/product/BACKLOG.md`: dashboard, SMS, self-service onboarding and AI triage marked as
  moved into scope; new parked items added from the v0.2 exclusions.

**Rationale:** owner review found the v0.1 offer too close to commodity tools to earn an
"I need this" reaction. v0.2 targets lost revenue instead of admin time. The v0.1 intake,
job queue, idempotency and reminders remain the foundation.

**Aligned in the same change**

- `CLAUDE.md`: purpose, current phase and layout describe v0.2; rule 9 exclusions replaced
  with the v0.2 list; new rules 10–14 (AI/template boundary, server-enforced locked layers,
  opt-out, clinic minimum-data, no automatic rescheduling); owner-approval list adds real
  texts/calls, Twilio registrations and sending data to AI providers.
- `docs/adr/0002-scope-v0.2-architecture.md` (new, Proposed): Twilio ISV with per-tenant
  subaccounts and toll-free first, conditional call forwarding, AI boundary, conversation
  state machine, calendar interface, forwarded inbound email, portal calling the API only,
  versioned settings, clinic rule. ADR-0001 notes that its product context is v0.1 and its
  technical decisions remain in force. ADR index updated.
- `DECISIONS_PENDING.md`: decisions 5, 9, 10, 11 revised; 13–21 added (phasing and pilots,
  offer name, AI providers, number type, portal auth and stack, hold timeout, Sheets, pricing).
- `SYSTEM_OVERVIEW.md` v0.2: boundaries, core-loop sequence diagram, proposed states and
  portal lanes, new modules, owner-editable vs locked, new entities, new error cases.
- `THREAT_MODEL.md` v0.2: new assets, entry points 6–10, abuse cases A12–A24.
- `SITE_BRIEF.md` v0.2: landing page with industry tiles; the existing `apps/marketing/` page
  is marked as built from v0.1 and needing rework.
- `STYLE_GUIDE.md`, `README.md`, `ONBOARDING.md`: offer name marked pending, audience widened,
  v0.1 onboarding flagged for rewrite.

**Test evidence:** documentation only. `npm run check`: typecheck, lint and format pass; 43/43 tests pass.

## 2026-11-03 — Marketing page (local draft)

**Change**

- `apps/marketing/`: static marketing page for Inquiry-to-Action, built from
  `docs/marketing/SITE_BRIEF.md`. Sections: hero with a sample request card, before/after,
  six-step pipeline (the line fills as it scrolls into view where the browser supports it; it is
  static under reduced motion), what stays the same, included/not included (from `SCOPE.md`), and
  a soft call to action. Plain HTML/CSS, no JavaScript.
- Brand applied from the owner's brand guide and `fifth-stone-brand.css`: palette, Archivo and
  Space Mono, Fifth Stone Dev logo PNGs copied to `apps/marketing/public/assets/`. Recorded in
  `docs/brand/STYLE_GUIDE.md`. Bronze buttons use Charcoal text for contrast (owner to confirm).
- Canonical and Open Graph tags point to `https://connect.fifthstonedev.com/`. The page carries
  `noindex, nofollow` until launch is approved. Nothing deployed; no DNS changes.
- Call to action links to a placeholder (`#contact-todo`) until the owner supplies a real email
  or booking link.
- `apps/marketing/serve.mjs`: dependency-free local preview server bound to 127.0.0.1
  (`npm run preview -w @fsc/marketing`, http://localhost:4321/). `.claude/launch.json` points at it.
- `eslint.config.js`: Node globals for `*.mjs` scripts.

**No new npm dependencies.** The page loads Archivo and Space Mono from Google Fonts, as the
brand guide specifies. That request shares visitors' IP addresses with Google; consider
self-hosting the fonts before launch.

**Test evidence:** `npm run check`: typecheck, lint and format pass; 43/43 tests pass. Page
reviewed in a browser at 1366px and 375px wide (no horizontal scroll). No integrations involved.

## 2026-11-03 — Brand approval and marketing site brief

**Change**

- Owner approved **Fifth Stone Connect** as the public service name (provisional, trademark
  search pending) and **connect.fifthstonedev.com** as the service domain. Updated
  `STYLE_GUIDE.md`, `CLAUDE.md`, `README.md`, `package.json`.
- Added `docs/marketing/SITE_BRIEF.md` for the first marketing page, to be built locally under
  `apps/marketing/`. No DNS or deployment changes.

**Test evidence:** `npm run check` — all checks pass, 43/43 tests.

## 2026-11-03 — Phase 1, part 1: core types and validation

**Change**

- `packages/core`: canonical lead schema with normalization (`lead.ts`, `normalize.ts`), tenant
  config (`tenant.ts`), inbound event contract (`events.ts`), action jobs and idempotency keys
  (`jobs.ts`), integration connection configs (`connections.ts`).
- Lead status transition rules; only `new` is unresolved.
- `docs/architecture/SYSTEM_OVERVIEW.md`: added canonical lead shape section.
- Repository connected to `github.com/fifthstonedevLLC/fifthstone_connect`; Phase 0 pushed.

**New runtime dependency:** `zod` (in `@fsc/core`) — one definition gives both TypeScript types
and runtime validation with readable error messages (ADR-0001 §3).

**Decisions made inside defaults (review):** North American phone numbers assumed unless a
`+country` code is given; per-tenant daily acknowledgment cap defaults to 100; reminder default
is 8 business hours after creation; client-generated submission UUID is the form event ID.

**Test evidence:** `npm run check` — typecheck, lint, format pass; 43/43 tests pass (40 new unit
tests in `packages/core`). Pure logic only; no database, network, or mocks involved.

## 2026-11-02 — Phase 0: repository and documentation foundation

**Change**

- Moved the original handoff documents to `docs/handoff/` (unchanged) and added a project
  `README.md` at the root.
- Scaffolded an npm-workspaces TypeScript monorepo: `packages/{core,connectors,workflow}`,
  `apps/{api,worker,operator}`, `infra/{migrations,deployment,monitoring}`. Source files are
  placeholders that document what each phase adds.
- Added `CLAUDE.md`, `.env.example` (placeholders only, SES sending disabled by default),
  `.gitignore`, `.editorconfig`, `.gitattributes`, `.nvmrc`, Prettier and ESLint config.
- Added documentation foundation: style guide, scope, backlog, system overview, ADR-0001,
  pending decisions, threat model, runbook, onboarding, offboarding.
- Added `tests/repo-hygiene.test.ts` enforcing env-file ignore rules and placeholder-only secrets.

**New dev dependencies:** typescript, @types/node, vitest, eslint, @eslint/js,
typescript-eslint, prettier (rationale in ADR-0001 §7). No runtime dependencies.

**Rationale:** Execution guide Phase 0.

**Test evidence:** see "Checks" in the Phase 0 session handoff — typecheck, lint, format check,
and 3 hygiene tests run locally. No external services were called; no mocks were needed yet.
