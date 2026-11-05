/**
 * Scope v0.2 states (SYSTEM_OVERVIEW.md, States). The database enforces the same lists with check
 * constraints; `tests/schema-constants.test.ts` fails if the two drift apart.
 */

export const LEAD_STATES = [
  'new',
  'clarifying',
  'offered',
  'requested',
  'booked',
  'needs_attention',
  'quiet',
  'closed',
  'spam',
  'opted_out',
] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const LEAD_SOURCES = ['missed_call', 'text', 'email', 'form'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Numbered for customers: 1 emergency today, 2 this week, 3 flexible. */
export const URGENCIES = ['emergency', 'this_week', 'flexible'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const REQUEST_STATES = ['pending', 'approved', 'changed', 'declined', 'expired'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const HOLD_STATES = ['active', 'converted', 'released'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** Portal lanes are queries over lead states (SYSTEM_OVERVIEW.md). */
export const LANE_STATES = {
  needsYou: ['needs_attention', 'requested'],
  waitingOnCustomer: ['new', 'clarifying', 'offered'],
  booked: ['booked'],
  wentQuiet: ['quiet'],
} as const satisfies Record<string, readonly LeadState[]>;
