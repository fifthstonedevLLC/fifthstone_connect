/**
 * What people can do in a business's portal (decision 40). The owner can do everything. Staff can
 * do what the owner grants from this list; the rest (setup, the team and these permissions, the
 * free-text switch, the Act now limit) stays with the owner. Checked by apps/api on every route;
 * the portal only uses it to hide what would be refused.
 */

export const CAPABILITIES = [
  /** Approve, suggest another time, nudge and close leads (decisions 25 and 38). */
  'act_on_leads',
  /** Send an owner-approved reply template. */
  'reply_templates',
  /** Type a reply in their own words, where the owner has switched free text on (decision 39). */
  'reply_free_text',
  /** Change templates and AI instructions, and restore earlier versions (decision 27). */
  'edit_templates',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** What staff could do before permissions existed (decisions 25, 26 and 27). */
export const DEFAULT_STAFF_CAPABILITIES: readonly Capability[] = [
  'act_on_leads',
  'reply_templates',
];

/** Channels where free-text replies can be switched on; more join as channels are built. */
export const FREE_TEXT_CHANNELS = ['sms'] as const;
export type FreeTextChannel = (typeof FREE_TEXT_CHANNELS)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Everything this person can do: all of it for the owner, the granted list for staff. */
export function capabilitiesOf(
  role: 'owner' | 'staff',
  staffCapabilities: readonly string[],
): Capability[] {
  if (role === 'owner') return [...CAPABILITIES];
  return CAPABILITIES.filter((c) => staffCapabilities.includes(c));
}

export function can(
  role: 'owner' | 'staff',
  staffCapabilities: readonly string[],
  capability: Capability,
): boolean {
  return capabilitiesOf(role, staffCapabilities).includes(capability);
}
