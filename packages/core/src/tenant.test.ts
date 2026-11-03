import { describe, expect, it } from 'vitest';
import { PublicFormIdSchema, TenantConfigSchema } from './tenant.js';

const base = {
  businessName: 'Example Plumbing',
  timeZone: 'America/Chicago',
  businessHours: { days: [1, 2, 3, 4, 5], open: '08:00', close: '17:00' },
  alertRecipients: ['Office@Example.com'],
  replyTo: 'office@example.com',
};

describe('TenantConfigSchema', () => {
  it('applies defaults and lowercases recipients', () => {
    const cfg = TenantConfigSchema.parse(base);
    expect(cfg.reminderAfterBusinessHours).toBe(8);
    expect(cfg.dailyAckLimit).toBe(100);
    expect(cfg.alertRecipients).toEqual(['office@example.com']);
  });

  it('rejects an unknown time zone', () => {
    expect(TenantConfigSchema.safeParse({ ...base, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('rejects inverted business hours and duplicate days', () => {
    const bad1 = { ...base, businessHours: { days: [1], open: '17:00', close: '08:00' } };
    const bad2 = { ...base, businessHours: { days: [1, 1], open: '08:00', close: '17:00' } };
    expect(TenantConfigSchema.safeParse(bad1).success).toBe(false);
    expect(TenantConfigSchema.safeParse(bad2).success).toBe(false);
  });

  it('requires at least one alert recipient', () => {
    expect(TenantConfigSchema.safeParse({ ...base, alertRecipients: [] }).success).toBe(false);
  });
});

describe('PublicFormIdSchema', () => {
  it('accepts opaque IDs and rejects UUIDs or short values', () => {
    expect(PublicFormIdSchema.safeParse('frm_8fK2pQ9xLmN4vB7tR1sZ0a').success).toBe(true);
    expect(PublicFormIdSchema.safeParse('3f1c2a9e-1b2c-4d5e-8f90-123456789abc').success).toBe(
      false,
    );
    expect(PublicFormIdSchema.safeParse('frm_short').success).toBe(false);
  });
});
