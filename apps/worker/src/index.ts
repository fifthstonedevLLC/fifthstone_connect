/**
 * @fsc/worker — runs queued jobs. The entry point is `src/main.ts`; `runOnce` and the handlers
 * are exported for tests and the operator CLI.
 */
export { runOnce, type RunOptions, type RunReport } from './runner.js';
export { HANDLERS } from './handlers/index.js';
export type { ClaimedJob, Connectors, HandlerContext, JobHandler } from './handler.js';
