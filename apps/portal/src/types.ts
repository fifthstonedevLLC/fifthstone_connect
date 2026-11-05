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
  requestState: 'pending' | 'approved' | 'changed' | null;
  /** Set by the server: an emergency, safety or crisis lead, shown first and flagged. */
  urgent: boolean;
}

export interface Today {
  lanes: {
    needsYou: LeadCard[];
    waitingOnCustomer: LeadCard[];
    booked: LeadCard[];
    wentQuiet: LeadCard[];
  };
}

export type LeadSource = 'missed_call' | 'text' | 'email' | 'form';
export type RequestState = 'pending' | 'approved' | 'changed' | 'declined' | 'expired';
export type HoldState = 'active' | 'converted' | 'released';

export interface LeadDetail {
  id: string;
  source: LeadSource;
  state: LeadState;
  reason: string | null;
  urgency: Urgency | null;
  category: string | null;
  summary: string | null;
  address: string | null;
  createdAt: string;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    earlierLeads: number;
  };
  voicemail: {
    durationSeconds: number;
    transcript: string | null;
    confidence: number | null;
    receivedAt: string;
  } | null;
  messages: {
    id: string;
    direction: 'in' | 'out';
    author: 'customer' | 'template' | 'staff' | 'ai_question';
    templateKey: string | null;
    body: string;
    deliveryStatus: 'received' | 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
    occurredAt: string;
  }[];
  request: {
    state: RequestState;
    slotStart: string;
    slotEnd: string;
    decidedAt: string | null;
    decidedVia: 'text' | 'portal' | null;
    decidedByName: string | null;
    hold: { state: HoldState; expiresAt: string } | null;
  } | null;
  pendingWork: { actionType: string; status: 'queued' | 'running' | 'failed' | 'dead' }[];
  replyOptions: { key: string; body: string }[];
}

export type PortalAction = 'approve' | 'suggest_time' | 'nudge' | 'close';

export interface SettingsVersion<T> {
  version: number;
  active: boolean;
  createdAt: string;
  createdByName: string | null;
  content: T;
}

export interface AiSettings {
  what_we_do?: string;
  what_we_dont_do?: string[];
  emergency?: string;
  questions?: string[];
  tone?: string;
}

export interface Settings {
  canEdit: boolean;
  businessName: string;
  templates: { versions: SettingsVersion<Record<string, string>>[] };
  ai: { available: boolean; versions: SettingsVersion<AiSettings>[] };
}

export type SettingsKind = 'templates' | 'ai';

export type OnboardingStep = 'business_type' | 'details' | 'hours' | 'templates' | 'team' | 'test';

export interface HoursBlock {
  days: number[];
  open: string;
  close: string;
}

export interface BusinessDetails {
  legalName: string;
  ein?: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  website?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export interface Onboarding {
  canEdit: boolean;
  steps: { key: OnboardingStep; done: boolean }[];
  businessType: {
    key: string;
    name: string;
    description: string;
    minimumData: boolean;
    approverChannel: 'text' | 'portal';
    confirmedAt: string | null;
  } | null;
  details: (BusinessDetails & { updatedAt: string }) | null;
  hours: HoursBlock[];
  timezone: string;
  calendar: {
    provider: 'google' | 'acuity';
    status: 'connected' | 'revoked' | 'disconnected';
  } | null;
  templates: { version: number | null; reviewedAt: string | null; questions: string[] };
  team: {
    id: string;
    name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approvesRequests: boolean;
  }[];
  test: { simulatedAt: string | null };
  connectNumber: string | null;
}

/** One step of the simulated test call (nothing was sent). */
export type TestCallStep =
  | { kind: 'missed_call'; to: string | null; from: string | null }
  | { kind: 'text_to_caller'; templateKey: string; body: string | null }
  | { kind: 'caller_replies'; body: string }
  | {
      kind: 'approval_request';
      channel: 'text' | 'portal';
      approver: string | null;
      body: string | null;
    }
  | { kind: 'approver_approves'; channel: 'text' | 'portal' };
