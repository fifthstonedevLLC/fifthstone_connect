import { ExternalEventIdSchema } from '@fsc/core';
import { z } from 'zod';
import type { ConnectorIdentity, ConnectorResult, InboundRequest } from './result.js';

/**
 * Inbound phone events: missed calls, voicemails, received texts and delivery status of sent
 * texts. The adapter verifies and parses the provider's webhook into these canonical events;
 * `apps/api` then persists them before anything else happens (CLAUDE.md rule 1).
 */

const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be E.164');

export const MissedCallEventSchema = z
  .object({
    kind: z.literal('missed_call'),
    callId: ExternalEventIdSchema,
    from: E164,
    to: E164,
    at: z.coerce.date(),
  })
  .strict();

export const VoicemailEventSchema = z
  .object({
    kind: z.literal('voicemail'),
    callId: ExternalEventIdSchema,
    from: E164,
    to: E164,
    /** Provider reference to the recording; audio itself is fetched by the worker. */
    recordingRef: z.string().min(1).max(200),
    durationSeconds: z.number().int().min(0).max(600),
    at: z.coerce.date(),
  })
  .strict();

export const TextReceivedEventSchema = z
  .object({
    kind: z.literal('text_received'),
    messageId: ExternalEventIdSchema,
    from: E164,
    to: E164,
    body: z.string().max(1600),
    mediaCount: z.number().int().min(0).max(10),
    at: z.coerce.date(),
  })
  .strict();

export const TEXT_DELIVERY_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'undelivered',
  'failed',
] as const;

export const TextStatusEventSchema = z
  .object({
    kind: z.literal('text_status'),
    messageId: ExternalEventIdSchema,
    status: z.enum(TEXT_DELIVERY_STATUSES),
    errorCode: z.string().max(20).optional(),
    at: z.coerce.date(),
  })
  .strict();

export const PhoneEventSchema = z.discriminatedUnion('kind', [
  MissedCallEventSchema,
  VoicemailEventSchema,
  TextReceivedEventSchema,
  TextStatusEventSchema,
]);

export type PhoneEvent = z.output<typeof PhoneEventSchema>;

export interface PhoneEvents extends ConnectorIdentity {
  /** Signature check on the raw request. Unverified requests are rejected before parsing. */
  verify(request: InboundRequest): boolean;
  parse(request: InboundRequest): ConnectorResult<PhoneEvent>;
}
