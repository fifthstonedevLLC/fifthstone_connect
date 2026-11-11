import { z } from 'zod';
import { cleanLine, normalizeEmail, normalizePhone } from './normalize.js';
import { US_REGIONS } from './regions.js';
import { BusinessHoursSchema } from './tenant.js';

/**
 * Onboarding inputs (SCOPE.md v0.2, "Onboarding inside the portal"): the business details that
 * texting registration needs, and the business's opening hours. Captured in Phase 2; nothing is
 * sent to a vendor until Phase 4.
 */

/**
 * "123456789" or "12-3456789" as "12-3456789"; null for anything else, including a number
 * written the way a Social Security number is (123-45-6789), which the portal never stores.
 */
const SSN_SHAPE = /^\s*\d{3}-\d{2}-\d{4}\s*$/;

export function normalizeEin(value: string): string | null {
  if (SSN_SHAPE.test(value)) return null;
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
}

const Line = (max: number) => z.string().transform(cleanLine).pipe(z.string().min(1).max(max));
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

export const BusinessProfileSchema = z
  .object({
    /** The name on file with the IRS and the state, which carriers check. */
    legalName: Line(120),
    /** A business tax ID. Optional for sole proprietors without one; never an SSN. */
    ein: optional(
      z.string().transform((v, ctx) => {
        const ein = normalizeEin(v);
        if (!ein) {
          ctx.addIssue({
            code: 'custom',
            message: SSN_SHAPE.test(v)
              ? "That looks like a Social Security number. Enter the business's EIN, or leave this blank."
              : 'Use the 9-digit EIN, like 12-3456789',
          });
        }
        return ein ?? v;
      }),
    ),
    street: Line(200),
    city: Line(100),
    region: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.enum(US_REGIONS)),
    postalCode: z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().regex(/^\d{5}(-\d{4})?$/, 'Use a 5-digit ZIP code')),
    website: optional(
      z
        .string()
        .transform((v) => v.trim())
        .pipe(z.url({ protocol: /^https?$/ }).max(200)),
    ),
    contactName: Line(120),
    contactEmail: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
    contactPhone: z.string().transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) ctx.addIssue({ code: 'custom', message: 'Use a full phone number' });
      return phone ?? v;
    }),
  })
  .strict();

export type BusinessProfile = z.output<typeof BusinessProfileSchema>;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/**
 * A business's opening hours: one or more blocks of days with an open and close time. Two blocks
 * may share a day (a lunch break) but may not overlap on it.
 */
export const BusinessHoursListSchema = z
  .array(BusinessHoursSchema)
  .min(1)
  .max(14)
  .refine(
    (blocks) =>
      blocks.every((a, i) =>
        blocks
          .slice(i + 1)
          .every(
            (b) =>
              !a.days.some((d) => b.days.includes(d)) ||
              minutes(a.close) <= minutes(b.open) ||
              minutes(b.close) <= minutes(a.open),
          ),
      ),
    { message: 'Two blocks overlap on the same day' },
  );

export type BusinessHoursList = z.output<typeof BusinessHoursListSchema>;

/** The setup steps, in order (SCOPE.md v0.2); the last sends the texting application. */
export const ONBOARDING_STEPS = [
  'business_type',
  'details',
  'hours',
  'templates',
  'team',
  'test',
  'apply',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What the database knows about a business's setup. */
export interface OnboardingFacts {
  typeConfirmed: boolean;
  profileSaved: boolean;
  hoursSet: boolean;
  calendarConnected: boolean;
  templatesReviewed: boolean;
  approvers: number;
  testRun: boolean;
  applicationSent: boolean;
}

/** Each step and whether it is done. A step is done only when its data says so. */
/**
 * Where a business stands (decision 35): finishing setup, application sent and waiting for
 * approval, or live. Only live businesses use the portal's working pages.
 */
export type SetupStage = 'setting_up' | 'applied' | 'live';

export function setupStage(live: boolean, applicationSent: boolean): SetupStage {
  if (live) return 'live';
  return applicationSent ? 'applied' : 'setting_up';
}

/** Whether everything before the application is done, so it can be sent. */
export function readyToApply(steps: readonly { key: OnboardingStep; done: boolean }[]): boolean {
  return steps.filter((s) => s.key !== 'apply').every((s) => s.done);
}

export function onboardingSteps(facts: OnboardingFacts): { key: OnboardingStep; done: boolean }[] {
  const done: Record<OnboardingStep, boolean> = {
    business_type: facts.typeConfirmed,
    details: facts.profileSaved,
    hours: facts.hoursSet && facts.calendarConnected,
    templates: facts.templatesReviewed,
    team: facts.approvers > 0,
    test: facts.testRun,
    apply: facts.applicationSent,
  };
  return ONBOARDING_STEPS.map((key) => ({ key, done: done[key] }));
}
