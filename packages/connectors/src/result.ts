/**
 * Every connector call returns a result instead of throwing, so the worker can tell a retryable
 * failure from a permanent one (SYSTEM_OVERVIEW.md, error behavior).
 */

export const CONNECTOR_ERROR_KINDS = [
  'transient', // 429, 5xx, timeout: retry with backoff
  'permanent', // rejected sender, revoked permission, invalid input: dead-letter, alert operator
] as const;
export type ConnectorErrorKind = (typeof CONNECTOR_ERROR_KINDS)[number];

export interface ConnectorError {
  kind: ConnectorErrorKind;
  /** Stable machine-readable code, e.g. "rate_limited", "auth_revoked", "slot_unavailable". */
  code: string;
  /** Operator-facing detail. Never contains message bodies, tokens or other PII. */
  message: string;
  retryAfterSeconds?: number;
}

export type ConnectorResult<T> = { ok: true; value: T } | { ok: false; error: ConnectorError };

export function ok<T>(value: T): ConnectorResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  kind: ConnectorErrorKind,
  code: string,
  message: string,
): ConnectorResult<T> {
  return { ok: false, error: { kind, code, message } };
}

/**
 * Identity carried by every adapter. `isMock` lets status reporting refuse to call an integration
 * verified when it only ran against a mock (CLAUDE.md rule 5).
 */
export interface ConnectorIdentity {
  readonly provider: string;
  readonly isMock: boolean;
}

/** A raw inbound webhook request, as received by `apps/api`, before verification. */
export interface InboundRequest {
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}
