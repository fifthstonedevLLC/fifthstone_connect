import type { z } from 'zod';
import { EmailEventSchema, type EmailEvent, type EmailEvents } from '../email.js';
import { PhoneEventSchema, type PhoneEvent, type PhoneEvents } from '../phone-events.js';
import { fail, ok, type ConnectorResult, type InboundRequest } from '../result.js';
import { MOCK_PROVIDER } from './base.js';
import { assertMockEmail, assertMockPhone } from './guards.js';

/**
 * Mock inbound webhooks. A mock request carries the canonical event as JSON and a fixed
 * signature header; the operator simulator (Phase 3) uses `request()` to push mock calls, texts
 * and emails through the real intake path.
 */

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';
export const MOCK_SIGNATURE = 'mock-signed';

function mockRequest(path: string, event: unknown): InboundRequest {
  return {
    url: `http://localhost/mock/${path}`,
    headers: { [MOCK_SIGNATURE_HEADER]: MOCK_SIGNATURE, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  };
}

function verifyMock(request: InboundRequest): boolean {
  return request.headers[MOCK_SIGNATURE_HEADER] === MOCK_SIGNATURE;
}

function parseMock<T>(schema: z.ZodType<T>, request: InboundRequest): ConnectorResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(request.body);
  } catch {
    return fail('permanent', 'malformed_body', 'Request body is not JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    return fail('permanent', 'invalid_event', `Invalid event fields: ${fields}`);
  }
  return ok(parsed.data);
}

export class MockPhoneEvents implements PhoneEvents {
  readonly provider = MOCK_PROVIDER;
  readonly isMock = true;

  /** Builds a signed mock webhook request. Throws on non-mock phone numbers. */
  request(event: z.input<typeof PhoneEventSchema>): InboundRequest {
    if ('from' in event) assertMockPhone(event.from, 'from');
    if ('to' in event) assertMockPhone(event.to, 'to');
    return mockRequest('phone', event);
  }

  verify(request: InboundRequest): boolean {
    return verifyMock(request);
  }

  parse(request: InboundRequest): ConnectorResult<PhoneEvent> {
    return parseMock(PhoneEventSchema, request);
  }
}

export class MockEmailEvents implements EmailEvents {
  readonly provider = MOCK_PROVIDER;
  readonly isMock = true;

  /** Builds a signed mock webhook request. Throws on non-reserved email domains. */
  request(event: z.input<typeof EmailEventSchema>): InboundRequest {
    if (event.kind === 'email_received') {
      assertMockEmail(event.from, 'from');
      event.to.forEach((to) => assertMockEmail(to, 'to'));
    } else {
      assertMockEmail(event.recipient, 'recipient');
    }
    return mockRequest('email', event);
  }

  verify(request: InboundRequest): boolean {
    return verifyMock(request);
  }

  parse(request: InboundRequest): ConnectorResult<EmailEvent> {
    return parseMock(EmailEventSchema, request);
  }
}
