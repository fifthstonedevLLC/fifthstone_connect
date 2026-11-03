import { z } from 'zod';

/**
 * Integration connections: per-tenant configuration for external systems.
 * Secrets are never stored here — only `secretRef`, the name of a secret in the
 * deployment secret store.
 */

const SecretRef = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/, 'Secret reference must be a lowercase name, not a value');

export const SesConnectionSchema = z
  .object({
    type: z.literal('ses'),
    /** Verified SES identity used as From, e.g. "Acme Plumbing <hello@acmeplumbing.com>". */
    fromAddress: z.email(),
    fromName: z.string().trim().min(1).max(80),
    configurationSet: z.string().min(1).max(64).optional(),
  })
  .strict();

export const GoogleSheetsConnectionSchema = z
  .object({
    type: z.literal('google_sheets'),
    spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{20,}$/, 'Invalid spreadsheet ID'),
    sheetName: z.string().min(1).max(100),
    /** Column order for appended rows; `leadId` is required for duplicate reconciliation. */
    columns: z
      .array(z.string().min(1))
      .min(1)
      .refine((cols) => cols.includes('leadId'), { message: 'Columns must include leadId' }),
  })
  .strict();

export const WebhookSourceConnectionSchema = z
  .object({
    type: z.literal('webhook_source'),
    sourceKey: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    signingSecretRef: SecretRef,
    /** Maps canonical lead fields to dotted paths in the source payload. */
    fieldMap: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export const IntegrationConnectionConfigSchema = z.discriminatedUnion('type', [
  SesConnectionSchema,
  GoogleSheetsConnectionSchema,
  WebhookSourceConnectionSchema,
]);

export type IntegrationConnectionConfig = z.output<typeof IntegrationConnectionConfigSchema>;
export type IntegrationType = IntegrationConnectionConfig['type'];

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  enabled: boolean;
  config: IntegrationConnectionConfig;
  createdAt: Date;
  updatedAt: Date;
}
