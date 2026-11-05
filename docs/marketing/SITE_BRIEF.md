---
title: 'Marketing Site Brief'
product: 'Fifth Stone Connect'
organization: 'Fifth Stone Dev'
status: 'Draft'
version: '0.2'
owner: 'Fifth Stone Dev'
last_updated: '2026-11-03'
---

# Marketing Site Brief

Brief for the Fifth Stone Connect landing page at `connect.fifthstonedev.com`, rewritten for
[SCOPE.md v0.2](../product/SCOPE.md). Built and reviewed locally first; no deployment or DNS
changes without owner approval. The page currently in `apps/marketing/` was built from the
v0.1 brief and needs a rework against this version.

## Goal

Show owners of 1–20 person businesses that a missed call can still become a booked job, then
let them find their industry and invite a conversation with Fifth Stone Dev.

## The problem it solves

- Calls missed while working, and the caller dials the next business
- First replies that come too late and carry no useful questions
- Times never offered, so the customer waits or goes elsewhere
- No clear view of which leads need attention today

## Page structure

1. **Hero:** one honest promise, for example "When you can't pick up, the conversation keeps
   going."
2. **How it works:** five-step strip (missed call → text back → details gathered → times
   offered → you approve), no industry specifics.
3. **Pick your business:** industry tiles. Each tile has one pain line and three things it
   does:
   - Tattoo studios: booking requests, waivers, deposits
   - HVAC and plumbing: missed-call text-back, urgency triage, same-day slots
   - Contractors: estimate requests, site-visit scheduling, estimate follow-up
   - Clinics and practices: appointment requests, waitlist backfill, no clinical details by
     text
4. **Industry section** for each tile: a sample text thread, what the owner approves, what
   stays the same (their phone, calendar and tools).
5. **Owner portal:** a mock of the Today dashboard and an approval, modeled on the WayMaker
   Ink request portal.
6. **Getting started:** pick your business, business details, connect calendar, review your
   questions, choose approvers, test call.
7. **Soft call to action** to talk with Fifth Stone Dev.

## Constraints

- Brand: **Fifth Stone Connect, from Fifth Stone Dev**. v0.2 offer name pending; describe the
  workflow plainly.
- Domain: `connect.fifthstonedev.com` (canonical URL and meta tags may use it; nothing deployed).
- Tone: warm, practical, understated. The reader may have been burned by an agency before.
- No invented statistics, testimonials, logos, certifications, or claims like
  "never miss a lead" / "fully hands-off".
- Only the tattoo playbook has a delivered reference build. Other tiles describe the
  playbook, not past results. No client names without written permission.
- Clinic tile states that no clinical details are collected by text.
- Missed-call texts come from the Fifth Stone Connect number, not the number dialed; don't
  imply otherwise.
- No pricing and no third-party vendor prices.
- Use the brand assets recorded in `docs/brand/STYLE_GUIDE.md`.
- Location: `apps/marketing/`. Add a changelog entry.
