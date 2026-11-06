import { withTenant } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';
import { holdFor, mirrorHoldIntoMock } from './holds.js';

/**
 * `release_hold:<request id>`: frees a tentative hold that is no longer wanted (another time was
 * suggested, the lead was closed). Releasing a hold that is already gone is not an error.
 */
export const releaseHold: JobHandler = async (job, ctx) => {
  const requestId = keyId(job.idempotencyKey);
  if (!requestId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const hold = await withTenant(ctx.pool, job.tenantId, (client) =>
    holdFor(client, job.tenantId, requestId),
  );
  if (!hold) return { outcome: { kind: 'skipped', reason: 'no_hold' } };
  if (hold.hold_state !== 'active') {
    return { outcome: { kind: 'skipped', reason: 'hold_not_active' } };
  }

  mirrorHoldIntoMock(ctx.connectors.calendar, job.tenantId, hold);
  const released = await ctx.connectors.calendar.releaseHold({
    tenantId: job.tenantId,
    calendarId: hold.calendar_id,
    holdRef: hold.provider_hold_ref,
  });
  if (!released.ok) return { outcome: { kind: 'failed', error: released.error } };

  return {
    outcome: { kind: 'succeeded', externalRef: hold.provider_hold_ref },
    apply: async (client) => {
      await client.query(
        `update app.calendar_holds set state = 'released'
          where tenant_id = $1 and id = $2 and state = 'active'`,
        [job.tenantId, hold.hold_id],
      );
    },
  };
};
