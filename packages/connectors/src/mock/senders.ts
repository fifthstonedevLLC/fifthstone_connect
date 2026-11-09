import type { EmailSendInput, EmailSender } from '../email.js';
import { fail, ok } from '../result.js';
import { countSegments, type SmsSendInput, type SmsSendResult, type SmsSender } from '../sms.js';
import { MockConnector, type MockOptions } from './base.js';
import { assertMockEmail, assertMockPhone } from './guards.js';

export type SentText = SmsSendInput & SmsSendResult;

/** Mock texting. Records every text instead of sending it. */
export class MockSmsSender extends MockConnector implements SmsSender {
  readonly sent: SentText[] = [];

  constructor(options: MockOptions = {}) {
    super('SM', options);
  }

  async send(input: SmsSendInput) {
    assertMockPhone(input.from, 'from');
    assertMockPhone(input.to, 'to');
    if (input.body.trim() === '') return fail('permanent', 'empty_body', 'Text body is empty');
    return this.once(input.tenantId, input.idempotencyKey, () => {
      const value: SmsSendResult = { messageRef: this.nextRef(), ...countSegments(input.body) };
      this.sent.push({ ...input, ...value });
      return ok(value);
    });
  }
}

export type SentEmail = EmailSendInput & { messageRef: string };

/** Mock email. Records every email instead of sending it. */
export class MockEmailSender extends MockConnector implements EmailSender {
  readonly sent: SentEmail[] = [];

  constructor(options: MockOptions = {}) {
    super('EM', options);
  }

  async send(input: EmailSendInput) {
    assertMockEmail(input.from, 'from');
    assertMockEmail(input.to, 'to');
    if (input.replyTo !== undefined) assertMockEmail(input.replyTo, 'replyTo');
    return this.once(input.tenantId, input.idempotencyKey, () => {
      const value = { messageRef: this.nextRef() };
      this.sent.push({ ...input, ...value });
      return ok(value);
    });
  }
}
