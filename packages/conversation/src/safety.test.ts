import { describe, expect, it } from 'vitest';
import { countSegments } from '@fsc/core/segments';
import { detectHazard, emergencyAlert, HAZARDS, safetyMessage } from './safety.js';

describe('detectHazard', () => {
  it('finds a gas smell, flooding and crisis language in plain words', () => {
    expect(detectHazard("There's a strong gas smell by the furnace")).toBe('gas');
    expect(detectHazard('I smell gas in the basement')).toBe('gas');
    expect(detectHazard('Basement is flooding, pipe burst')).toBe('water');
    expect(detectHazard('Water is pouring through the ceiling')).toBe('water');
    expect(detectHazard("I don't want to be alive anymore")).toBe('crisis');
    expect(detectHazard('thinking about killing myself')).toBe('crisis');
    expect(detectHazard("I don't know if I can keep going.")).toBe('crisis');
    expect(detectHazard("I can't take it anymore")).toBe('crisis');
  });

  it('puts someone at risk first when there is more than one', () => {
    expect(detectHazard('I smell gas and I want to die')).toBe('crisis');
  });

  it('does not fire on ordinary messages', () => {
    for (const text of [
      'My gas furnace is not heating',
      'Gas water heater is leaking a little',
      'Need a tune-up for my gas stove',
      'Can you come this week?',
      '9941 Elm St, Cedar Falls',
      "The furnace can't keep going like this",
      'Can you keep going with the install tomorrow?',
    ]) {
      expect(detectHazard(text), text).toBeNull();
    }
  });
});

describe('safetyMessage', () => {
  it('points to 911 only for a crisis, never 988', () => {
    const crisis = safetyMessage('crisis', 'Prairie Path Counseling');
    expect(crisis).toContain('911');
    expect(crisis).not.toContain('988');
  });

  it('names the business and fits a short text for every hazard', () => {
    for (const hazard of HAZARDS) {
      const text = safetyMessage(hazard, 'Riverbend Heating & Air');
      expect(text).toContain('Riverbend Heating & Air');
      expect(text).toContain('911');
      expect(countSegments(text).segments, hazard).toBeLessThanOrEqual(2);
    }
  });
});

describe('emergencyAlert', () => {
  it('names the caller and how to reach them for a hazard', () => {
    expect(emergencyAlert('gas', { name: 'Greg V.', phone: '(319) 555-0141' })).toBe(
      'Urgent: Greg V. reported a gas smell. The safety message went out. Call them now at (319) 555-0141.',
    );
  });

  it('never repeats what was written in a crisis', () => {
    const alert = emergencyAlert('crisis', { name: 'Joy A.', phone: '(319) 555-0147' });
    expect(alert).not.toContain('Joy');
    expect(alert).not.toContain('555');
    expect(alert).toMatch(/^Urgent: a new message needs a person now\./);
  });
});
