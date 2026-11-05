import { describe, expect, it } from 'vitest';
import { MOCK_SIGNATURE_HEADER, MockEmailEvents, MockPhoneEvents } from './index.js';

const voicemail = {
  kind: 'voicemail' as const,
  callId: 'MOCK-CA-0002',
  from: '+13195550142',
  to: '+13195550100',
  recordingRef: 'MOCK-RE-VM-02',
  durationSeconds: 24,
  at: '2026-11-03T14:15:00Z',
};

describe('MockPhoneEvents', () => {
  const phone = new MockPhoneEvents();

  it('round-trips a signed mock request into a canonical event', () => {
    const request = phone.request(voicemail);
    expect(phone.verify(request)).toBe(true);
    const parsed = phone.parse(request);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.kind).toBe('voicemail');
      expect(parsed.value.at).toEqual(new Date('2026-11-03T14:15:00Z'));
    }
  });

  it('fails verification without the mock signature', () => {
    const request = phone.request(voicemail);
    expect(phone.verify({ ...request, headers: {} })).toBe(false);
    expect(phone.verify({ ...request, headers: { [MOCK_SIGNATURE_HEADER]: 'forged' } })).toBe(
      false,
    );
  });

  it('rejects malformed and invalid bodies as permanent, naming fields not values', () => {
    const request = phone.request(voicemail);
    expect(phone.parse({ ...request, body: '{not json' })).toMatchObject({
      ok: false,
      error: { kind: 'permanent', code: 'malformed_body' },
    });

    const invalid = phone.parse({
      ...request,
      body: JSON.stringify({ ...voicemail, from: '319-555-0142', extra: 'x' }),
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_event' } });
    if (!invalid.ok) {
      expect(invalid.error.message).toContain('from');
      expect(invalid.error.message).not.toContain('319-555-0142');
    }
  });

  it('parses texts and delivery statuses', () => {
    const received = phone.parse(
      phone.request({
        kind: 'text_received',
        messageId: 'MOCK-SM-0101',
        from: '+13195550142',
        to: '+13195550100',
        body: '1',
        mediaCount: 0,
        at: '2026-11-03T14:32:00Z',
      }),
    );
    expect(received).toMatchObject({ ok: true, value: { kind: 'text_received', body: '1' } });

    const status = phone.parse(
      phone.request({
        kind: 'text_status',
        messageId: 'MOCK-SM-0001',
        status: 'undelivered',
        errorCode: '30003',
        at: '2026-11-03T14:16:00Z',
      }),
    );
    expect(status).toMatchObject({ ok: true, value: { status: 'undelivered' } });
  });

  it('refuses to build requests with real-looking numbers', () => {
    expect(() => phone.request({ ...voicemail, from: '+13195550250' })).toThrow(/\(from\)$/);
  });
});

describe('MockEmailEvents', () => {
  const email = new MockEmailEvents();

  it('parses forwarded inquiries and delivery events', () => {
    const received = email.parse(
      email.request({
        kind: 'email_received',
        messageId: 'MOCK-EM-IN-0001',
        from: 'customer@example.net',
        to: ['mock-riverbend@inbound.example.com'],
        subject: 'Furnace question',
        text: 'Can someone look at my furnace this week?',
        at: '2026-11-03T15:00:00Z',
      }),
    );
    expect(received).toMatchObject({ ok: true, value: { kind: 'email_received' } });

    const bounce = email.parse(
      email.request({
        kind: 'email_delivery',
        messageId: 'MOCK-EM-0001',
        recipient: 'ana@example.org',
        status: 'bounced',
        at: '2026-11-03T15:01:00Z',
      }),
    );
    expect(bounce).toMatchObject({ ok: true, value: { status: 'bounced' } });
  });

  it('refuses non-reserved email domains', () => {
    expect(() =>
      email.request({
        kind: 'email_delivery',
        messageId: 'MOCK-EM-0001',
        recipient: 'real@outside.invalid',
        status: 'delivered',
        at: '2026-11-03T15:01:00Z',
      }),
    ).toThrow(/\(recipient\)$/);
  });
});
