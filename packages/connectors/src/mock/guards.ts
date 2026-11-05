/**
 * Mock data stays mock (CLAUDE.md rule 17): mock adapters refuse any phone number or email
 * address outside the fictional ranges, so a real customer value can never pass through a test
 * or demo unnoticed. Errors name the field, never the value.
 */

const MOCK_PHONE = /^\+131955501\d\d$/;
const RESERVED_EMAIL_DOMAIN = /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i;

export function assertMockPhone(value: string, field: string): void {
  if (!MOCK_PHONE.test(value)) {
    throw new Error(`Mock connectors accept only +1 319 555-0100 to 555-0199 (${field})`);
  }
}

/** Accepts a bare address or "Display Name <address>". */
export function assertMockEmail(value: string, field: string): void {
  const address = /<([^<>]+)>\s*$/.exec(value)?.[1] ?? value.trim();
  if (!RESERVED_EMAIL_DOMAIN.test(address)) {
    throw new Error(`Mock connectors accept only example.com, .org or .net addresses (${field})`);
  }
}
