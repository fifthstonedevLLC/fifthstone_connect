/**
 * @fsc/connectors — external service adapters behind narrow interfaces.
 *
 * Phase 0 placeholder. Phase 1 defines EmailSender, LeadDestination, and
 * NotificationChannel interfaces; Phase 3 adds SES and Sheets implementations.
 * Every adapter must be mockable; mocked success is never reported as a verified integration.
 */
export const MODULE = 'connectors' as const;
