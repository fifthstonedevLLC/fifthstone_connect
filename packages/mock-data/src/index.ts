/**
 * @fsc/mock-data — the mock dataset from docs/product/MOCK_DATA.md as typed, validated objects,
 * and the generator for supabase/seed/. Local development and tests only; never imported by
 * production code and never used against a hosted database.
 */
export * from './ids.js';
export * from './schemas.js';
export * from './catalog.js';
export * from './scenarios.js';
export * from './seed.js';
