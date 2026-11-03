/**
 * @fsc/core — domain models, validation, and event contracts.
 *
 * Phase 0 placeholder. Phase 1 adds canonical Lead, Tenant, InboundEvent,
 * ActionJob, and IntegrationConnection types with Zod validators.
 * See docs/architecture/SYSTEM_OVERVIEW.md.
 */
export const MODULE = 'core' as const;

/** Lead lifecycle states. A lead is "unresolved" while status is `new`. */
export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
