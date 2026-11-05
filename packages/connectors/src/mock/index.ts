/**
 * @fsc/connectors/mock — labeled mock adapters for local development, demos and tests.
 * Every mock reports `isMock: true` and `provider: "mock"`, issues `MOCK-` references, and
 * refuses phone numbers and email addresses outside the fictional ranges.
 * Production wiring must never import this entry point.
 */
export * from './base.js';
export * from './guards.js';
export * from './senders.js';
export * from './inbound.js';
export * from './calendar.js';
export * from './ai.js';
