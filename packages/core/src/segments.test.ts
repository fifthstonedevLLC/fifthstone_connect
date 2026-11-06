import { describe, expect, it } from 'vitest';
import { countSegments, findNonGsmCharacters } from './segments.js';

describe('countSegments', () => {
  it('fits 160 GSM-7 characters in one segment and splits at 153 after that', () => {
    expect(countSegments('a'.repeat(160))).toEqual({ encoding: 'gsm7', segments: 1 });
    expect(countSegments('a'.repeat(161))).toEqual({ encoding: 'gsm7', segments: 2 });
    expect(countSegments('a'.repeat(306))).toEqual({ encoding: 'gsm7', segments: 2 });
    expect(countSegments('a'.repeat(307))).toEqual({ encoding: 'gsm7', segments: 3 });
  });

  it('counts extension characters as two septets', () => {
    expect(countSegments('€'.repeat(80))).toEqual({ encoding: 'gsm7', segments: 1 });
    expect(countSegments('€'.repeat(81))).toEqual({ encoding: 'gsm7', segments: 2 });
  });

  it('drops to 70-character UCS-2 segments when one curly quote or emoji appears', () => {
    const template = `Thanks. We’ll text you once it’s confirmed. ${'a'.repeat(60)}`;
    expect(countSegments(template).encoding).toBe('ucs2');
    expect(countSegments(template).segments).toBe(2);
    expect(countSegments(template.replaceAll('’', "'"))).toEqual({
      encoding: 'gsm7',
      segments: 1,
    });
    expect(countSegments('a'.repeat(69) + '🙂').segments).toBe(2);
  });

  it('counts an empty body as zero segments', () => {
    expect(countSegments('').segments).toBe(0);
  });
});

describe('findNonGsmCharacters', () => {
  it('names each offending character once', () => {
    expect(findNonGsmCharacters('We’re here ’ 🙂')).toEqual(['’', '🙂']);
    expect(findNonGsmCharacters('Reply STOP to opt out.')).toEqual([]);
  });
});
