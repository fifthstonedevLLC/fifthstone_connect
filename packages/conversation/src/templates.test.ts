import { describe, expect, it } from 'vitest';
import {
  checkTemplate,
  checkTemplateSet,
  formatSlot,
  MAX_TEMPLATE_SEGMENTS,
  renderTemplate,
  sampleText,
  templateRule,
} from './templates.js';

const BUSINESS = 'Riverbend Heating & Air';
const codes = (key: string, body: string) =>
  checkTemplate(key, body, BUSINESS).problems.map((p) => p.code);

describe('templateRule', () => {
  it('knows the engine templates and every reply template', () => {
    expect(templateRule('confirmation')?.requires).toEqual(['business', 'slot']);
    expect(templateRule('reply_will_call')?.label).toBe('Reply: will call');
    expect(templateRule('reply_')).toBeNull();
    expect(templateRule('free_text')).toBeNull();
  });
});

describe('checkTemplate', () => {
  it('accepts wording that keeps the required pieces', () => {
    expect(
      codes(
        'missed_call_text_back',
        'Hi, this is {business}. Sorry we missed you. What do you need? Reply STOP to opt out.',
      ),
    ).toEqual([]);
  });

  it('keeps the business name and opt-out line in a first text', () => {
    expect(codes('missed_call_text_back', 'Sorry we missed your call!')).toEqual([
      'missing_placeholder',
      'missing_opt_out',
    ]);
    expect(codes('confirmation', "You're booked for {slot}. Text STOP to unsubscribe.")).toEqual([
      'missing_placeholder',
    ]);
  });

  it('accepts the business name written out instead of {business}', () => {
    expect(
      codes(
        'out_of_scope',
        "Thanks for reaching out to Riverbend Heating & Air. That's not work we do.",
      ),
    ).toEqual([]);
  });

  it('keeps the time in an offer and a confirmation', () => {
    expect(codes('slot_offer', 'Here are open times.')).toEqual(['missing_placeholder']);
  });

  it('refuses placeholders the engine cannot fill there, and stray braces', () => {
    expect(codes('reply_will_call', 'Thanks, {name}. Your price is {price}.')).toEqual([
      'unknown_placeholder',
    ]);
    expect(codes('reply_will_call', 'Thanks, {Name}.')).toEqual(['stray_brace']);
  });

  it('refuses curly quotes and emoji, naming them', () => {
    const check = checkTemplate('reply_will_call', 'We’ll call you soon 🙂', BUSINESS);
    expect(check.problems).toEqual([{ code: 'non_gsm', characters: ['’', '🙂'] }]);
  });

  it('counts segments as sent and refuses a template over the limit', () => {
    expect(checkTemplate('reply_will_call', 'Thanks, {name}.', BUSINESS).segments).toBe(1);
    const long = checkTemplate('reply_will_call', 'a'.repeat(400), BUSINESS);
    expect(long.segments).toBeGreaterThan(MAX_TEMPLATE_SEGMENTS);
    expect(long.problems.map((p) => p.code)).toEqual(['too_long']);
  });

  it('refuses empty wording and unknown templates', () => {
    expect(codes('reply_will_call', '   ')).toEqual(['empty']);
    expect(codes('free_text', 'Hello')).toEqual(['unknown_template']);
  });
});

describe('sampleText', () => {
  it('fills the business name and typical values', () => {
    expect(sampleText('{business}: {slot}', BUSINESS)).toBe(`${BUSINESS}: Thu, Nov 12 at 2:00 PM`);
  });
});

describe('checkTemplateSet', () => {
  const current = { reply_will_call: 'Thanks, {name}.', slot_offer: 'Pick one: {slots}' };

  it('returns trimmed wording when every template passes', () => {
    expect(
      checkTemplateSet(
        Object.keys(current),
        { ...current, reply_will_call: ' Hi {name}. ' },
        BUSINESS,
      ),
    ).toEqual({
      ok: true,
      content: { reply_will_call: 'Hi {name}.', slot_offer: 'Pick one: {slots}' },
    });
  });

  it('refuses adding or removing templates', () => {
    expect(checkTemplateSet(Object.keys(current), { reply_will_call: 'Hi.' }, BUSINESS)).toEqual({
      ok: false,
      error: 'template_keys_changed',
    });
  });

  it('lists the problems for each template that fails', () => {
    expect(
      checkTemplateSet(Object.keys(current), { ...current, slot_offer: 'No times.' }, BUSINESS),
    ).toEqual({
      ok: false,
      error: 'template_problems',
      problems: [
        { key: 'slot_offer', problems: [{ code: 'missing_placeholder', placeholder: 'slots' }] },
      ],
    });
  });
});

describe('renderTemplate', () => {
  it('fills every placeholder for sending', () => {
    expect(
      renderTemplate("You're booked with {business} for {slot}.", {
        business: 'Riverbend',
        slot: 'Thu, Nov 12 at 2:00 PM',
      }),
    ).toEqual({ ok: true, body: "You're booked with Riverbend for Thu, Nov 12 at 2:00 PM." });
  });

  it('refuses to send a text with an unfilled placeholder', () => {
    expect(renderTemplate('Booked for {slot} at {address}.', { slot: 'Thu' })).toEqual({
      ok: false,
      missing: ['address'],
    });
  });
});

describe('formatSlot', () => {
  it('reads like the slot in a text, in the business time zone', () => {
    expect(formatSlot(new Date('2026-11-12T20:00:00Z'), 'America/Chicago')).toBe(
      'Thu, Nov 12 at 2:00 PM',
    );
  });
});
