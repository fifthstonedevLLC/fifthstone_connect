import type { AiSettings } from '@fsc/core';
import type { SampleValues } from './templates.js';

/**
 * Business types on one engine (decision 34). A workflow is how a booking works: a service call,
 * an estimate visit, a first visit for recurring work, a studio appointment or a shop drop-off.
 * A trade is a starting point inside one workflow: the questions, AI instructions and job length a
 * typical business of that kind starts from. The owner picks both in Setup; picking applies the
 * starter wording and instructions as new versions they can edit or restore (Templates & AI).
 *
 * Nothing here is code that runs differently per trade: every business runs the same loop, and
 * the safety phrase list applies to all of them (CLAUDE.md rules 10 and 11). The catalog's keys,
 * names, approval channels and job lengths match `app.playbooks` and `app.trades`; the API's
 * database tests hold the two together. Starter wording is a draft until the owner approves it
 * (customer-facing messaging needs owner approval).
 */

export const WORKFLOW_KEYS = [
  'service_call',
  'estimate_visit',
  'recurring_service',
  'studio_appointment',
  'shop_dropoff',
] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

export interface Workflow {
  key: WorkflowKey;
  name: string;
  /** One line for the tile: what the customer ends up booked into. */
  summary: string;
  /** Who approves and where: by text for people on the road, in the portal for a front desk. */
  approverChannel: 'text' | 'portal';
  /**
   * How long a lead may wait on the business before it goes to Act now (decision 37). Copied to
   * the business when it picks this workflow; repairs and drop-offs go stale fastest.
   */
  actNowAfterHours: number;
  /** The starter template set; every key the engine sends at a fixed point. */
  templates: Record<string, string>;
}

export interface Trade {
  key: string;
  workflow: WorkflowKey;
  name: string;
  /** Length of a booking, in minutes; the owner can change it later. */
  jobMinutes: number;
  ai: AiSettings;
  /** What the owner, playing the customer, says in the simulated test call. */
  sample: { reply: string; values: SampleValues };
}

// Replies staff send from the portal (decision 26); the same in every workflow.
const REPLIES = {
  reply_will_call: 'Thanks, {name}. Someone from {business} will call you shortly.',
  reply_need_address: 'Thanks, {name}. Could you text us the address?',
  reply_after_hours:
    "Thanks for reaching out to {business}. We're closed right now and will reply when we open.",
};

const OUT_OF_SCOPE =
  "Thanks for reaching out to {business}. That's not work we do, sorry we can't help.";

const TEXT_BACK =
  'Sorry we missed your call! This is {business}. Sounds like {need}. {question} Reply STOP to opt out.';

export const WORKFLOWS: readonly Workflow[] = [
  {
    key: 'service_call',
    name: 'Service call',
    summary: 'A visit to fix something, sooner when it is urgent.',
    approverChannel: 'text',
    actNowAfterHours: 4,
    templates: {
      missed_call_text_back: TEXT_BACK,
      slot_offer: 'Thanks. Here are open times for a visit. Reply with a number: {slots}',
      request_received: "Got it, {slot} is requested. We'll text you a confirmation shortly.",
      confirmation: "You're booked with {business} for {slot}. Reply STOP to opt out.",
      approval_request:
        'New service call: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      out_of_scope: OUT_OF_SCOPE,
      ...REPLIES,
    },
  },
  {
    key: 'estimate_visit',
    name: 'Estimate visit',
    summary: 'A visit to look at the job and give a quote.',
    approverChannel: 'text',
    actNowAfterHours: 24,
    templates: {
      missed_call_text_back: TEXT_BACK,
      slot_offer: 'Thanks. Here are open times for an estimate visit. Reply with a number: {slots}',
      request_received: "Got it, {slot} is requested. We'll text you a confirmation shortly.",
      confirmation: 'Your estimate visit with {business} is set for {slot}. Reply STOP to opt out.',
      approval_request:
        'New estimate visit: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      out_of_scope: OUT_OF_SCOPE,
      ...REPLIES,
    },
  },
  {
    key: 'recurring_service',
    name: 'Recurring service',
    summary: 'A first visit; the regular schedule is set up with a person after that.',
    approverChannel: 'text',
    actNowAfterHours: 24,
    templates: {
      missed_call_text_back: TEXT_BACK,
      slot_offer: 'Thanks. Here are open times for a first visit. Reply with a number: {slots}',
      request_received: "Got it, {slot} is requested. We'll text you a confirmation shortly.",
      confirmation:
        "Your first visit with {business} is set for {slot}. We'll set up your regular schedule then. Reply STOP to opt out.",
      approval_request:
        'New first visit: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      out_of_scope: OUT_OF_SCOPE,
      ...REPLIES,
    },
  },
  {
    key: 'studio_appointment',
    name: 'Studio appointment',
    summary: 'A consult or session at your place, approved at the front desk.',
    approverChannel: 'portal',
    actNowAfterHours: 24,
    templates: {
      missed_call_text_back: TEXT_BACK,
      slot_offer: 'Thanks. Here are open appointment times. Reply with a number: {slots}',
      request_received: "Got it, {slot} is requested. We'll text you a confirmation shortly.",
      confirmation: 'Your appointment at {business} is set for {slot}. Reply STOP to opt out.',
      approval_request:
        'New appointment: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      out_of_scope: OUT_OF_SCOPE,
      ...REPLIES,
    },
  },
  {
    key: 'shop_dropoff',
    name: 'Shop drop-off',
    summary: 'A time to bring the item in; the work happens at your shop.',
    approverChannel: 'text',
    actNowAfterHours: 8,
    templates: {
      missed_call_text_back: TEXT_BACK,
      slot_offer: 'Thanks. Here are open drop-off times. Reply with a number: {slots}',
      request_received: "Got it, drop-off at {slot} is requested. We'll text you a confirmation.",
      confirmation: "You're set to drop off at {business} at {slot}. Reply STOP to opt out.",
      approval_request:
        'New drop-off: {summary}. {name} picked {slot}. Reply 1 to approve, 2 to suggest another time, 3 to call.',
      out_of_scope: OUT_OF_SCOPE,
      ...REPLIES,
    },
  },
];

