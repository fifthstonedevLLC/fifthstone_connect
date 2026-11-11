import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from './playbooks.js';
import { registrationPreview } from './registration.js';

describe('registrationPreview', () => {
  const shop = WORKFLOWS.find((w) => w.key === 'shop_dropoff')!;

  it("names the business, the booking and the opt-out, with the owner's own wording", () => {
    const preview = registrationPreview({
      businessName: 'Cedar Lane Lawn Care',
      workflow: 'shop_dropoff',
      templates: shop.templates,
      values: { need: 'your mower will not start', question: 'What is the machine?' },
    });
    expect(preview.sampleMessages[0]).toBe(
      'Sorry we missed your call! This is Cedar Lane Lawn Care. Sounds like your mower will not start. What is the machine? Reply STOP to opt out.',
    );
    expect(preview.useCase).toContain('Cedar Lane Lawn Care');
    expect(preview.useCase).toContain('a drop-off time');
    expect(preview.useCase).toContain('No marketing');
    expect(preview.optIn).toContain('Reply STOP to opt out.');
    expect(preview.sampleMessages).toHaveLength(3);
    expect(preview.sampleMessages[0]).toContain('This is Cedar Lane Lawn Care.');
    expect(preview.sampleMessages.join(' ')).not.toMatch(/[{}]/);
  });

  it("drops a sentence it has no value for, so a sample never borrows another trade's words", () => {
    const preview = registrationPreview({
      businessName: 'Cedar Lane Lawn Care',
      workflow: 'shop_dropoff',
      templates: shop.templates,
    });
    expect(preview.sampleMessages[0]).toBe(
      'Sorry we missed your call! This is Cedar Lane Lawn Care. Reply STOP to opt out.',
    );
  });

  it('leaves out a sample whose template is missing instead of inventing one', () => {
    const preview = registrationPreview({
      businessName: 'Cedar Lane Lawn Care',
      workflow: 'service_call',
      templates: {
        confirmation: "You're booked with {business} for {slot}. Reply STOP to opt out.",
      },
    });
    expect(preview.sampleMessages).toEqual([
      "You're booked with Cedar Lane Lawn Care for Thu, Nov 12 at 2:00 PM. Reply STOP to opt out.",
    ]);
  });
});
