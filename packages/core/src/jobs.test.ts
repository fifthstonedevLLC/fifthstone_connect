import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, INTAKE_ACTIONS, actionKey, isTerminal } from './jobs.js';
import { ExternalEventIdSchema } from './events.js';

describe('actionKey', () => {
  it('is stable and unique per lead and action', () => {
    const lead = '2b6c1f5e-0000-4000-8000-000000000001';
    expect(actionKey(lead, 'send_acknowledgment')).toBe(actionKey(lead, 'send_acknowledgment'));
    const keys = new Set(ACTION_TYPES.map((t) => actionKey(lead, t)));
    expect(keys.size).toBe(ACTION_TYPES.length);
  });
});

describe('job lifecycle', () => {
  it('treats succeeded, dead, skipped as terminal', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('dead')).toBe(true);
    expect(isTerminal('skipped')).toBe(true);
    expect(isTerminal('failed')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });

  it('does not queue the reminder at intake', () => {
    expect(INTAKE_ACTIONS).not.toContain('send_staff_reminder');
  });
});

describe('ExternalEventIdSchema', () => {
  it('accepts UUIDs and provider IDs, rejects injection-shaped values', () => {
    expect(ExternalEventIdSchema.safeParse('3f1c2a9e-1b2c-4d5e-8f90-123456789abc').success).toBe(
      true,
    );
    expect(ExternalEventIdSchema.safeParse('evt_1PqR2s:abc.def').success).toBe(true);
    expect(ExternalEventIdSchema.safeParse("x'; drop table leads;--").success).toBe(false);
    expect(ExternalEventIdSchema.safeParse('short').success).toBe(false);
  });
});
