/**
 * Limits on the owner's AI instruction fields. Kept free of Zod so the portal can check them as
 * the owner types without loading the validation library; `AiSettingsSchema` enforces the same
 * numbers on the server.
 */

export const AI_FIELD_LIMITS = {
  what_we_do: { chars: 500 },
  what_we_dont_do: { chars: 200, items: 10 },
  emergency: { chars: 500 },
  questions: { chars: 160, items: 5 },
  tone: { chars: 200 },
} as const;

export type AiField = keyof typeof AI_FIELD_LIMITS;

/** Whether one field's value is within its limits (blank entries are left out before saving). */
export function aiFieldWithinLimits(field: AiField, value: string | readonly string[]): boolean {
  const limit: { chars: number; items?: number } = AI_FIELD_LIMITS[field];
  const entries = typeof value === 'string' ? [value] : value;
  if (limit.items !== undefined && entries.length > limit.items) return false;
  return entries.every((entry) => entry.trim().length <= limit.chars);
}
