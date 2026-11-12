---
title: 'Roadmap — Every Channel, Free Text, Permissions'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Proposed'
version: '0.1'
owner: 'Phil (Fifth Stone Dev)'
last_updated: '2026-11-11'
---

# Roadmap — Every Channel, Free Text, Permissions

The direction the owner set on 2026-11-11: Fifth Stone Connect gathers **every way a customer can
reach a business** — calls, texts, email, web forms and social direct messages — into one Front
Desk, and lets the business answer from there, including in its own words when the owner allows
it. This plan orders that work into iterations, keeps finishing the portal's menu (Contacts,
Reporting, Settings) inside them, and lists the gaps found along the way. Items marked
**decision** need the owner before they are built; open ones are rows 38 to 43 in
[DECISIONS_PENDING.md](../adr/DECISIONS_PENDING.md). Until a row is resolved, `SCOPE.md` v0.2 is
still the list of what is in.

## Who this has to work for

| Business                | How customers reach it today                     | What it needs                                                                                                                       |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| WayMaker Ink (tattoo)   | Facebook Messenger, email through its portal     | Messenger and email in one place; reminders and follow-ups without a business phone number; replies in its own words                |
| Trailer Toad (products) | Not yet mapped (web store, email, likely social) | Order and shipping problems answered quickly in its own words; no booking step; order details (number, item, photos) asked up front |
| Trades (service calls)  | Phone first; texts; web form                     | What is built now: missed call to booked job                                                                                        |

The lesson from both reference businesses: **the phone is not always the front door**, and **not
every conversation ends in a booking**.

## Where things stand (2026-11-11)

| Channel                     | Status                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Missed calls and voicemails | Built on labeled mocks (`/webhooks/phone`); real Twilio adapter in Phase 4                       |
| Texts (SMS)                 | Built on mocks; optional per business (decision 36); toll-free registration started by the owner |
| Email                       | In the data model only (`source = 'email'`, `channel = 'email'`); no inbound route or sender yet |
| Web contact form            | In the data model only (`source = 'form'`); the v0.1 public form design exists, no route         |
| Facebook Messenger          | Nothing yet                                                                                      |
| Instagram direct messages   | Nothing yet                                                                                      |
| WhatsApp                    | Nothing yet                                                                                      |
| Replies from the portal     | Template-only (decision 26), over text                                                           |
| Roles                       | Owner and staff, fixed rules in code (decisions 25 and 27)                                       |

## Channel facts that shape the design

These are the vendor rules as understood today; each is checked against the vendor's current
documentation when its adapter is built (Phase 4 rule: nothing is reported working until run
against a real test resource with owner approval).

- **Texts:** the business must be registered (toll-free verification or 10DLC); every outbound
  text is checked against opt-outs first; what is sent must match the registered use case
  ("customer care"), so free text cannot turn into marketing.
- **Facebook Messenger and Instagram:** through Meta's messaging APIs, with a Meta app that passes
  app review and a verified business. A business may reply freely within **24 hours** of the
  customer's last message; a person replying later uses Meta's human-agent allowance (up to about
  7 days); outside that, only specific message types (for example an appointment update) are
  allowed. The business connects its Page or Instagram account to Fifth Stone Connect in Settings.
- **WhatsApp:** through Meta's Cloud API, the same 24-hour customer-service window; outside it,
  only pre-approved message templates, with per-message charges. Meta's "coexistence" lets a
  business keep using the WhatsApp Business app on the same number while the API is connected,
  so connecting does not take their phone app away.
- **Email:** no carrier approval and no reply window; the work is deliverability (sending domain,
  DKIM) and threading replies (decision 6, ADR-0002 decision 8: forwarding, not mailbox access).
- **Web form:** the cheapest channel to add; spam protection (Turnstile) and a reply path back by
  email or text, using what the customer gave.
- **Not available:** Google Business Profile chat (Google ended Business Messages in 2024).

### Social platforms (owner's list, checked 2026-11-11)

Whether a third-party service like Fifth Stone Connect can connect is what matters, not whether
the platform has messaging. Sources are vendor and integrator pages; each is confirmed against the
platform's own developer documentation when its adapter is built.

