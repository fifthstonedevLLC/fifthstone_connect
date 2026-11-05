import { createHash } from 'node:crypto';

/**
 * Deterministic UUIDs for mock rows: the same scenario key always produces the same ID, so seed
 * files are reproducible and tests can refer to rows by key. Name-based (version 5 layout).
 */
export function mockUuid(kind: string, key: string): string {
  const hex = createHash('sha1').update(`fsc-mock:${kind}:${key}`).digest('hex').slice(0, 32);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
