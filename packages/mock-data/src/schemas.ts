import {
  HOLD_STATES,
  LEAD_SOURCES,
  LEAD_STATES,
  REQUEST_STATES,
  TENANT_STATUSES,
  URGENCIES,
  normalizeEmail,
  normalizePhone,
} from '@fsc/core';
import { z } from 'zod';

/**
 * The mock data rules from docs/product/MOCK_DATA.md, as schemas. Every catalog entry is parsed
 * through these, so a real-looking value can never reach a seed file.
 */

export const MockPhoneSchema = z
  .string()
  .refine((v) => normalizePhone(v) === v, { message: 'Phone number must be normalized E.164' })
  .refine((v) => /^\+131955501\d\d$/.test(v), {
    message: 'Mock phone numbers must be +1 319 555-0100 to 555-0199',
  });

export const MockEmailSchema = z
  .email()
  .refine((v) => normalizeEmail(v) === v, { message: 'Email must be normalized' })
  .refine((v) => /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/.test(v), {
    message: 'Mock email addresses must use example.com, .org or .net',
  });

export const PLAYBOOKS = ['hvac', 'tattoo', 'clinic', 'contractor'] as const;

export const MockTenantSchema = z
  .object({
    key: z.string().regex(/^T\d+$/),
    // Same shape the database enforces on app.tenants.slug, plus the `mock-` prefix.
    slug: z.string().regex(/^mock-[a-z0-9-]{1,57}[a-z0-9]$/, 'Mock tenant slugs start with mock-'),
    name: z.string().min(1).max(120),
    status: z.enum(TENANT_STATUSES),
    timezone: z.string().refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Unknown time zone' },
    ),
    playbook: z.enum(PLAYBOOKS),
    connectNumber: MockPhoneSchema,
  })
  .strict();

export const MockPortalUserSchema = z
  .object({
    key: z.string().regex(/^U-\d{2}$/),
    tenant: z.string().regex(/^T\d+$/),
    name: z.string().min(1).max(120),
    role: z.enum(['owner', 'staff']),
    email: MockEmailSchema,
    mobile: MockPhoneSchema,
  })
  .strict();

export type MockTenant = z.output<typeof MockTenantSchema>;
export type MockPortalUser = z.output<typeof MockPortalUserSchema>;

export const MockContactSchema = z
  .object({
    key: z.string().regex(/^C-[A-Z]{2}-\d{2}$/),
    tenant: z.string().regex(/^T\d+$/),
    name: z.string().min(1).max(120).optional(),
    phone: MockPhoneSchema,
    email: MockEmailSchema.optional(),
  })
  .strict();

export const MockVoicemailSchema = z
  .object({
    /** Evaluation-set code from MOCK_DATA.md, e.g. VM-02. */
    code: z.string().regex(/^VM-\d{2}$/),
    transcript: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
    seconds: z.number().int().min(1).max(600),
  })
  .strict();

export const MockMessageSchema = z
  .object({
    direction: z.enum(['in', 'out']),
    /** Outbound only: the template that produced it. */
    template: z
      .string()
      .regex(/^[a-z][a-z_]+$/)
      .optional(),
    body: z.string().min(1).max(1600),
    minutesAgo: z.number().int().min(0),
  })
  .strict()
  .refine((m) => (m.direction === 'out') === (m.template !== undefined), {
    message: 'Outbound mock messages name their template; inbound ones do not',
  });

export const MockRequestSchema = z
  .object({
    state: z.enum(REQUEST_STATES),
    /** Slot start, in hours from now (negative is past). Slots are one hour. */
    slotInHours: z.number().int(),
    decidedBy: z
      .string()
      .regex(/^U-\d{2}$/)
      .optional(),
    decidedVia: z.enum(['text', 'portal']).optional(),
    hold: z.enum(HOLD_STATES).optional(),
  })
  .strict()
  .refine(
    (r) => (r.decidedBy !== undefined) === ['approved', 'changed', 'declined'].includes(r.state),
    {
      message: 'Decided requests name who decided; pending and expired ones do not',
    },
  );

export const MockLeadSchema = z
  .object({
    key: z.string().regex(/^[A-Z]{2}-\d{2}$/),
    tenant: z.string().regex(/^T\d+$/),
    contact: z.string().regex(/^C-[A-Z]{2}-\d{2}$/),
    source: z.enum(LEAD_SOURCES),
    state: z.enum(LEAD_STATES),
    reason: z
      .string()
      .regex(/^[a-z][a-z_]+$/)
      .optional(),
    urgency: z.enum(URGENCIES).optional(),
    category: z
      .string()
      .regex(/^[a-z][a-z_]+$/)
      .optional(),
    summary: z.string().min(1).max(500),
    address: z.string().max(300).optional(),
    minutesAgo: z.number().int().min(0),
    voicemail: MockVoicemailSchema.optional(),
    messages: z.array(MockMessageSchema).optional(),
    request: MockRequestSchema.optional(),
  })
  .strict();

export type MockContact = z.output<typeof MockContactSchema>;
export type MockLead = z.output<typeof MockLeadSchema>;
export type MockRequest = z.output<typeof MockRequestSchema>;
