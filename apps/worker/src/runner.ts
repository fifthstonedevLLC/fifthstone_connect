import { settleJob, type JobOutcome, type RetryPolicy } from '@fsc/workflow';
import type { Logger } from 'pino';
import { withoutTenant, withTenant } from './db.js';
import type { ClaimedJob, HandlerContext, HandlerResult, JobHandler } from './handler.js';

export interface RunOptions {
  handlers: Record<string, JobHandler>;
  /** How many jobs one pass claims, and how long each lease lasts. */
  limit?: number;
  leaseSeconds?: number;
  /** Only this business's jobs (an operator replay, or a test). */
  tenantId?: string;
  retry?: RetryPolicy;
  random?: () => number;
  log: Logger;
}

export interface RunReport {
  jobId: string;
  actionType: string;
  status: 'succeeded' | 'skipped' | 'failed' | 'dead';
  error: string | null;
}

/**
 * One pass: claim due jobs of the types this worker handles, run each, and settle it. Jobs run
 * one after another; a second worker process claims other jobs safely (leases, SKIP LOCKED).
 * A handler that throws counts as a transient failure, so the job retries rather than vanishing.
 */
export async function runOnce(ctx: HandlerContext, options: RunOptions): Promise<RunReport[]> {
  const types = Object.keys(options.handlers);
  const claimed = await withoutTenant(ctx.pool, async (client) => {
    const { rows } = await client.query<{
      job_id: string;
      tenant_id: string;
      lead_id: string | null;
      action_type: string;
      idempotency_key: string;
      attempts: number;
      correlation_id: string;
    }>(`select * from app.claim_jobs($1, $2, $3, $4)`, [
      options.limit ?? 20,
      options.leaseSeconds ?? 120,
      types,
      options.tenantId ?? null,
    ]);
    return rows.map((r): ClaimedJob => ({
      id: r.job_id,
      tenantId: r.tenant_id,
      leadId: r.lead_id,
      actionType: r.action_type,
      idempotencyKey: r.idempotency_key,
      attempt: r.attempts,
      correlationId: r.correlation_id,
    }));
  });

  const reports: RunReport[] = [];
  for (const job of claimed) {
    try {
      reports.push(await runJob(job, ctx, options));
    } catch (error) {
      // Saving the result failed (the database refused it). The job keeps its lease and is
      // claimed again when the lease runs out, so it retries and counts the attempt; the rest of
      // this pass goes on.
      options.log.error(
        { err: error, jobId: job.id, actionType: job.actionType },
        'job not settled',
      );
      reports.push({
        jobId: job.id,
        actionType: job.actionType,
        status: 'failed',
        error: 'settle_error',
      });
    }
  }
  return reports;
}

async function runJob(
  job: ClaimedJob,
  ctx: HandlerContext,
  options: RunOptions,
): Promise<RunReport> {
  const startedAt = ctx.now();
  const log = options.log.child({
    jobId: job.id,
    actionType: job.actionType,
    attempt: job.attempt,
  });
  const handler = options.handlers[job.actionType];
  let result: HandlerResult;
  try {
    result = handler
      ? await handler(job, ctx)
      : {
          outcome: {
            kind: 'failed',
            error: { kind: 'permanent', code: 'no_handler', message: 'No handler for this job' },
          },
        };
  } catch (error) {
    log.error({ err: error }, 'job handler threw');
    const outcome: JobOutcome = {
      kind: 'failed',
      error: { kind: 'transient', code: 'handler_error', message: 'Unexpected error in handler' },
    };
    result = { outcome };
  }

  return withTenant(ctx.pool, job.tenantId, async (client) => {
    const { rows } = await client.query<{ max_attempts: number }>(
      `select max_attempts from app.jobs where tenant_id = $1 and id = $2 for update`,
      [job.tenantId, job.id],
    );
    const settled = settleJob(
      result.outcome,
      job.attempt,
      rows[0]?.max_attempts ?? 1,
      ctx.now(),
      options.retry,
      options.random,
    );
    if (result.apply) await result.apply(client, settled);
    await client.query(
      `update app.jobs
          set status = $3, run_at = coalesce($4, run_at), lease_expires_at = null,
              last_error = $5, external_ref = coalesce($6, external_ref)
        where tenant_id = $1 and id = $2`,
      [job.tenantId, job.id, settled.status, settled.runAt, settled.lastError, settled.externalRef],
    );
    await client.query(
      `insert into app.job_attempts
         (tenant_id, job_id, attempt, started_at, finished_at, outcome, error_code)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, job_id, attempt) do nothing`,
      [
        job.tenantId,
        job.id,
        job.attempt,
        startedAt,
        ctx.now(),
        settled.attempt.outcome,
        settled.attempt.errorCode,
      ],
    );
    log.info({ status: settled.status, error: settled.attempt.errorCode }, 'job settled');
    return {
      jobId: job.id,
      actionType: job.actionType,
      status: settled.status,
      error: settled.attempt.errorCode,
    };
  });
}
