/**
 * Text and contact normalization. Pure functions, no I/O.
 * Applied before validation so stored leads have one consistent shape.
 */

// C0/C1 control characters except tab and newline.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Strip control characters, trim, and collapse runs of spaces/tabs. Keeps line breaks. */
export function cleanText(value: string): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** Single-line text: like cleanText but newlines become spaces (names, subjects). */
export function cleanLine(value: string): string {
  return cleanText(value).replace(/\s*\n\s*/g, ' ');
}

export function normalizeEmail(value: string): string {
  return cleanLine(value).toLowerCase();
}

/**
 * Normalize a phone number to E.164 where possible.
 * MVP assumes North American numbers (pilot market). Returns null when the value
 * cannot be read as a valid NANP number or an explicit +country number.
 */
export function normalizePhone(value: string): string | null {
  const trimmed = cleanLine(value);
  if (trimmed === '') return null;
  const hasPlus = trimmed.startsWith('+');
  // Drop a trailing extension ("x123", "ext. 45").
  const withoutExt = trimmed.replace(/\s*(?:x|ext\.?)\s*\d+$/i, '');
  const digits = withoutExt.replace(/\D/g, '');

  if (hasPlus) {
    if (digits.startsWith('1')) return isNanp(digits.slice(1)) ? `+${digits}` : null;
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10 && isNanp(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && isNanp(digits.slice(1)))
    return `+${digits}`;
  return null;
}

/** NANP: area code and exchange each start with 2–9. */
function isNanp(tenDigits: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits);
}
