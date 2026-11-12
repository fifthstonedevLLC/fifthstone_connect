import { describe, expect, it } from 'vitest';
import {
  BusinessHoursListSchema,
  BusinessProfileSchema,
  normalizeEin,
  ONBOARDING_STEPS,
  goLiveProblems,
  onboardingSteps,
  readyToApply,
  setupDone,
  setupStage,
} from './onboarding.js';

const profile = {
  legalName: ' Riverbend  Heating & Air LLC ',
  ein: '001234567',
  street: '9900 Main St',
  city: 'Cedar Falls',
  region: 'ia',
  postalCode: '50613',
  website: 'https://riverbend.example.com',
  contactName: 'Rhett Boyd',
  contactEmail: 'Rhett@Riverbend.Example.com',
  contactPhone: '(319) 555-0104',
};

describe('normalizeEin', () => {
  it('accepts nine digits with or without the dash', () => {
    expect(normalizeEin('001234567')).toBe('00-1234567');
    expect(normalizeEin('00-1234567')).toBe('00-1234567');
    // Written like a Social Security number: refused, never reformatted.
    expect(normalizeEin('123-45-6789')).toBeNull();
    expect(normalizeEin('12345678')).toBeNull();
  });
});

describe('BusinessProfileSchema', () => {
  it('normalizes what the owner typed', () => {
    expect(BusinessProfileSchema.parse(profile)).toEqual({
      legalName: 'Riverbend Heating & Air LLC',
      ein: '00-1234567',
      street: '9900 Main St',
      city: 'Cedar Falls',
      region: 'IA',
      postalCode: '50613',
      website: 'https://riverbend.example.com',
      contactName: 'Rhett Boyd',
      contactEmail: 'rhett@riverbend.example.com',
      contactPhone: '+13195550104',
    });
  });

  it('treats a blank EIN or website as not given', () => {
    const parsed = BusinessProfileSchema.parse({ ...profile, ein: ' ', website: '' });
    expect(parsed.ein).toBeUndefined();
    expect(parsed.website).toBeUndefined();
  });

  it('refuses malformed values', () => {
    const bad = (over: Record<string, string>) =>
      BusinessProfileSchema.safeParse({ ...profile, ...over }).success;
    expect(bad({ ein: '1234' })).toBe(false);
    const ssn = BusinessProfileSchema.safeParse({ ...profile, ein: '123-45-6789' });
    expect(ssn.error?.issues[0]?.message).toMatch(/Social Security number/);
    expect(bad({ region: 'XX' })).toBe(false);
    expect(bad({ postalCode: '5061' })).toBe(false);
    expect(bad({ website: 'ftp://riverbend.example.com' })).toBe(false);
    expect(bad({ contactPhone: '555' })).toBe(false);
    expect(bad({ legalName: '  ' })).toBe(false);
  });
});

describe('BusinessHoursListSchema', () => {
  it('allows a lunch break but not overlapping blocks', () => {
    const morning = { days: [1, 2], open: '08:00', close: '12:00' };
    expect(
      BusinessHoursListSchema.safeParse([morning, { days: [1], open: '13:00', close: '17:00' }])
        .success,
    ).toBe(true);
    expect(
      BusinessHoursListSchema.safeParse([morning, { days: [2], open: '11:00', close: '15:00' }])
        .success,
    ).toBe(false);
    expect(BusinessHoursListSchema.safeParse([]).success).toBe(false);
  });
});

describe('onboardingSteps', () => {
  const none = {
    typeConfirmed: false,
    profileSaved: false,
    hoursSet: false,
    calendarConnected: false,
    templatesReviewed: false,
    approvers: 0,
    testRun: false,
    applicationSent: false,
    textingDeclined: false,
  };

  it('lists the seven steps in order, none done for a new business', () => {
    expect(onboardingSteps(none)).toEqual(
      ['business_type', 'details', 'hours', 'templates', 'team', 'test', 'texting'].map((key) => ({
        key,
        done: false,
      })),
    );
  });

  it('needs both hours and a connected calendar for the hours step', () => {
    const hours = (facts: Partial<typeof none>) =>
      onboardingSteps({ ...none, ...facts }).find((s) => s.key === 'hours')?.done;
    expect(hours({ hoursSet: true })).toBe(false);
    expect(hours({ hoursSet: true, calendarConnected: true })).toBe(true);
  });

  it('needs at least one approver for the team step', () => {
    expect(onboardingSteps({ ...none, approvers: 1 }).find((s) => s.key === 'team')?.done).toBe(
      true,
    );
  });

  it('counts the texting step done once the owner applies or chooses no texting (decision 36)', () => {
    const texting = (facts: Partial<typeof none>) =>
      onboardingSteps({ ...none, ...facts }).find((s) => s.key === 'texting')?.done;
    expect(texting({})).toBe(false);
    expect(texting({ applicationSent: true })).toBe(true);
    expect(texting({ textingDeclined: true })).toBe(true);
  });
});

describe('setup stage and go-live', () => {
  const allDone = ONBOARDING_STEPS.map((key) => ({ key, done: true }));

  it('is live only when Fifth Stone Dev has turned the business on', () => {
    expect(setupStage(false, false)).toBe('setting_up');
    expect(setupStage(false, true)).toBe('ready');
    expect(setupStage(true, false)).toBe('live');
  });

  it('allows the application once every step before it is done', () => {
    const before = allDone.map((s) => (s.key === 'texting' ? { ...s, done: false } : s));
    expect(readyToApply(before)).toBe(true);
    expect(setupDone(before)).toBe(false);
    expect(readyToApply(before.map((s) => (s.key === 'test' ? { ...s, done: false } : s)))).toBe(
      false,
    );
  });

  it('goes live on finished setup and a number, never on texting approval', () => {
    const ok = { status: 'onboarding' as const, setupDone: true, connectNumber: '+13195550100' };
    expect(goLiveProblems(ok)).toEqual([]);
    expect(goLiveProblems({ ...ok, setupDone: false, connectNumber: null })).toEqual([
      'setup_incomplete',
      'no_number',
    ]);
    expect(goLiveProblems({ ...ok, status: 'active' })).toEqual(['already_live']);
    expect(goLiveProblems({ ...ok, status: 'disabled' })).toEqual(['disabled']);
  });
});
