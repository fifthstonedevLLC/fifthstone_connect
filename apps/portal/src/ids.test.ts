import { describe, expect, it } from 'vitest';
import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('uses randomUUID where the page is secure', () => {
    expect(newId(crypto)).toMatch(UUID_V4);
  });

  it('still makes a valid, unique ID on a plain-http page, where randomUUID is missing', () => {
    // A phone on the local network: getRandomValues only.
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = new Set(Array.from({ length: 200 }, () => newId(insecure)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
