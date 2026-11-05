import { describe, expect, it } from 'vitest';
import { IntegrationConnectionConfigSchema } from './connections.js';

describe('IntegrationConnectionConfigSchema', () => {
  it('accepts a Sheets connection that includes leadId', () => {
    const cfg = IntegrationConnectionConfigSchema.parse({
      type: 'google_sheets',
      spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      sheetName: 'Leads',
      columns: ['leadId', 'createdAt', 'name', 'email', 'phone'],
    });
    expect(cfg.type).toBe('google_sheets');
  });

  it('rejects a Sheets mapping without leadId (no duplicate reconciliation possible)', () => {
    const result = IntegrationConnectionConfigSchema.safeParse({
      type: 'google_sheets',
      spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      sheetName: 'Leads',
      columns: ['name', 'email'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a webhook connection carrying a raw secret value', () => {
    const result = IntegrationConnectionConfigSchema.safeParse({
      type: 'webhook_source',
      sourceKey: 'jobber',
      signingSecretRef: 'whsec_9Fq/2+abcDEF==',
      fieldMap: { name: 'client.name' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown connection types', () => {
    expect(IntegrationConnectionConfigSchema.safeParse({ type: 'sms' }).success).toBe(false);
  });
});
