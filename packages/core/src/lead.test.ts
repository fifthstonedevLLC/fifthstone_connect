import { describe, expect, it } from 'vitest';
import { LIMITS, LeadInputSchema, canTransition, isUnresolved } from './lead.js';

const valid = { name: 'Jane Doe', email: 'Jane@Example.com' };

describe('LeadInputSchema', () => {
  it('accepts a minimal lead and normalizes it', () => {
    const lead = LeadInputSchema.parse({ ...valid, phone: '(319) 555-0142', message: '  hi  ' });
    expect(lead).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+13195550142',
      message: 'hi',
    });
  });

  it('accepts phone-only contact', () => {
    expect(LeadInputSchema.parse({ name: 'Sam', phone: '319-555-0142' }).phone).toBe(
      '+13195550142',
    );
  });

  it('requires a name', () => {
    const result = LeadInputSchema.safeParse({ name: '   ', email: 'a@b.co' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Name is required');
  });

  it('requires email or phone', () => {
    const result = LeadInputSchema.safeParse({ name: 'Sam', email: '', phone: ' ' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'Provide an email address or phone number',
    );
  });

  it('rejects an invalid email with a helpful message', () => {
    const result = LeadInputSchema.safeParse({ name: 'Sam', email: 'not-an-email' });
    expect(result.error?.issues[0]?.message).toBe('Enter a valid email address');
  });

  it('rejects an unreadable phone number', () => {
    const result = LeadInputSchema.safeParse({ name: 'Sam', phone: '12345' });
    expect(result.error?.issues[0]?.message).toBe('Enter a valid phone number');
  });

  it('enforces length caps', () => {
    const long = 'x'.repeat(LIMITS.message + 1);
    expect(LeadInputSchema.safeParse({ ...valid, message: long }).success).toBe(false);
    expect(LeadInputSchema.safeParse({ ...valid, name: 'x'.repeat(LIMITS.name + 1) }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields instead of storing them', () => {
    expect(LeadInputSchema.safeParse({ ...valid, ssn: '123-45-6789' }).success).toBe(false);
  });

  it('drops empty optional fields', () => {
    const lead = LeadInputSchema.parse({ ...valid, service: '  ', address: '' });
    expect(lead).not.toHaveProperty('service', '');
    expect(lead.service).toBeUndefined();
    expect(lead.address).toBeUndefined();
  });
});

describe('lead status rules', () => {
  it('only `new` is unresolved', () => {
    expect(isUnresolved('new')).toBe(true);
    expect(isUnresolved('contacted')).toBe(false);
    expect(isUnresolved('closed')).toBe(false);
    expect(isUnresolved('spam')).toBe(false);
  });

  it('allows forward moves and operator reopen, blocks no-ops', () => {
    expect(canTransition('new', 'contacted')).toBe(true);
    expect(canTransition('closed', 'new')).toBe(true);
    expect(canTransition('closed', 'contacted')).toBe(false);
    expect(canTransition('new', 'new')).toBe(false);
  });
});
