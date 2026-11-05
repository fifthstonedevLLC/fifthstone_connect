import { ok, type ConnectorError, type ConnectorResult } from '../result.js';

/**
 * Shared behavior for mock adapters: `MOCK-` provider references (docs/product/MOCK_DATA.md),
 * idempotency per tenant and key, and scripted failures for testing retries and dead-letters.
 */

export const MOCK_PROVIDER = 'mock';

export abstract class MockConnector {
  readonly provider = MOCK_PROVIDER;
  readonly isMock = true;
  private readonly scriptedFailures: ConnectorError[] = [];
  private readonly completed = new Map<string, unknown>();
  private sequence = 0;

  protected constructor(private readonly refPrefix: string) {}

  /** The next `times` calls fail with this error, then calls succeed again. */
  failNext(error: ConnectorError, times = 1): void {
    for (let i = 0; i < times; i += 1) this.scriptedFailures.push(error);
  }

  protected nextRef(): string {
    this.sequence += 1;
    return `MOCK-${this.refPrefix}-${String(this.sequence).padStart(4, '0')}`;
  }

  /** Runs a call, unless a scripted failure is queued. */
  protected run<T>(make: () => ConnectorResult<T>): ConnectorResult<T> {
    const failure = this.scriptedFailures.shift();
    return failure ? { ok: false, error: failure } : make();
  }

  /** Like `run`, but a key that already succeeded returns the original result without a repeat. */
  protected once<T>(
    tenantId: string,
    idempotencyKey: string,
    make: () => ConnectorResult<T>,
  ): ConnectorResult<T> {
    const key = `${tenantId}\u0000${idempotencyKey}`;
    if (this.completed.has(key)) return ok(this.completed.get(key) as T);
    const result = this.run(make);
    if (result.ok) this.completed.set(key, result.value);
    return result;
  }
}
