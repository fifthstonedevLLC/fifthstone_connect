import type { CalendarProviderKey } from '@fsc/core/calendar-providers';
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

export type SetupStage = 'setting_up' | 'ready' | 'live';

export type Capability = 'act_on_leads' | 'reply_templates' | 'reply_free_text' | 'edit_templates';

/** The Settings page (Iteration 1): team, staff permissions, free text, Act now limit. */
export interface BusinessSettings {
  canEdit: boolean;
  team: {
    id: string;
    name: string;
    role: 'owner' | 'staff';
    mobile: string | null;
    approvesRequests: boolean;
    active: boolean;
  }[];
  staffCapabilities: Capability[];
  freeTextChannels: 'sms'[];
  actNowAfterHours: number;
  texting: { state: ServiceState; declined: boolean };
}

export interface Me {
  displayName: string;
  role: 'owner' | 'staff';
  tenant: { name: string; slug: string; timezone: string };
  /** Only a live business gets the working pages (decision 35). */
  stage: SetupStage;
  /** The owner chose to go without texting (decision 36). */
  textingDeclined: boolean;
  /** What this person can do (decision 40). */
  capabilities: Capability[];
  /** Channels where free-text replies are switched on (decision 39). */
  freeTextChannels: 'sms'[];
  services: { texting: ServiceState; email: ServiceState };
  calendar: {
    provider: CalendarProviderKey;
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
  /** When the pending request's held time is released if nobody decides. */
  holdExpiresAt: string | null;
  /** Set by the server: an emergency, safety or crisis lead, shown first and flagged. */
  urgent: boolean;
  /** When the lead entered its current state. */
  waitingSince: string;
  /** What it needs from a person and the one action that fits, decided by the server. */
  next: { need: Need; action: NextAction | null };
}

export type Need =
  | 'call_now'
  | 'approve'
  | 'call_back'
  | 'reply'
  | 'reschedule'
  | 'cancel'
  | 'listen'
  | 'review'
  | 'confirming'
  | 'their_move'
  | 'booked'
  | 'follow_up'
  | 'nudged';

export type NextAction = 'call' | 'approve' | 'nudge' | 'reply' | 'reschedule' | 'listen' | 'open';

export interface Today {
  lanes: {
    needsYou: LeadCard[];
    waitingOnCustomer: LeadCard[];
    booked: LeadCard[];
    wentQuiet: LeadCard[];
  };
  /** How long a lead may wait on this business before it goes to Act now (decision 37). */
  actNowAfterHours: number;
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
  /** What it needs from a person and the one action that fits, decided by the server. */
  next: { need: Need; action: NextAction | null; urgent: boolean };
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
  ai: { versions: SettingsVersion<AiSettings>[] };
}

export type SettingsKind = 'templates' | 'ai';

export type OnboardingStep =
  'business_type' | 'details' | 'hours' | 'templates' | 'team' | 'test' | 'texting';

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
    approverChannel: 'text' | 'portal';
    trade: { key: string; name: string } | null;
    jobMinutes: number;
    confirmedAt: string | null;
  } | null;
  details: (BusinessDetails & { updatedAt: string }) | null;
  hours: HoursBlock[];
  timezone: string;
  calendar: {
    provider: CalendarProviderKey;
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
  application: {
    ready: boolean;
    submittedAt: string | null;
    declinedAt: string | null;
    registration: ServiceState;
    preview: { useCase: string; optIn: string; sampleMessages: string[] } | null;
  };
  stage: SetupStage;
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

/** GET /portal/calendar: a run of days in the business's time zone. */
export interface CalendarView {
  timeZone: string;
  from: string;
  days: number;
  hours: { days: number[]; open: string; close: string }[];
  jobMinutes: number;
  connection: {
    provider: CalendarProviderKey;
    status: 'connected' | 'revoked' | 'disconnected';
    lastSyncedAt: string | null;
  } | null;
  appointments: Appointment[];
  /** Busy time synced from the connected calendar: start and end only. */
  busy: { start: string; end: string }[];
  /** Slots still open for a job of `jobMinutes`, from now on. */
  open: { start: string; end: string }[];
  capacity: { date: string; openMinutes: number; freeMinutes: number }[];
}

export interface Appointment {
  leadId: string;
  name: string | null;
  phone: string | null;
  summary: string | null;
  /** Where the job is, if the customer gave one. */
  address: string | null;
  start: string;
  end: string;
  status: 'held' | 'confirming' | 'booked';
  holdExpiresAt: string | null;
}
