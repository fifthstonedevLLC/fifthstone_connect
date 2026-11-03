import { describe, expect, it } from 'vitest';
import { cleanLine, cleanText, normalizeEmail, normalizePhone } from './normalize.js';

describe('cleanText', () => {
  it('trims, collapses spaces, and keeps paragraph breaks', () => {
    expect(cleanText('  Leaky   faucet\r\n\r\n\r\n\r\nkitchen  ')).toBe('Leaky faucet\n\nkitchen');
  });
  it('removes control characters', () => {
    expect(cleanText('ab\u0000c\u0007d\u009f')).toBe('abcd');
  });
});

describe('cleanLine', () => {
  it('flattens newlines into single spaces', () => {
    expect(cleanLine(' Jane\n  Doe ')).toBe('Jane Doe');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['(319) 555-0142', '+13195550142'],
    ['319.555.0142', '+13195550142'],
    ['1-319-555-0142', '+13195550142'],
    ['+1 319 555 0142', '+13195550142'],
    ['319-555-0142 ext. 12', '+13195550142'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['555-0142', '119-555-0142', '319-055-0142', 'call me', '', '+1 119 555 0142'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});
