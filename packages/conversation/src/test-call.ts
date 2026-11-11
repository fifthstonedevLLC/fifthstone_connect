import { trade } from './playbooks.js';
import { sampleText, type SampleValues } from './templates.js';

/**
 * The simulated test call for onboarding (SCOPE.md v0.2, step 6 "Test it"). Until texting is live
 * there is no real call to make, so this plays the owner's own live templates through the loop
 * the way a real missed call would go: the owner is the caller, then the approver. Nothing is
 * sent and no lead is created (CLAUDE.md rule 5: a simulation is labeled as one).
 */

export type TestCallStep =
  | { kind: 'missed_call'; to: string | null; from: string | null }
  | { kind: 'text_to_caller'; templateKey: string; body: string | null }
  | { kind: 'caller_replies'; body: string }
  | { kind: 'approval_request'; channel: 'text'; approver: string | null; body: string | null }
  | { kind: 'approval_request'; channel: 'portal'; approver: string | null; body: null }
  | { kind: 'approver_approves'; channel: 'text' | 'portal' };

export interface TestCallInput {
  businessName: string;
  /** The trade the business chose (decision 34); its sample is what the caller says. */
  trade: string | null;
  /** The business's Fifth Stone Connect number. */
  connectNumber: string | null;
  /** The person running the test, who plays the customer, and their mobile. */
  callerName: string | null;
  callerNumber: string | null;
  /** Who receives approval requests; often the same person. */
  approverName: string | null;
  approverChannel: 'text' | 'portal';
  templates: Record<string, string>;
}

/** What the caller says when no trade is chosen yet. */
const GENERAL_SAMPLE: { reply: string; values: SampleValues } = {
  reply: 'I need some help. 9900 Main St.',
  values: { need: 'you need some help', summary: 'New request' },
};

export function simulateTestCall(input: TestCallInput): TestCallStep[] {
  const sample = (input.trade ? trade(input.trade)?.sample : null) ?? GENERAL_SAMPLE;
  const values: SampleValues = { ...sample.values, name: firstName(input.callerName) };
  const text = (templateKey: string): TestCallStep => {
    const template = input.templates[templateKey];
    return {
      kind: 'text_to_caller',
      templateKey,
      body: template === undefined ? null : sampleText(template, input.businessName, values),
    };
  };
  const approvalTemplate = input.templates.approval_request;

  return [
    { kind: 'missed_call', to: input.connectNumber, from: input.callerNumber },
    text('missed_call_text_back'),
    { kind: 'caller_replies', body: sample.reply },
    text('slot_offer'),
    { kind: 'caller_replies', body: '1' },
    text('request_received'),
    input.approverChannel === 'text'
      ? {
          kind: 'approval_request',
          channel: 'text',
          approver: input.approverName,
          body:
            approvalTemplate === undefined
              ? null
              : sampleText(approvalTemplate, input.businessName, values),
        }
      : { kind: 'approval_request', channel: 'portal', approver: input.approverName, body: null },
    { kind: 'approver_approves', channel: input.approverChannel },
    text('confirmation'),
  ];
}

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'You';
}
