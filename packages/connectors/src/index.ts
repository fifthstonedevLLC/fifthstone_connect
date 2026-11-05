/**
 * @fsc/connectors — interfaces to external services (Twilio, SES, calendars, transcription,
 * language models). Real adapters arrive in Phase 4; until then every interface has a labeled
 * mock in `@fsc/connectors/mock`. Mocked success is never reported as a verified integration.
 */
export * from './result.js';
export * from './sms.js';
export * from './phone-events.js';
export * from './email.js';
export * from './calendar.js';
export * from './ai.js';
