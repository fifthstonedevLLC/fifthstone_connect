import { z } from 'zod';

/**
 * Inbound events. Every accepted submission is persisted as an event first;
 * uniqueness on (tenantId, source, externalEventId) is what makes intake idempotent.
 */

export const EVENT_SOURCES = ['form', 'webhook'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * External event IDs come from the caller: a client-generated submission UUID for forms
 * (so a double-click is one lead), or the provider's event ID for webhooks.
 */
export const ExternalEventIdSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Event ID contains unsupported characters');

export interface InboundEvent {
  id: string;
  tenantId: string;
  source: EventSource;
  /** Webhook source name or form ID; distinguishes multiple sources of the same kind. */
  sourceKey: string;
  externalEventId: string;
  receivedAt: Date;
  /** SHA-256 of the raw body. Raw payloads are kept only for a short retention window. */
  payloadSha256: string;
  correlationId: string;
}
