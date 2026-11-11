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
3. **Pick your business:** one tile per workflow (decision 34), each naming its trades, with
   one pain line and three things it does. Only describe what is built:
   - Service call (heating and cooling, plumbing, electrical, garage doors): missed-call
     text-back, how-soon question, visit times
   - Estimate visit (roofing, remodeling, painting, landscaping): project questions, estimate
     visit times, you approve by text
   - Recurring service (lawn care, cleaning, pools, pest control): first-visit booking, how-often
     question, you set up the schedule
   - Studio appointment (tattoo, salon or barber, pet grooming, photography): booking requests,
     approval at the front desk
   - Shop drop-off (auto, small engine, phone and computer, bike): what's wrong, drop-off times
   - Each tile links to "other" businesses of the same kind. No healthcare tile: clinics and
     practices are out of scope (decision 33)
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
- Only the tattoo studio trade has a delivered reference build. Other tiles describe the
  workflow, not past results. Waivers, deposits and estimate follow-up are not built; don't
  list them. No client names without written permission.
- Missed-call texts come from the Fifth Stone Connect number, not the number dialed; don't
  imply otherwise.
- No pricing and no third-party vendor prices.
- Use the brand assets recorded in `docs/brand/STYLE_GUIDE.md`.
- Location: `apps/marketing/`. Add a changelog entry.
