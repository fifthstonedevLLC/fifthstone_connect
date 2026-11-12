import { describe, expect, it } from 'vitest';
import { CAPABILITIES, DEFAULT_STAFF_CAPABILITIES, can, capabilitiesOf } from './permissions.js';

describe('permissions', () => {
  it('gives the owner everything, whatever staff are granted', () => {
    expect(capabilitiesOf('owner', [])).toEqual([...CAPABILITIES]);
    expect(can('owner', [], 'reply_free_text')).toBe(true);
  });

  it('gives staff only what the owner granted, ignoring unknown names', () => {
    expect(capabilitiesOf('staff', ['reply_templates', 'make_coffee'])).toEqual([
      'reply_templates',
    ]);
    expect(can('staff', ['reply_templates'], 'edit_templates')).toBe(false);
  });

  it('starts staff where they were before permissions existed', () => {
    expect(capabilitiesOf('staff', DEFAULT_STAFF_CAPABILITIES)).toEqual([
      'act_on_leads',
      'reply_templates',
    ]);
  });
});
