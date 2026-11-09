import { MockCalendar, MockRulesModel, MockSmsSender } from '@fsc/connectors/mock';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createPool, withoutTenant } from './db.js';
import { HANDLERS } from './handlers/index.js';
import { runOnce } from './runner.js';

/**
 * Process entry point. `npm run dev -w @fsc/worker` keeps polling; `npm run once -w @fsc/worker`
 * runs until no due job is left, then exits.
 *
 * Every connector is a labeled mock until Phase 4 (CLAUDE.md rule 5): texts and calendar events
 * are recorded in memory, and nothing reaches a carrier or a calendar.
 */
const config = loadConfig(process.env);
const log = pino({ level: config.LOG_LEVEL });
const pool = createPool(config.DATABASE_URL);
const ctx = {
  pool,
  // A run token keeps mock message and calendar references unique across worker restarts.
  connectors: (() => {
    const runId = Date.now().toString(36);
    return {
      sms: new MockSmsSender({ runId }),
      calendar: new MockCalendar({ runId }),
      // Fixed rules, not AI: no customer text leaves this machine until a provider is approved.
      ai: new MockRulesModel({ runId }),
    };
  })(),
  now: () => new Date(),
};
const once = process.argv.includes('--once');

log.warn('worker started with MOCK connectors: no texts or calendar events leave this machine');

let stopping = false;
const stop = () => {
  stopping = true;
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

// A pass can create new work (a booking queues its confirmation text), so keep going while
// passes find jobs, and wait between passes only when a pass found none.
while (!stopping) {
  // Queue a sync for each connected calendar that has not had one this period.
  const queued = await withoutTenant(pool, async (client) => {
    const { rows } = await client.query<{ n: number }>(
      'select app.schedule_calendar_syncs($1) as n',
      [config.CALENDAR_SYNC_MINUTES],
    );
    return rows[0]?.n ?? 0;
  });
  if (queued > 0) log.info({ queued }, 'calendar syncs queued');
  const reports = await runOnce(ctx, { handlers: HANDLERS, log });
  if (reports.length > 0) continue;
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_SECONDS * 1000));
}

await pool.end();
log.info('worker stopped');
