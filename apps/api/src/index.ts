/**
 * @fsc/api — HTTP entry point (Fastify). Phase 2 starts with health and the portal's signed-in
 * routes; the public form, signed webhooks and the rest of the portal API follow. The API returns
 * success only after the inbound event and its jobs are durably persisted, never after
 * third-party calls (CLAUDE.md rule 1).
 */
export { buildApp, REDACT_PATHS, type AppDeps } from './app.js';
export { supabaseTokenVerifier, type PortalUser, type TokenVerifier } from './auth.js';
export { loadConfig, type Config } from './config.js';
export { createPool, withTenant, withoutTenant } from './db.js';