| Platform             | Can we connect?                                                                                                                                                                                             | Tier                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Facebook Messenger   | Yes: Meta's messaging API, one Meta app with app review and business verification. 24-hour reply window, about 7 days for a person                                                                          | Build (Iteration 4)                             |
| Instagram Direct     | Yes: same Meta app; Instagram business or creator accounts; same windows                                                                                                                                    | Build (Iteration 4)                             |
| WhatsApp Business    | Yes: same Meta app (Cloud API). Templates and per-message charges outside 24 hours; coexistence keeps the Business app on the same number                                                                   | Build (after Messenger)                         |
| Telegram (Business)  | Yes, cheaply: Telegram's free Bot API. The business turns on a chatbot connection in Telegram Business settings, and the bot answers as the business. Whether Telegram Premium is still required is unclear | Build (Iteration 5)                             |
| X (formerly Twitter) | Yes, at a cost: X's API is pay-per-use since February 2026, with Direct Message permission; per-request charges (amounts unconfirmed) for each message read and sent                                        | Build (Iteration 5); cost passed on by contract |

Four things follow:

1. **One Meta app covers three platforms.** Messenger, Instagram and WhatsApp share Meta's app
   review, business verification and webhook setup, so the first social adapter carries most of
   the cost of the next two.
2. **Every channel fits one adapter shape.** Each declares what it allows (a reply window or none,
   whether the business may start a conversation, attachments, message length), so adding
   Telegram or X later is an adapter and its rules, not a redesign.
3. **A platform's cost or limits are settled per client.** Where a platform charges (WhatsApp
   outside 24 hours, X per message) or has limits, whether the client pays the extra is agreed
   when the contract is negotiated (owner, 2026-11-11; decision 44). Each business only switches
   on the platforms it pays for.
