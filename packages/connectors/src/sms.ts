import type { ConnectorIdentity, ConnectorResult } from './result.js';

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

export type SmsEncoding = 'gsm7' | 'ucs2';

// GSM 03.38 basic character set (one septet each) and extension table (two septets each).
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM7_EXTENSION = new Set('^{}\\[~]|€\f');

/**
 * Characters that force the whole message into UCS-2, where a segment holds 70 characters
 * instead of 160. Curly quotes and emoji are the usual culprits in templates.
 */
export function findNonGsmCharacters(body: string): string[] {
  const found = new Set<string>();
  for (const ch of body) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENSION.has(ch)) found.add(ch);
  }
  return [...found];
}

/** Billable segments for a text body, the unit carriers and Twilio charge by. */
export function countSegments(body: string): { segments: number; encoding: SmsEncoding } {
  if (findNonGsmCharacters(body).length > 0) {
    // UCS-2 counts UTF-16 code units, so an emoji takes two.
    const units = body.length;
    return {
      encoding: 'ucs2',
      segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67),
    };
  }
  let septets = 0;
  for (const ch of body) septets += GSM7_EXTENSION.has(ch) ? 2 : 1;
  return {
    encoding: 'gsm7',
    segments: septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153),
  };
}
