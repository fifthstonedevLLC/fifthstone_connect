import { BusinessProfileSchema } from '@fsc/core';
import { z } from 'zod';
import { MockEmailSchema, MockPhoneSchema } from './schemas.js';

/**
 * Onboarding state for the mock tenants (MOCK_DATA.md, Onboarding): Riverbend has finished every
 * step but the test call, Northline is partway through. Old Mill was set up
 * before onboarding existed in the portal and has none.
 */

/** Mock EINs start with 00, a prefix the IRS never assigns, so none can be a real business's. */
const MockEinSchema = z.string().regex(/^00-\d{7}$/, 'Mock EINs start with 00-');

const MockOnboardingSchema = z
  .object({
    tenant: z.string().regex(/^T\d+$/),
    profile: BusinessProfileSchema.and(
      z.object({
        ein: MockEinSchema.optional(),
        contactEmail: MockEmailSchema,
        contactPhone: MockPhoneSchema,
        website: z
          .string()
          .regex(/^https:\/\/[a-z0-9-]+\.example\.(com|org|net)$/)
          .optional(),
      }),
    ).optional(),
    /** Minutes before load when each acknowledged step happened; absent means not yet. */
    typeConfirmedMinutesAgo: z.number().int().min(0).optional(),
    templatesReviewedMinutesAgo: z.number().int().min(0).optional(),
    testSimulatedMinutesAgo: z.number().int().min(0).optional(),
    /** Portal users who receive approval requests. */
    approvers: z.array(z.string().regex(/^U-\d{2}$/)),
  })
  .strict();

export type MockOnboarding = z.output<typeof MockOnboardingSchema>;

export const ONBOARDING: readonly MockOnboarding[] = [
  {
    tenant: 'T1',
    profile: {
      legalName: 'Riverbend Heating & Air LLC',
      ein: '00-0000101',
      street: '9900 Main St',
      city: 'Cedar Falls',
      region: 'IA',
      postalCode: '50613',
      website: 'https://riverbend.example.com',
      contactName: 'Rhett Boyd',
      contactEmail: 'rhett@riverbend.example.com',
      contactPhone: '+13195550104',
    },
    typeConfirmedMinutesAgo: 41000,
    templatesReviewedMinutesAgo: 40000,
    approvers: ['U-01'],
  },
  {
    tenant: 'T2',
    profile: {
      legalName: 'Northline Ink LLC',
      ein: '00-0000101',
      street: '9901 Main St',
      city: 'Cedar Falls',
      region: 'IA',
      postalCode: '50613',
      website: 'https://northline.example.com',
      contactName: 'Mara Quinn',
      contactEmail: 'mara@northline.example.com',
      contactPhone: '+13195550106',
    },
    typeConfirmedMinutesAgo: 9000,
    approvers: ['U-03', 'U-04'],
  },
].map((o) => MockOnboardingSchema.parse(o));
