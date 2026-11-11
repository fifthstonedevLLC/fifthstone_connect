import {
  MockPortalUserSchema,
  MockTenantSchema,
  type MockPortalUser,
  type MockTenant,
} from './schemas.js';

/**
 * Tenants and portal users from docs/product/MOCK_DATA.md. Scenario leads, conversations and
 * jobs join this catalog as their tables are migrated.
 */

/**
 * The one sign-in password for every mock login. It exists only in local seed data and works
 * only against the local Supabase stack (MOCK_DATA.md, Portal users).
 */
export const MOCK_LOCAL_PASSWORD = 'mock-local-only';

export const TENANTS: readonly MockTenant[] = [
  {
    key: 'T1',
    slug: 'mock-riverbend',
    name: 'Riverbend Heating & Air',
    status: 'active',
    timezone: 'America/Chicago',
    playbook: 'service_call',
    trade: 'hvac',
    connectNumber: '+13195550100',
  },
  {
    key: 'T2',
    slug: 'mock-northline-ink',
    name: 'Northline Ink',
    status: 'active',
    timezone: 'America/Chicago',
    playbook: 'studio_appointment',
    trade: 'tattoo',
    connectNumber: '+13195550101',
  },
  {
    key: 'T4',
    slug: 'mock-old-mill-roofing',
    name: 'Old Mill Roofing',
    status: 'disabled',
    timezone: 'America/Chicago',
    playbook: 'estimate_visit',
    trade: 'roofing',
    connectNumber: '+13195550103',
  },
  {
    // Signed up, still in setup (decision 35): no number, no trade picked, nothing live.
    key: 'T5',
    slug: 'mock-cedar-lane',
    name: 'Cedar Lane Lawn Care',
    status: 'onboarding',
    timezone: 'America/Chicago',
    playbook: 'service_call',
  },
].map((t) => MockTenantSchema.parse(t));

export const PORTAL_USERS: readonly MockPortalUser[] = [
  {
    key: 'U-01',
    tenant: 'T1',
    name: 'Rhett Boyd',
    role: 'owner',
    email: 'rhett@riverbend.example.com',
    mobile: '+13195550104',
  },
  {
    key: 'U-02',
    tenant: 'T1',
    name: 'Carla Nunez',
    role: 'staff',
    email: 'carla@riverbend.example.com',
    mobile: '+13195550105',
  },
  {
    key: 'U-03',
    tenant: 'T2',
    name: 'Mara Quinn',
    role: 'owner',
    email: 'mara@northline.example.com',
    mobile: '+13195550106',
  },
  {
    key: 'U-04',
    tenant: 'T2',
    name: 'Jules Park',
    role: 'staff',
    email: 'jules@northline.example.com',
    mobile: '+13195550107',
  },
  {
    key: 'U-07',
    tenant: 'T4',
    name: 'Owen Mills',
    role: 'owner',
    email: 'owen@oldmill.example.net',
    mobile: '+13195550110',
  },
  {
    key: 'U-08',
    tenant: 'T5',
    name: 'Dee Alvarez',
    role: 'owner',
    email: 'dee@cedarlane.example.com',
    mobile: '+13195550108',
  },
].map((u) => MockPortalUserSchema.parse(u));
