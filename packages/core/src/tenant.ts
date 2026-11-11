import { z } from 'zod';

/**
 * Tenant = one customer business. Configuration here is non-secret;
 * credentials live in the secret store and are referenced by name only.
 */

/** `onboarding`: can sign in to finish setup, but nothing reaches customers (decision 35). */
export const TENANT_STATUSES = ['onboarding', 'active', 'disabled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Opaque, unguessable ID embedded in public forms. Never the internal UUID. */
export const PublicFormIdSchema = z
  .string()
  .regex(/^frm_[A-Za-z0-9]{22,}$/, 'Invalid public form ID');

const IanaTimeZone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown time zone' },
);

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

/** Weekdays use ISO numbering: 1 = Monday … 7 = Sunday. */
export const BusinessHoursSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    open: HHMM,
    close: HHMM,
  })
  .strict()
  .refine((h) => h.open < h.close, { message: 'Opening time must be before closing time' })
  .refine((h) => new Set(h.days).size === h.days.length, { message: 'Duplicate weekday' });

export const TenantConfigSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    timeZone: IanaTimeZone,
    businessHours: BusinessHoursSchema,
    /** Staff who receive new-lead alerts and reminders. */
    alertRecipients: z.array(z.email().toLowerCase()).min(1).max(10),
    /** Reply-to on acknowledgment emails (the business's inbox). */
    replyTo: z.email().toLowerCase(),
    /** Business hours after creation before a staff reminder is sent for a `new` lead. */
    reminderAfterBusinessHours: z.number().int().min(1).max(72).default(8),
    /** Per-tenant cap on acknowledgment emails per day (abuse case A2). */
    dailyAckLimit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export type TenantConfig = z.output<typeof TenantConfigSchema>;

export interface Tenant {
  id: string;
  publicFormId: string;
  status: TenantStatus;
  config: TenantConfig;
  createdAt: Date;
  updatedAt: Date;
}
