/**
 * Response shapes of the portal API (apps/api/src/app.ts, where they are Zod schemas validated on
 * the way out). Kept in step by hand for now; the portal never invents fields the API does not
 * send.
 */

export type LeadState =
  | 'new'
  | 'clarifying'
  | 'offered'
  | 'requested'
  | 'booked'
  | 'needs_attention'
  | 'quiet'
  | 'closed'
  | 'spam'
  | 'opted_out';

export type Urgency = 'emergency' | 'this_week' | 'flexible';

export type ServiceState = 'not_started' | 'submitted' | 'approved' | 'rejected' | 'disabled';

export interface Me {
  displayName: string;
  role: 'owner' | 'staff';
  tenant: { name: string; slug: string; timezone: string };
  services: { texting: ServiceState; email: ServiceState };
  calendar: {
    provider: 'google' | 'acuity';
    status: 'connected' | 'revoked' | 'disconnected';
  } | null;
}

export interface LeadCard {
  id: string;
  name: string | null;
  phone: string | null;
  summary: string | null;
  state: LeadState;
  reason: string | null;
  urgency: Urgency | null;
  createdAt: string;
  slotStart: string | null;
}

export interface Today {
  lanes: {
    needsYou: LeadCard[];
    waitingOnCustomer: LeadCard[];
    booked: LeadCard[];
    wentQuiet: LeadCard[];
  };
}
