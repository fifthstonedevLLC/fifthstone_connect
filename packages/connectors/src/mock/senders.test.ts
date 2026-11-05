import { describe, expect, it } from 'vitest';
import { MockEmailSender, MockSmsSender } from './index.js';

const T1 = 'tenant-mock-riverbend';
const T2 = 'tenant-mock-northline-ink';
const text = {
  tenantId: T1,
  from: '+13195550100',
  to: '+13195550142',
  body: 'Sorry we missed your call! Reply STOP to opt out.',
  idempotencyKey: 'send_text_back:lead-rb-02',
};

describe('MockSmsSender', () => {
  it('is labeled as a mock and issues MOCK references', async () => {
    const sms = new MockSmsSender();
    expect(sms.isMock).toBe(true);
    expect(sms.provider).toBe('mock');
    const result = await sms.send(text);
    expect(result).toEqual({
      ok: true,
      value: { messageRef: 'MOCK-SM-0001', segments: 1, encoding: 'gsm7' },
    });
    expect(sms.sent).toHaveLength(1);
  });

  it('sends once per tenant and idempotency key', async () => {
    const sms = new MockSmsSender();
    const first = await sms.send(text);
    const retry = await sms.send(text);
    expect(retry).toEqual(first);
    expect(sms.sent).toHaveLength(1);

    // The same key in another tenant is a different text.
    await sms.send({ ...text, tenantId: T2, from: '+13195550101' });
    expect(sms.sent).toHaveLength(2);
  });

  it('returns scripted failures, then succeeds on retry without a duplicate', async () => {
    const sms = new MockSmsSender();
    sms.failNext({ kind: 'transient', code: 'rate_limited', message: 'Too many requests' });
    const failed = await sms.send(text);
    expect(failed).toMatchObject({ ok: false, error: { kind: 'transient', code: 'rate_limited' } });
    expect(sms.sent).toHaveLength(0);

    const retried = await sms.send(text);
    expect(retried.ok).toBe(true);
    expect(sms.sent).toHaveLength(1);
  });

  it('rejects an empty body as permanent', async () => {
    const result = await new MockSmsSender().send({ ...text, body: '  ' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'permanent', code: 'empty_body' } });
  });

  it('refuses numbers outside the fictional 555-01XX range, without echoing them', async () => {
    const sms = new MockSmsSender();
    await expect(sms.send({ ...text, to: '+13195550250' })).rejects.toThrow(/\(to\)$/);
    await expect(sms.send({ ...text, from: '+13195550200' })).rejects.toThrow(/\(from\)$/);
    const error = await sms.send({ ...text, to: '+13195550250' }).catch((e: unknown) => e);
    expect(String(error)).not.toContain('0250');
    expect(sms.sent).toHaveLength(0);
  });
});

describe('MockEmailSender', () => {
  const email = {
    tenantId: T1,
    from: 'Riverbend Heating & Air <hello@riverbend.example.com>',
    to: 'ana@example.org',
    subject: 'Your appointment is confirmed',
    text: 'See you Wednesday at 10:00 AM.',
    idempotencyKey: 'send_confirmation_email:lead-rb-07',
  };

  it('records each email once per key', async () => {
    const mail = new MockEmailSender();
    expect(await mail.send(email)).toEqual({ ok: true, value: { messageRef: 'MOCK-EM-0001' } });
    await mail.send(email);
    expect(mail.sent).toHaveLength(1);
  });

  it('refuses addresses outside example.com, .org and .net', async () => {
    const mail = new MockEmailSender();
    await expect(mail.send({ ...email, to: 'someone@outside.invalid' })).rejects.toThrow(/\(to\)$/);
    await expect(mail.send({ ...email, replyTo: 'owner@outside.invalid' })).rejects.toThrow(
      /\(replyTo\)$/,
    );
    await expect(mail.send({ ...email, to: 'x@example.com.evil.net' })).rejects.toThrow();
    expect(mail.sent).toHaveLength(0);
  });
});
