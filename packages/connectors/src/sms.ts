import type { SmsEncoding } from '@fsc/core';
import type { ConnectorIdentity, ConnectorResult } from './result.js';

// Segment counting lives in @fsc/core, where template rules and the portal use it too.
export { countSegments, findNonGsmCharacters, type SmsEncoding } from '@fsc/core';

/**
 * Outbound texts. Opt-out checks happen before a send is queued (CLAUDE.md rule 12); the sender
 * itself never decides whether a text is allowed.
 */

export interface SmsSendInput {
  tenantId: string;
  /** Tenant's Fifth Stone Connect number, E.164. */
  from: string;
  /** Customer or approver number, E.164. */
  to: string;
  body: string;
  /** Job action key; the same key never produces a second text. */
  idempotencyKey: string;
}

export interface SmsSendResult {
  /** Provider message ID (Twilio SID, or `MOCK-…` from the mock). */
  messageRef: string;
  segments: number;
  encoding: SmsEncoding;
}

export interface SmsSender extends ConnectorIdentity {
  send(input: SmsSendInput): Promise<ConnectorResult<SmsSendResult>>;
}
