import type { LeadState } from '@fsc/core';

/**
 * Replies from the portal are owner-approved templates only (decision 26): a person picks one,
 * and nothing they type reaches the customer. A template is offered as a reply when its key starts
 * with `reply_` and every placeholder in it can be filled for this lead. Templates promise; people
 * choose which promise to send (CLAUDE.md rule 10).
 */

export const REPLY_PREFIX = 'reply_';

/** The only values a reply template may use. */
export interface ReplyVars {
  /** The contact's display name ("Marcus T."); only the first name is used. */
  name: string | null;
}

export type ReplyError =
  | 'template_not_found'
  | 'not_reply_template'
  | 'unfilled_placeholder'
  | 'lead_closed'
  | 'opted_out';

export type RenderResult = { ok: true; body: string } | { ok: false; error: ReplyError };

const CLOSED: readonly LeadState[] = ['closed', 'spam', 'opted_out'];

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Fills a reply template. Unknown placeholders are refused rather than sent as braces. */
export function renderReply(
  templates: Record<string, string>,
  key: string,
  vars: ReplyVars,
): RenderResult {
  if (!key.startsWith(REPLY_PREFIX)) return { ok: false, error: 'not_reply_template' };
  const template = templates[key];
  if (template === undefined) return { ok: false, error: 'template_not_found' };

  const name = firstName(vars.name);
  // Without a name, "Thanks, {name}." reads "Thanks." rather than "Thanks, ."
  const withName = name
    ? template.replaceAll('{name}', name)
    : template.replaceAll(/,?\s*\{name\}/g, '');
  if (/\{[a-z_]+\}/.test(withName)) return { ok: false, error: 'unfilled_placeholder' };
  return { ok: true, body: withName };
}

/** Every reply this lead could be sent, rendered, in a stable order. */
export function replyOptions(
  templates: Record<string, string>,
  vars: ReplyVars,
): { key: string; body: string }[] {
  return Object.keys(templates)
    .filter((key) => key.startsWith(REPLY_PREFIX))
    .sort()
    .flatMap((key) => {
      const rendered = renderReply(templates, key, vars);
      return rendered.ok ? [{ key, body: rendered.body }] : [];
    });
}

/** Whether a reply may go to this lead at all. */
export function replyAllowed(
  leadState: LeadState,
  optedOut: boolean,
): { ok: true } | { ok: false; error: ReplyError } {
  if (CLOSED.includes(leadState)) return { ok: false, error: 'lead_closed' };
  if (optedOut) return { ok: false, error: 'opted_out' };
  return { ok: true };
}
