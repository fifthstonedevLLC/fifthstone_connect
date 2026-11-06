import { describe, expect, it } from 'vitest';
import { simulateTestCall, type TestCallInput } from './test-call.js';

const input: TestCallInput = {
  businessName: 'Riverbend Heating & Air',
  playbook: 'hvac',
  connectNumber: '+13195550100',
  callerName: 'Rhett Boyd',
  callerNumber: '+13195550104',
  approverName: 'Rhett Boyd',
  approverChannel: 'text',
  templates: {
    missed_call_text_back:
      'Sorry we missed your call! This is {business}. Sounds like {need}. Reply STOP to opt out.',
    slot_offer: 'Here are open times. Reply with a number: {slots}',
    request_received: 'Got it, {slot} is requested.',
    approval_request: 'New request: {summary}. {name} picked {slot}. Reply 1 to approve.',
    confirmation: "You're booked with {business} for {slot}. Reply STOP to opt out.",
  },
};

describe('simulateTestCall', () => {
  it("plays the owner's own templates through the loop, in order", () => {
    const steps = simulateTestCall(input);
    expect(steps.map((s) => s.kind)).toEqual([
      'missed_call',
      'text_to_caller',
      'caller_replies',
      'text_to_caller',
      'caller_replies',
      'text_to_caller',
      'approval_request',
      'approver_approves',
      'text_to_caller',
    ]);
    expect(steps[1]).toEqual({
      kind: 'text_to_caller',
      templateKey: 'missed_call_text_back',
      body: 'Sorry we missed your call! This is Riverbend Heating & Air. Sounds like your furnace is not heating. Reply STOP to opt out.',
    });
    expect(steps[6]).toMatchObject({
      channel: 'text',
      body: 'New request: Furnace not heating. Rhett picked Thu, Nov 12 at 2:00 PM. Reply 1 to approve.',
    });
  });

  it('shows approval in the portal for portal-approval playbooks', () => {
    const steps = simulateTestCall({ ...input, playbook: 'tattoo', approverChannel: 'portal' });
    expect(steps[6]).toEqual({
      kind: 'approval_request',
      channel: 'portal',
      approver: 'Rhett Boyd',
      body: null,
    });
    expect(steps[2]).toEqual({
      kind: 'caller_replies',
      body: 'A small forearm piece, about palm-sized.',
    });
  });

  it('marks a step whose template is missing instead of inventing words', () => {
    const templates = { ...input.templates };
    delete templates.confirmation;
    const steps = simulateTestCall({ ...input, templates });
    expect(steps.at(-1)).toEqual({
      kind: 'text_to_caller',
      templateKey: 'confirmation',
      body: null,
    });
  });

  it('keeps the clinic sample free of clinical detail', () => {
    const steps = simulateTestCall({ ...input, playbook: 'clinic', approverChannel: 'portal' });
    expect(steps[2]).toEqual({ kind: 'caller_replies', body: 'Weekday mornings work best.' });
  });
});
