import { TENANT_STATUSES, normalizeEmail, normalizePhone } from '@fsc/core';
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
