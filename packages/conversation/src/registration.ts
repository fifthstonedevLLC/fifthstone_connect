import { sampleText, withoutUnfilled, type SampleValues } from './templates.js';
import type { WorkflowKey } from './playbooks.js';

/**
 * What the texting application tells the carriers (decision 35), shown to the owner before they
 * send it. Toll-free verification asks how the texts are used, how people agree to receive them
 * and what a typical text says; the sample messages come from the owner's own live templates, so
 * what is registered matches what is sent (SCOPE.md v0.2, "Template guardrails"). The use-case
 * and opt-in wording is a draft until the owner approves it (customer-facing messaging).
 */

export interface RegistrationPreview {
  useCase: string;
  optIn: string;
  /** Live templates filled with typical values, in the order a customer would get them. */
  sampleMessages: string[];
}

const BOOKED: Record<WorkflowKey, string> = {
  service_call: 'a service visit',
  estimate_visit: 'an estimate visit',
  recurring_service: 'a first service visit',
  studio_appointment: 'an appointment',
  shop_dropoff: 'a drop-off time',
};

const SAMPLE_KEYS = ['missed_call_text_back', 'slot_offer', 'confirmation'] as const;

export function registrationPreview(input: {
  businessName: string;
  workflow: WorkflowKey;
  templates: Record<string, string>;
  /**
   * What this business's customers typically need and the first question it asks. A sentence
   * that would need a value not given here is left out, so a sample never describes another
   * trade's work.
   */
  values?: Pick<SampleValues, 'need' | 'question'>;
}): RegistrationPreview {
  const { businessName } = input;
  return {
    useCase:
      `Customer care for ${businessName}. Replies only to people who called or texted the ` +
      `business: asks what they need, offers open times and confirms ${BOOKED[input.workflow]}. ` +
      'No marketing or promotional texts.',
    optIn:
      `The customer starts the conversation by calling or texting ${businessName}'s number. ` +
      'Every first text names the business and says "Reply STOP to opt out." STOP is honored ' +
      'at once and recorded.',
    sampleMessages: SAMPLE_KEYS.flatMap((key) => {
      const body = input.templates[key];
      if (body === undefined) return [];
      const values = input.values ?? {};
      return [sampleText(withoutUnfilled(body, values), businessName, values)];
    }),
  };
}
