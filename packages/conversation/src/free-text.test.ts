import { describe, expect, it } from 'vitest';
import { FREE_TEXT_MAX_SEGMENTS, checkFreeText } from './free-text.js';

const context = { businessName: 'Northline Ink', firstText: false };

describe('checkFreeText', () => {
  it('accepts a short reply, trimmed, with its segment count', () => {
    expect(checkFreeText('  Your order shipped today; tracking to follow.  ', context)).toEqual({
      ok: true,
      body: 'Your order shipped today; tracking to follow.',
      segments: 1,
    });
  });

  it('refuses an empty reply and one longer than a conversation', () => {
    expect(checkFreeText('   ', context)).toEqual({ ok: false, error: 'empty' });
    const long = 'word '.repeat(FREE_TEXT_MAX_SEGMENTS * 40);
    expect(checkFreeText(long, context)).toEqual({ ok: false, error: 'too_long' });
  });

  it('names the business the first time it texts someone', () => {
    expect(checkFreeText('Hi, we can fit you in Friday.', { ...context, firstText: true })).toEqual(
      { ok: false, error: 'needs_business_name' },
    );
    expect(
      checkFreeText('Hi, this is northline ink. We can fit you in Friday.', {
        ...context,
        firstText: true,
      }).ok,
    ).toBe(true);
  });
});
