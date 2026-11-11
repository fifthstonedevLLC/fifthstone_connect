/**
 * A random ID (UUID v4) for a one-time key, such as the ID that stops a reply or a save being
 * sent twice. `crypto.randomUUID` exists only on secure pages (https or localhost); a phone on
 * the local network opens the portal over plain http, where it is missing and calling it would
 * blank the page. `crypto.getRandomValues` works everywhere, so it builds the same kind of ID.
 */
export function newId(
  cryptoApi: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto,
): string {
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
