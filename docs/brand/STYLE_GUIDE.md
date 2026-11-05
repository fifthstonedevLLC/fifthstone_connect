---
title: 'Writing and Brand Style Guide'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.1'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-03'
---

# Writing and Brand Style Guide

How Fifth Stone Dev writes about this service, internally and to customers. Values marked
**TBD** are not approved and must not be invented.

## Names

| Item                   | Value                                                                                     | Status                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Company (master brand) | Fifth Stone Dev                                                                           | Approved                                                                      |
| Legal entity           | Fifth Stone Dev LLC                                                                       | Approved                                                                      |
| Service name           | Fifth Stone Connect                                                                       | Approved for public use 2026-11-03 (provisional — trademark search pending)   |
| Offer name             | v0.2 name pending. "Inquiry-to-Action" described the v0.1 offer; do not use it for v0.2   | Pending                                                                       |
| Service domain         | connect.fifthstonedev.com                                                                 | Approved 2026-11-03 — DNS not yet configured; DNS changes need owner approval |
| Logo for this service  | **TBD** — no Fifth Stone Connect mark; use the Fifth Stone Dev logo (supplied 2026-11-03) |                                                                               |
| Colors / fonts         | Fifth Stone Dev palette, Archivo + Space Mono (see Visual identity)                       | Supplied by owner 2026-11-03                                                  |

In customer-facing material: "Fifth Stone Connect, from Fifth Stone Dev." Until a v0.2 offer
name is approved, describe the workflow plainly ("when you can't pick up, the conversation keeps
going").

## Audience

Owners and office managers of 1–20 person businesses where the person doing the work also
answers the phone: service trades, contractors, tattoo studios, small clinics and practices.
Practical, busy, often skeptical of agencies and software pitches. Not technical.

## Voice

Practical, direct, professional, understated.

- Say what the system does, plainly: "When someone fills out your form, they get a confirmation
  email and the request lands in your spreadsheet."
- State limits honestly: business-hours support, no 24/7 coverage, no compliance certification.
- Prefer concrete nouns (form, spreadsheet, email) over abstractions (pipeline, ecosystem).

### Do not use

- Absolute claims: "never miss a lead", "fully hands-off", "100% reliable", "guaranteed".
- Buzzwords: "AI-powered", "seamless", "revolutionary", "supercharge", "synergy".
- Invented statistics, testimonials, customer logos, or certifications.
- Third-party vendor prices in customer-facing documents (they change).

## Customer messages (transactional)

The acknowledgment and alert emails are sent on the customer's behalf. They must:

- Identify the business by name, not Fifth Stone Dev.
- Confirm receipt and set an honest expectation ("We'll be in touch within one business day" —
  only if the customer commits to that).
- Contain no marketing, upsell, or tracking beyond SES delivery events.
- Be approved by the customer before launch.

## Internal documentation

- Frontmatter block on every doc (see `docs/README.md`).
- Summary first, details after. Decisions and open questions separated.
- Commands in copyable code blocks. Dates as `YYYY-MM-DD`.
- When a result came from a mock, say so.

## Visual identity

Source: owner's `FINAL-brand-guide.html` and `fifth-stone-brand.css` (Fifth Stone Dev LLC
OneDrive, Branding folder), supplied 2026-11-03. Implemented in
`apps/marketing/public/tokens.css`.

| Role             | Name           | Hex       |
| ---------------- | -------------- | --------- |
| Primary          | Stone Slate    | `#2C3E50` |
| Headers, text    | Stone Charcoal | `#1A252F` |
| Primary accent   | Accent Bronze  | `#B8956A` |
| Secondary text   | Stone River    | `#5D6D7E` |
| Borders          | Stone Sand     | `#BDC3C7` |
| Backgrounds      | Stone Light    | `#ECF0F1` |
| Secondary accent | Accent Sage    | `#7D9D8E` |

Fonts: Archivo (headings 700, body 400) and Space Mono (labels, code).

**Contrast rule:** Bronze is about 2.8:1 against white, so it is never used for text or with
white text. Bronze buttons carry Charcoal text (about 5.6:1). This differs from
`fifth-stone-brand.css`, which pairs Bronze with white; owner to confirm.

## Missing brand assets

- [ ] Fifth Stone Dev logo as SVG (PNG supplied 2026-11-03; SVGs listed in the brand README were
      not in the folder)
- [x] Brand colors and fonts (2026-11-03)
- [ ] A Fifth Stone Connect mark, if one is wanted
- [x] Public name for this service — Fifth Stone Connect (2026-11-03)
- [x] Service domain — connect.fifthstonedev.com (2026-11-03)
- [ ] Trademark search on "Fifth Stone Connect"
- [ ] Hosted-form subdomain (candidate: forms.connect.fifthstonedev.com)
