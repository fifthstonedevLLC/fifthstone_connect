import type { CalendarProvider } from '@fsc/connectors';
import { MockCalendar } from '@fsc/connectors/mock';
import { personalBusy, type Interval } from '@fsc/scheduling';
import { withTenant } from '../db.js';
import { keyId, type JobHandler } from '../handler.js';

/**
 * `sync_calendar:<connection id>:<period>`, queued for every connected calendar by
 * `app.schedule_calendar_syncs`. Reads the calendar's busy times for a window around now, takes
 * out the time this service booked itself (its holds and events), and replaces the stored busy
 * times for that window, all in the transaction that settles the job. Only start and end are
 * stored, never what the owner's events are. If the business withdrew access, the connection is
 * marked revoked, so offers pause and the portal asks for a reconnect (MOCK_DATA.md case X-05).
 */

export const SYNC_PAST_DAYS = 7;
export const SYNC_AHEAD_DAYS = 42;

const DAY = 86_400_000;

/**
 * The mock calendar lives in memory, so busy times stored before this worker started are unknown
 * to it; without this, a fresh worker would read an empty calendar and wipe the sample busy
 * times. So a mock calendar that knows nothing of this calendar yet is first given what is stored;
 * once it has entries it is the source, and events removed from it disappear on the next sync. A
 * real calendar is always the source, so this does nothing there.
 */
function mirrorBusyIntoMock(
  calendar: CalendarProvider,
  tenantId: string,
  calendarId: string,
  stored: readonly Interval[],
): void {
  if (calendar instanceof MockCalendar) {
    if (calendar.entriesFor(tenantId).some((e) => e.calendarId === calendarId)) return;
    for (const range of stored) calendar.restoreBusy(tenantId, calendarId, range);
  }
}

export const syncCalendar: JobHandler = async (job, ctx) => {
  const connectionId = keyId(job.idempotencyKey);
  if (!connectionId) return { outcome: { kind: 'skipped', reason: 'malformed_key' } };

  const now = ctx.now();
  const range = {
    start: new Date(now.getTime() - SYNC_PAST_DAYS * DAY),
    end: new Date(now.getTime() + SYNC_AHEAD_DAYS * DAY),
  };

  const facts = await withTenant(ctx.pool, job.tenantId, async (client) => {
    const connection = await client.query<{ calendar_id: string; status: string }>(
      `select calendar_id, status from app.calendar_connections
        where tenant_id = $1 and id = $2`,
      [job.tenantId, connectionId],
    );
    const row = connection.rows[0];
    if (!row) return null;
    // Time this service booked: open and approved requests (their holds and events).
    const own = await client.query<{ start: Date; end: Date }>(
      `select slot_start as start, slot_end as end from app.requests
        where tenant_id = $1 and state in ('pending', 'approved')
          and slot_start < $3 and slot_end > $2`,
      [job.tenantId, range.start, range.end],
    );
    const stored = await client.query<{ start: Date; end: Date }>(
      `select starts_at as start, ends_at as end from app.calendar_busy
        where tenant_id = $1 and connection_id = $2 and starts_at < $4 and ends_at > $3`,
      [job.tenantId, connectionId, range.start, range.end],
    );
    return { ...row, own: own.rows, stored: stored.rows };
  });

  if (!facts) return { outcome: { kind: 'skipped', reason: 'connection_not_found' } };
  if (facts.status !== 'connected')
    return { outcome: { kind: 'skipped', reason: 'not_connected' } };

  const calendar = ctx.connectors.calendar;
  mirrorBusyIntoMock(calendar, job.tenantId, facts.calendar_id, facts.stored);
  const read = await calendar.busy({
    tenantId: job.tenantId,
    calendarId: facts.calendar_id,
    range,
  });

  if (!read.ok) {
    const error = read.error;
    return {
      outcome: { kind: 'failed', error },
      apply: async (client) => {
        if (error.code !== 'auth_revoked') return;
        const { rowCount } = await client.query(
          `update app.calendar_connections set status = 'revoked'
            where tenant_id = $1 and id = $2 and status = 'connected'`,
          [job.tenantId, connectionId],
        );
        if (rowCount) {
          await client.query(
            `insert into app.audit_events (tenant_id, actor_type, action, subject_type, subject_id)
             values ($1, 'system', 'calendar.revoked', 'calendar_connection', $2)`,
            [job.tenantId, connectionId],
          );
        }
      },
    };
  }

  const busy = personalBusy(read.value, facts.own);
  return {
    outcome: { kind: 'succeeded' },
    apply: async (client, settled) => {
      if (settled.status !== 'succeeded') return;
      await client.query(
        `delete from app.calendar_busy
          where tenant_id = $1 and connection_id = $2 and starts_at < $4 and ends_at > $3`,
        [job.tenantId, connectionId, range.start, range.end],
      );
      if (busy.length > 0) {
        await client.query(
          `insert into app.calendar_busy (tenant_id, connection_id, starts_at, ends_at)
           select $1, $2, s, e from unnest($3::timestamptz[], $4::timestamptz[]) as t (s, e)`,
          [job.tenantId, connectionId, busy.map((b) => b.start), busy.map((b) => b.end)],
        );
      }
      await client.query(
        `update app.calendar_connections set last_synced_at = now()
          where tenant_id = $1 and id = $2`,
        [job.tenantId, connectionId],
      );
    },
  };
};
