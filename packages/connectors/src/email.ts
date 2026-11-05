import { ExternalEventIdSchema } from '@fsc/core';
import { z } from 'zod';
import type { ConnectorIdentity, ConnectorResult, InboundRequest } from './result.js';

/** Outbound email (confirmations, owner alerts) and inbound email events (SES receiving). */

export interface EmailSendInput {
  tenantId: string;
  /** Verified sender for the tenant, e.g. "Riverbend Heating & Air <hello@…>". */
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /** Job action key; the same key never produces a second email. */
  idempotencyKey: string;
}

export interface EmailSender extends ConnectorIdentity {
  send(input: EmailSendInput): Promise<ConnectorResult<{ messageRef: string }>>;
}

export const EmailReceivedEventSchema = z
  .object({
    kind: z.literal('email_received'),
    messageId: ExternalEventIdSchema,
    from: z.email(),
    to: z.array(z.email()).min(1).max(50),
    subject: z.string().max(998),
    text: z.string().max(100_000),
    at: z.coerce.date(),
  })
  .strict();

export const EMAIL_DELIVERY_STATUSES = ['delivered', 'bounced', 'complained'] as const;

export const EmailDeliveryEventSchema = z
  .object({
    kind: z.literal('email_delivery'),
    messageId: ExternalEventIdSchema,
    recipient: z.email(),
    status: z.enum(EMAIL_DELIVERY_STATUSES),
    at: z.coerce.date(),
  })
  .strict();

export const EmailEventSchema = z.discriminatedUnion('kind', [
  EmailReceivedEventSchema,
  EmailDeliveryEventSchema,
]);

export type EmailEvent = z.output<typeof EmailEventSchema>;

export interface EmailEvents extends ConnectorIdentity {
  verify(request: InboundRequest): boolean;
  parse(request: InboundRequest): ConnectorResult<EmailEvent>;
}
