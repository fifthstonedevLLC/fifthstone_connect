import { z } from 'zod';
import { cleanLine, cleanText, normalizeEmail, normalizePhone } from './normalize.js';

/**
 * Canonical lead shape.
 *
 * Business rules:
 * - `name` is required.
 * - At least one of `email` or `phone` is required, so the business can reply.
 * - Everything else is optional and length-capped to keep stored PII minimal.
 */

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LeadStatusSchema = z.enum(LEAD_STATUSES);

export const PREFERRED_CONTACT = ['email', 'phone', 'text', 'any'] as const;

export const LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  service: 120,
  address: 300,
  message: 2000,
  url: 2048,
} as const;

const optionalLine = (max: number) =>
  z
    .string()
    .transform(cleanLine)
    .pipe(z.string().max(max))
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const optionalText = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max))
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/**
 * Raw contact fields as received from a form or webhook (after field mapping).
 * Output is the normalized lead content.
 */
export const LeadInputSchema = z
  .object({
    name: z
      .string()
      .transform(cleanLine)
      .pipe(
        z
          .string()
          .min(1, 'Name is required')
          .max(LIMITS.name, `Name must be ${LIMITS.name} characters or fewer`),
      ),
    email: z
      .string()
      .transform(normalizeEmail)
      .pipe(z.union([z.literal(''), z.email('Enter a valid email address').max(LIMITS.email)]))
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    phone: z
      .string()
      .max(LIMITS.phone)
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || cleanLine(v) === '') return undefined;
        const e164 = normalizePhone(v);
        if (e164 === null) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
          return z.NEVER;
        }
        return e164;
      }),
    service: optionalLine(LIMITS.service),
    address: optionalLine(LIMITS.address),
    message: optionalText(LIMITS.message),
    preferredContact: z.enum(PREFERRED_CONTACT).optional(),
  })
  .strict()
  .refine((lead) => lead.email !== undefined || lead.phone !== undefined, {
    message: 'Provide an email address or phone number',
    path: ['email'],
  });

export type LeadInput = z.input<typeof LeadInputSchema>;
export type LeadContent = z.output<typeof LeadInputSchema>;

/** A stored lead. `tenantId` is always present; queries are tenant-scoped. */
export interface Lead extends LeadContent {
  id: string;
  tenantId: string;
  inboundEventId: string;
  status: LeadStatus;
  createdAt: Date;
  updatedAt: Date;
  /** When the staff reminder becomes due if the lead is still unresolved. */
  reminderDueAt: Date | null;
}

/** Allowed status changes. `spam` and `closed` can be reopened to `new` by the operator. */
const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['contacted', 'closed', 'spam'],
  contacted: ['closed', 'spam', 'new'],
  closed: ['new'],
  spam: ['new'],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A lead is unresolved — and eligible for a staff reminder — only while `new`. */
export function isUnresolved(status: LeadStatus): boolean {
  return status === 'new';
}