4. **No partner programs.** Platforms that open messaging only to approved partners (LinkedIn
   Page messages, TikTok's business messaging) are not pursued (owner, 2026-11-11).

## What the iterations build toward

1. **One customer, many channels.** A contact can have several identities: phone numbers, email
   addresses, a Messenger ID, an Instagram ID. A message arrives on one channel, is matched to a
   contact (exact identity match only; anything uncertain goes to a person, as `SCOPE.md` already
   says), and lands in that contact's single history.
2. **Reply where they wrote.** A reply goes back on the channel the customer used, and the
   composer shows what that channel allows right now: "Messenger: 3 hours left to reply freely",
   "Texting is off for this business", "This customer opted out".
3. **Free text, switched on by the owner.** A business-wide switch, per channel, off by default.
   When on, the people the owner allows can type their own replies. The server, not the portal,
   enforces the rules: opt-out check, the channel's window, length, the business name on a first
   message, and an audit record of who sent what. Free text is a person speaking; the AI rule
   (rule 10) is unchanged: AI never writes a free-text reply on its own.
4. **Permissions the owner sets.** Capabilities instead of fixed roles: who can reply with
   templates, reply in their own words, approve, close, edit templates and AI instructions,
   manage channels, manage the team, see reporting. The owner always has all of them; staff get
   what the owner grants. Enforced on every API route, recorded in the audit trail.
5. **Workflows without a booking.** An **order support** workflow for product sellers: capture
   (any channel), ask for the order number, the item and what went wrong (with photos), then a
   person answers. No calendar, no offered times; setup skips hours and calendar.

## Iterations

Each iteration ends with the menu a little more finished, every check green, and mock data only
until Phase 4. Order is a proposal (decision 38).

### Iteration 1 — Settings, permissions and the free-text switch

The groundwork the rest depends on, all on mocks. **Built 2026-11-12** (changelog): the
Settings page, staff permissions, the free-text switch and composer for texts, the set-password
screen, and staff added by Fifth Stone Dev (`add-person`). Owners inviting staff themselves
from Settings waits on a decision (the API would need Supabase's admin key, server-side).

- **Settings page** (menu item, now "Soon"): business details and hours after setup, the Act now
  limit (decision 37), team, permissions and channel switches. Setup stays the first-run path;
  Settings is where things change later.
- **Team:** invite staff (an emailed or operator-sent set-password link), disable someone,
  approvers. Includes the **set-password screen** new owners need (gap found 2026-11-11).
- **Permissions** (decision 40): a capability list per business, owner-edited, enforced
  server-side; owners always hold every capability.
- **Free text over text messages** (decision 39, revising decision 26): the owner's switch, the
  `reply_free_text` capability, the composer on the lead page, server-side checks and audit.

### Iteration 2 — Email, web form and the channel model

The two channels that need no carrier approval, built on a model that fits every channel.

- **Contact identities and conversations per channel** (migration): phone, email and, later,
  social IDs on one contact; conversations keep their channel; inbound events carry a channel.
- **Email in:** forwarded inquiry address to SES receiving (ADR-0002 decision 8), parsed into a
  lead, threaded by message ID. **Email out:** template and free-text replies (decision 6 sender
  model), with the opt-out and unsubscribe rules for email.
- **Web form:** the public form ID, spam check and intake route from the v0.1 design; replies by
  email or text depending on what the customer gave.
- **Templates per channel:** an email reply can be longer than a text; each template gains a
  channel where it differs.

### Iteration 3 — Contacts page, order support, reporting

- **Contacts page** (menu item): every contact with every identity, booked jobs, voicemails and
  the full history across channels; possible duplicates suggested, merged only by a person.
- **Order support workflow** (decision 41) with Trailer Toad as the client to build it with: its
  questions, no booking step, the Front Desk queues it uses (Reply, Follow up), setup without
  hours and calendar. Order lookup from a store (Shopify and the like) stays in the backlog.
- **Reporting page** (menu item), version 1: leads by channel, time to first response, booked
  share for booking workflows, missed calls answered, Act now counts. The measures are agreed
  with the owner first.

### Iteration 4 — Real adapters (Phase 4), Messenger and Instagram first among social

Each adapter is run against a real test resource with the owner's approval before it is called
working (rule 5).

- Twilio (voice and texts), SES (email in and out), Google and Microsoft calendars, as already
  planned.
- **Meta: Messenger and Instagram, then WhatsApp** (decision 42): Fifth Stone Dev's Meta app,
  business verification and app review (weeks of lead time, so the paperwork starts in Iteration
  2); the business connects its Page, Instagram account and WhatsApp number in Settings; webhooks
  into the same intake; replies inside Meta's windows.
- **Reminders and follow-ups** (decision 43): appointment reminders on whichever channel the
  customer uses (texts, email, or Messenger's appointment-update messages), transactional only.

### Iteration 5 — Telegram and X

- **Telegram:** a Fifth Stone Dev bot the business connects in its Telegram Business settings;
  replies go out as the business.
- **X:** direct messages through X's pay-per-use API; usage is counted per business so the cost
  can be billed as the contract says.
- Both use the channel adapter shape from Iteration 2 and are switched on per business.

### Later

Store order lookup; texting from the business's existing number; per-user permission overrides.

Sources for the social platform table:
[X API pricing 2026 (bundle.social)](https://bundle.social/blog/x-api-pricing-2026-costs-limits),
[Hootsuite: WhatsApp coexistence](https://www.hootsuite.com/whats-new/whatsapp-coexistence-in-business-app-and-cloud-api),
[Telnyx: WhatsApp coexistence](https://telnyx.com/release-notes/whatsapp-coexistence),
[grammY: Telegram Business](https://grammy.dev/advanced/business),
[SendPulse: Telegram Business bots](https://sendpulse.com/en/knowledge-base/chatbot/telegram/telegram-business).

## Gaps found so far

Tracked in `BACKLOG.md` (ideas) or `DECISIONS_PENDING.md` (choices) as noted.

| Gap                                                                                                 | Where it goes                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| New owners and staff cannot set a password: `create` prints a link, the portal has no screen for it | Iteration 1                          |
| No way to invite staff; only the owner is created                                                   | Iteration 1                          |
| The Act now limit, hours and approvers can only change through Setup or the database                | Iteration 1 (Settings)               |
| Setup assumes a booking: hours and calendar are required even for a business that never books       | Iteration 3 (decision 41)            |
| No photos or attachments (MMS, Messenger images, email attachments), and no rules for keeping them  | Backlog; decision before Iteration 2 |
| No quiet hours for outbound texts                                                                   | Backlog                              |
| No new-lead alerts to staff beyond approval texts (email or push)                                   | Backlog                              |
| Templates are text-message sized; no per-channel wording                                            | Iteration 2                          |
| No reply-window tracking per channel (24-hour social window, email has none)                        | Iteration 2                          |
| No data export or delete for a business (offboarding)                                               | Backlog (operator CLI)               |
| Operator CLI uses the admin connection and does not record which person ran it                      | Before the first staging run         |
