// The Zod-free entry point, so the portal can run these rules without the validation library.
import { countSegments, findNonGsmCharacters } from '@fsc/core/segments';
import { REPLY_PREFIX } from './replies.js';

/**
 * Rules for owner-edited template wording (SCOPE.md v0.2, "Template guardrails"). Owners change
 * the words; the required pieces stay (CLAUDE.md rule 11). apps/api runs these checks before a
 * version is written, and the portal runs the same functions for its live count, but only the
 * server's answer counts.
 */

export const PLACEHOLDERS = [
  'business',
  'name',
  'need',
  'question',
  'slots',
  'slot',
  'summary',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface TemplateRule {
  label: string;
  /** Who receives the text: the customer, or the owner or staff member who approves. */
  audience: 'customer' | 'approver';
  /** Placeholders this template may use. */
  placeholders: readonly Placeholder[];
  /** Placeholders that must stay, such as the business name in a first text. */
  requires: readonly Placeholder[];
  /** Whether the text must carry an opt-out line ("Reply STOP to opt out."). */
  optOutLine: boolean;
}

/** Most segments one template may take when sent, a cost control (SCOPE.md v0.2). */
export const MAX_TEMPLATE_SEGMENTS = 2;

export const OPT_OUT_LINE = 'Reply STOP to opt out.';
const OPT_OUT_PATTERN = /\b(reply|text) stop to (opt out|unsubscribe)\b/i;

const RULES: Record<string, TemplateRule> = {
  missed_call_text_back: {
    label: 'Missed-call text-back',
    audience: 'customer',
    placeholders: ['business', 'need', 'question'],
    requires: ['business'],
    optOutLine: true,
  },
  slot_offer: {
    label: 'Open times',
    audience: 'customer',
    placeholders: ['business', 'slots'],
    requires: ['slots'],
    optOutLine: false,
  },
  request_received: {
    label: 'Time requested',
    audience: 'customer',
    placeholders: ['business', 'slot'],
    requires: ['slot'],
    optOutLine: false,
  },
  confirmation: {
    label: 'Booking confirmation',
    audience: 'customer',
    placeholders: ['business', 'slot'],
    requires: ['business', 'slot'],
    optOutLine: true,
  },
  approval_request: {
    label: 'Approval request to you',
    audience: 'approver',
    placeholders: ['summary', 'name', 'slot'],
    requires: ['slot'],
    optOutLine: false,
  },
  out_of_scope: {
    label: 'Not work we do',
    audience: 'customer',
    placeholders: ['business'],
    requires: ['business'],
    optOutLine: false,
  },
};

/** The rule for a template key, or null for a key the engine does not know. */
export function templateRule(key: string): TemplateRule | null {
  const rule = RULES[key];
  if (rule) return rule;
  if (key.startsWith(REPLY_PREFIX) && key.length > REPLY_PREFIX.length) {
    const words = key.slice(REPLY_PREFIX.length).replaceAll('_', ' ');
    return {
      label: `Reply: ${words}`,
      audience: 'customer',
      placeholders: ['name', 'business'],
      requires: [],
      optOutLine: false,
    };
  }
  return null;
}

/** Typical values, so the segment count reflects a text as it would be sent. */
const SAMPLE: Record<Exclude<Placeholder, 'business'>, string> = {
  name: 'Marcus',
  need: 'your furnace is not heating',
  question: 'What is the address for the visit?',
  slots: '1 Thu 2:00 PM, 2 Fri 9:00 AM, 3 Mon 11:00 AM',
  slot: 'Thu, Nov 12 at 2:00 PM',
  summary: 'Furnace not heating, wants this week',
};

/** The template filled with sample values and the business's name. */
export function sampleText(body: string, businessName: string): string {
  return body.replaceAll(/\{([a-z_]+)\}/g, (whole, name: string) =>
    name === 'business'
      ? businessName
      : name in SAMPLE
        ? SAMPLE[name as keyof typeof SAMPLE]
        : whole,
  );
}

export type TemplateProblem =
  | { code: 'unknown_template' }
  | { code: 'empty' }
  | { code: 'missing_placeholder'; placeholder: Placeholder }
  | { code: 'missing_opt_out' }
  | { code: 'unknown_placeholder'; placeholder: string }
  | { code: 'stray_brace' }
  | { code: 'non_gsm'; characters: string[] }
  | { code: 'too_long'; segments: number };

export interface TemplateCheck {
  /** Segments when sent with typical values. */
  segments: number;
  problems: TemplateProblem[];
}

/** Checks one template's wording against its rule. */
export function checkTemplate(key: string, body: string, businessName: string): TemplateCheck {
  const rule = templateRule(key);
  if (!rule) return { segments: 0, problems: [{ code: 'unknown_template' }] };
  const text = body.trim();
  if (text === '') return { segments: 0, problems: [{ code: 'empty' }] };

  const problems: TemplateProblem[] = [];
  const used = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? '');
  for (const placeholder of rule.requires) {
    // The business name may be written out instead of `{business}`.
    const present =
      used.includes(placeholder) ||
      (placeholder === 'business' && text.toLowerCase().includes(businessName.toLowerCase()));
    if (!present) problems.push({ code: 'missing_placeholder', placeholder });
  }
  if (rule.optOutLine && !OPT_OUT_PATTERN.test(text)) problems.push({ code: 'missing_opt_out' });
  for (const placeholder of new Set(used)) {
    if (!(rule.placeholders as readonly string[]).includes(placeholder)) {
      problems.push({ code: 'unknown_placeholder', placeholder });
    }
  }
  // A brace that is not part of a placeholder would reach the customer as a literal brace.
  if (/[{}]/.test(text.replaceAll(/\{[a-z_]+\}/g, ''))) problems.push({ code: 'stray_brace' });

  // Curly quotes and emoji switch a whole text to 70-character segments (SCOPE.md v0.2).
  const characters = findNonGsmCharacters(text);
  if (characters.length > 0) problems.push({ code: 'non_gsm', characters });

  const segments = countSegments(sampleText(text, businessName)).segments;
  if (segments > MAX_TEMPLATE_SEGMENTS) problems.push({ code: 'too_long', segments });
  return { segments, problems };
}

export type TemplateSetCheck =
  | { ok: true; content: Record<string, string> }
  | { ok: false; error: 'template_keys_changed' }
  | {
      ok: false;
      error: 'template_problems';
      problems: { key: string; problems: TemplateProblem[] }[];
    };

/**
 * Checks a whole template version. Owners edit wording, not which templates exist: the keys must
 * match the version being replaced, because the engine sends each one at a fixed point. Wording is
 * stored trimmed.
 */
export function checkTemplateSet(
  currentKeys: readonly string[],
  content: Record<string, string>,
  businessName: string,
): TemplateSetCheck {
  const keys = Object.keys(content).sort();
  const expected = [...currentKeys].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    return { ok: false, error: 'template_keys_changed' };
  }
  const problems = keys
    .map((key) => ({
      key,
      problems: checkTemplate(key, content[key] ?? '', businessName).problems,
    }))
    .filter((entry) => entry.problems.length > 0);
  if (problems.length > 0) return { ok: false, error: 'template_problems', problems };
  return {
    ok: true,
    content: Object.fromEntries(keys.map((key) => [key, (content[key] ?? '').trim()])),
  };
}
