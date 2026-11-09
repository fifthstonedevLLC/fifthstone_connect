import { JOB_STATUSES, SERVICE_REGISTRATION_STATES } from '@fsc/core';
import { CALENDAR_PROVIDERS } from '@fsc/core/calendar-providers';
import { z } from 'zod';
import { MockEmailSchema, MockPhoneSchema } from './schemas.js';

/**
 * Settings and operations data from docs/product/MOCK_DATA.md: per-tenant services, calendars,
 * settings versions (Riverbend has two, for restore-previous, case X-06), jobs in every status
 * (X-09), opt-outs (Wes, RB-12, X-07; Ray, PP-08), email events (Ana, RB-07 and RB-21; Mei's
 * complaint, X-08) and the audit trail.
 */

const TenantOpsSchema = z
  .object({
    tenant: z.string().regex(/^T\d+$/),
    texting: z.enum(SERVICE_REGISTRATION_STATES),
    email: z.enum(SERVICE_REGISTRATION_STATES),
    calendar: z
      .object({
        provider: z.enum(CALENDAR_PROVIDERS),
        status: z.enum(['connected', 'revoked', 'disconnected']),
      })
      .strict(),
    /** Business hours: ISO weekdays 1-7 with 24-hour open and close. */
    hours: z
      .array(
        z
          .object({
            days: z.array(z.number().int().min(1).max(7)),
            open: z.string().regex(/^\d\d:\d\d$/),
            close: z.string().regex(/^\d\d:\d\d$/),
          })
          .strict(),
      )
      .min(1),
    /**
     * Busy times on the connected calendar (the owner's own events), as the worker's sync would
     * store them: days from today in the business's time zone, a local start and a length.
     */
    busy: z
      .array(
        z
          .object({
            day: z.number().int().min(-7).max(21),
            at: z.string().regex(/^\d\d:\d\d$/),
            minutes: z.number().int().min(15).max(600),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export const TENANT_OPS = [
  {
    tenant: 'T1',
    texting: 'approved',
    email: 'submitted',
    calendar: { provider: 'google', status: 'connected' },
    hours: [
      { days: [1, 2, 3, 4, 5], open: '07:00', close: '18:00' },
      { days: [6], open: '08:00', close: '12:00' },
    ],
    busy: [
      { day: 0, at: '12:00', minutes: 60 },
      { day: 1, at: '07:00', minutes: 90 },
      { day: 2, at: '13:00', minutes: 120 },
      { day: 3, at: '16:00', minutes: 60 },
      { day: 4, at: '07:00', minutes: 240 },
      { day: 7, at: '09:00', minutes: 120 },
      { day: 9, at: '14:00', minutes: 60 },
    ],
  },
  {
    tenant: 'T2',
    // Approved after Trey's call (NL-08), which came in while registration was still pending.
    texting: 'approved',
    email: 'approved',
    calendar: { provider: 'acuity', status: 'connected' },
    hours: [{ days: [2, 3, 4, 5, 6], open: '11:00', close: '19:00' }],
    busy: [
      { day: 1, at: '11:00', minutes: 120 },
      { day: 3, at: '15:00', minutes: 60 },
    ],
  },
  {
    tenant: 'T3',
    texting: 'approved',
    email: 'approved',
    calendar: { provider: 'microsoft', status: 'connected' },
    hours: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' }],
    busy: [
      { day: 0, at: '12:00', minutes: 60 },
      { day: 2, at: '08:00', minutes: 60 },
      { day: 4, at: '13:00', minutes: 180 },
    ],
  },
  {
    tenant: 'T4',
    texting: 'disabled',
    email: 'disabled',
    calendar: { provider: 'google', status: 'disconnected' },
    hours: [{ days: [1, 2, 3, 4, 5], open: '07:00', close: '16:00' }],
  },
].map((t) => TenantOpsSchema.parse(t));

/** Base templates; `{business}` is filled with the tenant's name when versions are seeded. */
const BASE_TEMPLATES = {
  missed_call_text_back:
    'Sorry we missed your call! This is {business}. What can we help with? Reply STOP to opt out.',
  slot_offer: 'Thanks. Here are open times. Reply with a number: {slots}',
  request_received: "Got it, {slot} is requested. We'll text you a confirmation shortly.",
  confirmation: "You're booked with {business} for {slot}. Reply STOP to opt out.",
  approval_request:
    'New request: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
  out_of_scope:
    "Thanks for reaching out to {business}. That's not work we do, sorry we can't help.",
  // Replies staff can send from the portal (decision 26). `{name}` is the customer's first name.
  reply_will_call: 'Thanks, {name}. Someone from {business} will call you shortly.',
  reply_need_address: 'Thanks, {name}. Could you text us the address for the visit?',
  reply_after_hours:
    "Thanks for reaching out to {business}. We're closed right now and will reply when we open.",
};

const SettingsVersionSchema = z
  .object({
    tenant: z.string().regex(/^T\d+$/),
    version: z.number().int().min(1),
    active: z.boolean(),
    createdBy: z
      .string()
      .regex(/^U-\d{2}$/)
      .optional(),
    minutesAgo: z.number().int().min(0),
    templates: z.record(z.string().regex(/^[a-z][a-z_]+$/), z.string().min(1).max(1600)),
    ai: z.record(z.string(), z.unknown()),
  })
  .strict();

const riverbendAi = {
  what_we_do:
    'Residential furnace, AC, heat pump and water heater repair, maintenance and installs.',
  what_we_dont_do: ['Commercial buildings', 'Irrigation and sprinklers'],
  emergency:
    'No heat in cold weather, gas smell, active leaks. AC only when someone is at medical risk.',
  questions: [
    'What is the problem?',
    'What is the address?',
    'How soon: 1 today, 2 this week, 3 flexible?',
  ],
  tone: 'Plain and friendly. Short sentences.',
};

export const SETTINGS_VERSIONS = [
  {
    tenant: 'T1',
    version: 1,
    active: false,
    minutesAgo: 20160,
    templates: BASE_TEMPLATES,
    ai: { ...riverbendAi, tone: 'Friendly.' },
  },
  {
    tenant: 'T1',
    version: 2,
    active: true,
    createdBy: 'U-01',
    minutesAgo: 4320,
    templates: {
      ...BASE_TEMPLATES,
      missed_call_text_back:
        'Sorry we missed your call! This is {business}. Sounds like {need}. {question} Reply STOP to opt out.',
    },
    ai: riverbendAi,
  },
  {
    tenant: 'T2',
    version: 1,
    active: true,
    minutesAgo: 20160,
    templates: BASE_TEMPLATES,
    ai: { tone: 'Warm.' },
  },
  {
    tenant: 'T3',
    version: 1,
    active: true,
    minutesAgo: 20160,
    templates: {
      ...BASE_TEMPLATES,
      missed_call_text_back:
        'Thanks, {business} received your request. Our front desk will confirm a time with you. Reply STOP to opt out.',
    },
    ai: { minimum_data: true },
  },
  {
    tenant: 'T4',
    version: 1,
    active: true,
    minutesAgo: 40000,
    templates: BASE_TEMPLATES,
    ai: { tone: 'Plain.' },
  },
].map((v) => SettingsVersionSchema.parse(v));

const JobSchema = z
  .object({
    lead: z.string().regex(/^[A-Z]{2}-\d{2}$/),
    action: z.string().regex(/^[a-z][a-z_]+$/),
    status: z.enum(JOB_STATUSES),
    attempts: z.number().int().min(0).max(5),
    /** When the job is or was due, relative to now. */
    runInMinutes: z.number().int(),
    /** For a running job: lease end relative to now (negative means a crashed worker, X-04). */
    leaseInMinutes: z.number().int().optional(),
    error: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
  })
  .strict();

const done = (lead: string, action: string, minutesAgo: number) => ({
  lead,
  action,
  status: 'succeeded' as const,
  attempts: 1,
  runInMinutes: -minutesAgo,
});

export const JOBS = [
  done('RB-01', 'send_text_back', 59),
  done('RB-01', 'emergency_alert', 58),
  done('RB-02', 'send_text_back', 146),
  done('RB-02', 'place_hold', 130),
  done('RB-02', 'send_approval_request', 129),
  { lead: 'RB-02', action: 'approval_reminder', status: 'queued', attempts: 0, runInMinutes: 30 },
  done('RB-03', 'send_text_back', 163),
  {
    lead: 'RB-04',
    action: 'send_clarifying_question',
    status: 'failed',
    attempts: 1,
    runInMinutes: 4,
    error: 'rate_limited',
  },
  done('RB-06', 'send_confirmation', 1400),
  done('RB-07', 'send_confirmation_email', 2800),
  done('RB-09', 'send_safety_message', 40),
  {
    lead: 'RB-11',
    action: 'transcribe_voicemail',
    status: 'running',
    attempts: 1,
    runInMinutes: -34,
    leaseInMinutes: -2,
  },
  {
    lead: 'RB-12',
    action: 'send_slot_offer',
    status: 'skipped',
    attempts: 0,
    runInMinutes: -1990,
    error: 'opted_out',
  },
  {
    lead: 'RB-22',
    action: 'send_text_back',
    status: 'dead',
    attempts: 5,
    runInMinutes: -60,
    error: 'undelivered',
  },
  { lead: 'NL-01', action: 'approval_reminder', status: 'queued', attempts: 0, runInMinutes: 45 },
  { lead: 'NL-12', action: 'send_slot_offer', status: 'queued', attempts: 0, runInMinutes: 0 },
  done('NL-07', 'send_confirmation_email', 4200),
  done('NL-08', 'send_owner_alert_email', 7299),
  done('PP-05', 'send_confirmation', 1960),
  done('PP-07', 'send_crisis_message', 599),
  done('PP-07', 'alert_front_desk', 599),
  done('OM-01', 'send_confirmation', 35900),
].map((j) => JobSchema.parse(j));

export const OPT_OUTS = [
  { tenant: 'T1', phone: MockPhoneSchema.parse('+13195550120'), minutesAgo: 1995 },
  { tenant: 'T3', phone: MockPhoneSchema.parse('+13195550149'), minutesAgo: 2990 },
];

export const EMAIL_EVENTS = [
  {
    tenant: 'T1',
    messageRef: 'MOCK-EM-RB-07-CONF',
    recipient: MockEmailSchema.parse('ana@example.org'),
    status: 'delivered',
    minutesAgo: 2795,
  },
  {
    tenant: 'T1',
    messageRef: 'MOCK-EM-RB-21-REMINDER',
    recipient: MockEmailSchema.parse('ana@example.org'),
    status: 'bounced',
    minutesAgo: 600,
  },
  // A delivered confirmation the recipient later marked as spam (X-08).
  {
    tenant: 'T2',
    messageRef: 'MOCK-EM-NL-07-CONF',
    recipient: MockEmailSchema.parse('mei@example.org'),
    status: 'delivered',
    minutesAgo: 4195,
  },
  {
    tenant: 'T2',
    messageRef: 'MOCK-EM-NL-07-CONF',
    recipient: MockEmailSchema.parse('mei@example.org'),
    status: 'complained',
    minutesAgo: 4000,
  },
] as const;
