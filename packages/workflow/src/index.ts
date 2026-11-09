/**
 * @fsc/workflow — durable jobs: how a job run settles (retry with backoff, dead-letter), and the
 * handler contract the worker uses. Pure code; the worker owns claiming and the database.
 */
export * from './settle.js';
