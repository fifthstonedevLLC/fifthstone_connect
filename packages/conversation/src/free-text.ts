import { countSegments } from '@fsc/core/segments';

/**
 * Replies a person types in their own words (decision 39), where the owner has switched free text
 * on. It is a person speaking, so rule 10 (AI never promises) is not in play; what the server
 * still enforces is what keeps the texting registration safe: the business is named the first time
 * it texts someone, and a reply stays short enough to be a conversation, not a campaign. Opt-outs
 * and whether texting is live are checked as for every text (`replyAllowed`, the send job).
 */

/** Most segments one typed reply may take: a few sentences, never a newsletter. */
export const FREE_TEXT_MAX_SEGMENTS = 3;

export type FreeTextError = 'empty' | 'too_long' | 'needs_business_name';

export function checkFreeText(
  body: string,
  context: {
    businessName: string;
    /** Whether this customer has never had a text from the business. */
    firstText: boolean;
  },
): { ok: true; body: string; segments: number } | { ok: false; error: FreeTextError } {
  const text = body.trim();
  if (text === '') return { ok: false, error: 'empty' };
  const segments = countSegments(text).segments;
  if (segments > FREE_TEXT_MAX_SEGMENTS) return { ok: false, error: 'too_long' };
  if (context.firstText && !text.toLowerCase().includes(context.businessName.toLowerCase())) {
    return { ok: false, error: 'needs_business_name' };
  }
  return { ok: true, body: text, segments };
}