const URGENCY = 'How soon: 1 today, 2 this week, 3 flexible?';

export const TRADES: readonly Trade[] = [
  // Service call -----------------------------------------------------------------------------
  {
    key: 'hvac',
    workflow: 'service_call',
    name: 'Heating and cooling',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential furnace, AC, heat pump and water heater repair and maintenance.',
      what_we_dont_do: ['Commercial buildings'],
      emergency: 'No heat in freezing weather, gas smell, carbon monoxide alarm, active leaks.',
      questions: ['What is the problem?', 'What is the address?', URGENCY],
      tone: 'Plain and friendly. Short sentences.',
    },
    sample: {
      reply: 'My furnace stopped heating. 9900 Main St.',
      values: { need: 'your furnace is not heating', summary: 'Furnace not heating' },
    },
  },
  {
    key: 'plumbing',
    workflow: 'service_call',
    name: 'Plumbing',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential plumbing repair: leaks, clogs, water heaters, toilets and fixtures.',
      what_we_dont_do: ['Commercial buildings', 'Septic systems'],
      emergency: 'Active flooding, burst pipes, sewage backing up, no water at all.',
      questions: ['What is the problem?', 'What is the address?', URGENCY],
      tone: 'Plain and friendly. Short sentences.',
    },
    sample: {
      reply: 'Kitchen sink is leaking under the cabinet. 9900 Main St.',
      values: { need: 'your kitchen sink is leaking', summary: 'Kitchen sink leak' },
    },
  },
  {
    key: 'electrical',
    workflow: 'service_call',
    name: 'Electrical',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential electrical repair: outlets, breakers, lighting and fixtures.',
      what_we_dont_do: ['Commercial buildings'],
      emergency: 'Burning smell, sparking, smoke from an outlet or panel, power out to the home.',
      questions: ['What is the problem?', 'What is the address?', URGENCY],
      tone: 'Plain and friendly. Short sentences.',
    },
    sample: {
      reply: 'Half the outlets in the kitchen stopped working. 9900 Main St.',
      values: { need: 'some outlets stopped working', summary: 'Kitchen outlets out' },
    },
  },
  {
    key: 'garage_door',
    workflow: 'service_call',
    name: 'Garage doors',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Garage door and opener repair: springs, cables, openers and off-track doors.',
      emergency: 'A door stuck open or a car trapped inside.',
      questions: ['What is going on with the door?', 'What is the address?', URGENCY],
      tone: 'Plain and friendly. Short sentences.',
    },
    sample: {
      reply: 'The spring snapped and the door will not open. 9900 Main St.',
      values: { need: 'your garage door will not open', summary: 'Broken spring' },
    },
  },
  {
    key: 'service_other',
    workflow: 'service_call',
    name: 'Other repair or service',
    jobMinutes: 60,
    ai: {
      questions: ['What do you need help with?', 'What is the address?', URGENCY],
      tone: 'Plain and friendly. Short sentences.',
    },
    sample: {
      reply: 'Something needs fixing at the house. 9900 Main St.',
      values: { need: 'something needs fixing', summary: 'Repair at home' },
    },
  },

  // Estimate visit ---------------------------------------------------------------------------
  {
    key: 'roofing',
    workflow: 'estimate_visit',
    name: 'Roofing',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential roof repair and replacement, gutters and storm damage.',
      what_we_dont_do: ['Commercial flat roofs'],
      emergency: 'An active leak into the home or storm damage open to the weather.',
      questions: [
        'What is going on with the roof?',
        'What is the address?',
        'When are you hoping to get it done?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Missing shingles after the storm. 9900 Main St.',
      values: { need: 'you have storm damage on the roof', summary: 'Storm damage, shingles' },
    },
  },
  {
    key: 'remodeling',
    workflow: 'estimate_visit',
    name: 'Remodeling',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Kitchen, bath and basement remodels and repairs.',
      questions: [
        'What project do you have in mind?',
        'What is the address?',
        'When are you hoping to start?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Looking to redo our main bathroom. 9900 Main St.',
      values: { need: "you'd like a bathroom remodel", summary: 'Bathroom remodel' },
    },
  },
  {
    key: 'painting',
    workflow: 'estimate_visit',
    name: 'Painting',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Interior and exterior house painting.',
      questions: [
        'Inside, outside or both?',
        'What is the address?',
        'When are you hoping to get it done?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Outside of the house needs painting. 9900 Main St.',
      values: { need: "you'd like the outside painted", summary: 'Exterior paint' },
    },
  },
  {
    key: 'landscaping',
    workflow: 'estimate_visit',
    name: 'Landscaping and hardscape',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Landscape design and install, patios, retaining walls and plantings.',
      questions: [
        'What project do you have in mind?',
        'What is the address?',
        'When are you hoping to get it done?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'We want a new patio out back. 9900 Main St.',
      values: { need: "you'd like a new patio", summary: 'New patio' },
    },
  },
  {
    key: 'estimate_other',
    workflow: 'estimate_visit',
    name: 'Other project work',
    jobMinutes: 60,
    ai: {
      questions: [
        'What project do you have in mind?',
        'What is the address?',
        'When are you hoping to get it done?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'I have a project I would like a quote on. 9900 Main St.',
      values: { need: "you'd like a quote", summary: 'Project quote' },
    },
  },

  // Recurring service ------------------------------------------------------------------------
  {
    key: 'lawn_care',
    workflow: 'recurring_service',
    name: 'Lawn care',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential mowing, trimming, fertilizing and seasonal cleanups.',
      questions: [
        'What service are you looking for?',
        'What is the address?',
        'How often: 1 weekly, 2 every two weeks, 3 one time?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Weekly mowing for a small yard. 9900 Main St.',
      values: { need: "you'd like weekly mowing", summary: 'Weekly mowing' },
    },
  },
  {
    key: 'house_cleaning',
    workflow: 'recurring_service',
    name: 'House cleaning',
    jobMinutes: 120,
    ai: {
      what_we_do: 'Residential house cleaning, regular and deep cleans.',
      questions: [
        'How many bedrooms and bathrooms?',
        'What is the address?',
        'How often: 1 weekly, 2 every two weeks, 3 one time?',
      ],
      tone: 'Warm and friendly.',
    },
    sample: {
      reply: 'Three bedroom house, every other week. 9900 Main St.',
      values: { need: "you'd like regular cleaning", summary: 'Cleaning every 2 weeks' },
    },
  },
  {
    key: 'pool_service',
    workflow: 'recurring_service',
    name: 'Pool service',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential pool cleaning, chemicals, openings and closings.',
      questions: [
        'What service are you looking for?',
        'What is the address?',
        'How often: 1 weekly, 2 every two weeks, 3 one time?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Need the pool opened and weekly service. 9900 Main St.',
      values: { need: "you'd like pool service", summary: 'Pool opening and weekly' },
    },
  },
  {
    key: 'pest_control',
    workflow: 'recurring_service',
    name: 'Pest control',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Residential pest control: insects, rodents and ongoing prevention plans.',
      questions: [
        'What pests are you seeing?',
        'What is the address?',
        'Are you looking for 1 a one-time visit or 2 a regular plan?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Seeing mice in the garage. 9900 Main St.',
      values: { need: 'you are seeing mice', summary: 'Mice in garage' },
    },
  },
  {
    key: 'recurring_other',
    workflow: 'recurring_service',
    name: 'Other regular service',
    jobMinutes: 60,
    ai: {
      questions: [
        'What service are you looking for?',
        'What is the address?',
        'How often: 1 weekly, 2 every two weeks, 3 one time?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Looking for regular service at the house. 9900 Main St.',
      values: { need: "you'd like regular service", summary: 'Regular service' },
    },
  },

  // Studio appointment -----------------------------------------------------------------------
  {
    key: 'tattoo',
    workflow: 'studio_appointment',
    name: 'Tattoo studio',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Custom tattoos, cover-ups and touch-ups.',
      what_we_dont_do: ['Tattoos for anyone under 18'],
      questions: [
        'What are you thinking of getting?',
        'Where on the body, and about how big?',
        'Do you have an artist in mind?',
      ],
      tone: 'Warm and relaxed.',
    },
    sample: {
      reply: 'A small forearm piece, about palm-sized.',
      values: { need: "you'd like a new tattoo", summary: 'Small forearm tattoo' },
    },
  },
  {
    key: 'salon_barber',
    workflow: 'studio_appointment',
    name: 'Salon or barber',
    jobMinutes: 45,
    ai: {
      what_we_do: 'Haircuts, color and styling.',
      questions: ['What service would you like?', 'Do you have a stylist in mind?'],
      tone: 'Warm and friendly.',
    },
    sample: {
      reply: 'A cut and color please.',
      values: { need: "you'd like a cut and color", summary: 'Cut and color' },
    },
  },
  {
    key: 'pet_grooming',
    workflow: 'studio_appointment',
    name: 'Pet grooming',
    jobMinutes: 90,
    ai: {
      what_we_do: 'Dog and cat grooming: baths, haircuts and nail trims.',
      questions: ['What kind of pet, and what breed?', 'What service would you like?'],
      tone: 'Warm and friendly.',
    },
    sample: {
      reply: 'Full groom for my doodle.',
      values: { need: "you'd like a full groom", summary: 'Full groom, doodle' },
    },
  },
  {
    key: 'photography',
    workflow: 'studio_appointment',
    name: 'Photography',
    jobMinutes: 60,
    ai: {
      what_we_do: 'Portrait, family and headshot sessions.',
      questions: ['What kind of session are you looking for?', 'How many people?'],
      tone: 'Warm and friendly.',
    },
    sample: {
      reply: 'Family photos for four of us.',
      values: { need: "you'd like family photos", summary: 'Family session, 4 people' },
    },
  },
  {
    key: 'studio_other',
    workflow: 'studio_appointment',
    name: 'Other studio or appointment',
    jobMinutes: 60,
    ai: {
      questions: ['What would you like to book?'],
      tone: 'Warm and friendly.',
    },
    sample: {
      reply: 'I would like to book an appointment.',
      values: { need: "you'd like an appointment", summary: 'Appointment' },
    },
  },

  // Shop drop-off ----------------------------------------------------------------------------
  {
    key: 'auto_repair',
    workflow: 'shop_dropoff',
    name: 'Auto repair',
    jobMinutes: 30,
    ai: {
      what_we_do: 'Car and light truck repair and maintenance.',
      questions: [
        'What year, make and model?',
        'What is going on with it?',
        'How soon: 1 this week, 2 next week, 3 flexible?',
      ],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: '2016 Civic, brakes are grinding.',
      values: { need: 'your brakes are grinding', summary: '2016 Civic, brakes' },
    },
  },
  {
    key: 'small_engine',
    workflow: 'shop_dropoff',
    name: 'Small engine repair',
    jobMinutes: 30,
    ai: {
      what_we_do: 'Mower, snowblower, trimmer and small engine repair and tune-ups.',
      questions: ['What is the machine, and what brand?', 'What is going on with it?'],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'My mower will not start.',
      values: { need: 'your mower will not start', summary: 'Mower will not start' },
    },
  },
  {
    key: 'device_repair',
    workflow: 'shop_dropoff',
    name: 'Phone and computer repair',
    jobMinutes: 30,
    ai: {
      what_we_do: 'Phone, tablet and computer repair: screens, batteries and charging ports.',
      questions: ['What device, and what model?', 'What is going on with it?'],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Cracked screen on my phone.',
      values: { need: 'your phone screen is cracked', summary: 'Cracked phone screen' },
    },
  },
  {
    key: 'bike_repair',
    workflow: 'shop_dropoff',
    name: 'Bike repair',
    jobMinutes: 30,
    ai: {
      what_we_do: 'Bike tune-ups and repairs.',
      questions: ['What kind of bike?', 'What does it need?'],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'Needs a tune-up and new brakes.',
      values: { need: 'your bike needs a tune-up', summary: 'Tune-up and brakes' },
    },
  },
  {
    key: 'shop_other',
    workflow: 'shop_dropoff',
    name: 'Other shop repair',
    jobMinutes: 30,
    ai: {
      questions: ['What are you bringing in?', 'What is going on with it?'],
      tone: 'Plain and friendly.',
    },
    sample: {
      reply: 'I have something that needs repair.',
      values: { need: 'something needs repair', summary: 'Shop repair' },
    },
  },
];

export function workflow(key: string): Workflow | null {
  return WORKFLOWS.find((w) => w.key === key) ?? null;
}

export function trade(key: string): Trade | null {
  return TRADES.find((t) => t.key === key) ?? null;
}

export function tradesFor(workflowKey: WorkflowKey): Trade[] {
  return TRADES.filter((t) => t.workflow === workflowKey);
}
