import { MockPhoneEvents } from '@fsc/connectors/mock';
import { buildApp, REDACT_PATHS } from './app.js';
import { supabaseTokenVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

/** Process entry point: `npm run dev -w @fsc/api`. */
const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const app = buildApp({
  pool,
  verifyToken: supabaseTokenVerifier(config.SUPABASE_URL),
  // MOCK until Phase 4: accepts only mock-signed webhooks with 555-01xx numbers (rule 5).
  phoneEvents: new MockPhoneEvents(),
  logger: { level: config.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
});

const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
