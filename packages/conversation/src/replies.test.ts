import { describe, expect, it } from 'vitest';
import { renderReply, replyAllowed, replyOptions } from './replies.js';

const templates = {
  missed_call_text_back: 'Sorry we missed your call! Reply STOP to opt out.',
  reply_will_call: 'Thanks, {name}. Someone from Riverbend will call you shortly.',
  reply_need_address: 'Thanks, {name}. Could you text us the address for the visit?',
  reply_bad: 'Your total is {price}.',
};

describe('renderReply', () => {
  it('fills the first name only', () => {
    expect(renderReply(templates, 'reply_will_call', { name: 'Marcus T.' })).toEqual({
      ok: true,
      body: 'Thanks, Marcus. Someone from Riverbend will call you shortly.',
    });
  });

  it('reads naturally without a name', () => {
    expect(renderReply(templates, 'reply_need_address', { name: null })).toEqual({
      ok: true,
      body: 'Thanks. Could you text us the address for the visit?',
    });
  });

  it('refuses non-reply templates, missing ones and unknown placeholders', () => {
    expect(renderReply(templates, 'missed_call_text_back', { name: 'A' })).toEqual({
      ok: false,
      error: 'not_reply_template',
    });
    expect(renderReply(templates, 'reply_missing', { name: 'A' })).toEqual({
      ok: false,
      error: 'template_not_found',
    });
    expect(renderReply(templates, 'reply_bad', { name: 'A' })).toEqual({
      ok: false,
      error: 'unfilled_placeholder',
    });
  });
});

describe('replyOptions', () => {
  it('offers only renderable reply templates, in a stable order', () => {
    expect(replyOptions(templates, { name: 'Dana M.' }).map((o) => o.key)).toEqual([
      'reply_need_address',
      'reply_will_call',
    ]);
  });
});

describe('replyAllowed', () => {
  it('refuses closed leads and opted-out contacts', () => {
    expect(replyAllowed('needs_attention', false)).toEqual({ ok: true });
    expect(replyAllowed('closed', false)).toEqual({ ok: false, error: 'lead_closed' });
    expect(replyAllowed('quiet', true)).toEqual({ ok: false, error: 'opted_out' });
  });
});
