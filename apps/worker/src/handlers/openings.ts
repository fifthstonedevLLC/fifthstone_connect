import { OFFER_LEAD_MINUTES } from '@fsc/conversation';
import { BusinessHoursListSchema } from '@fsc/core';
import { localDate, openSlots, type Interval, type Window } from '@fsc/scheduling';
import type { DbClient } from '../db.js';

/** A business's calendar facts for offering times. */
export interface Openings {
  timeZone: string;
  holdMinutes: number;
  calendar: { id: string; calendarId: string; status: string } | null;
  /** Open slots for one job, from `OFFER_LEAD_MINUTES` after now. */
  slots: Window[];
}

/**
 * Open times for one business: its hours, minus busy time from the last calendar sync, minus
 * every open or approved request (held or booked) so one time is never offered twice. Reads only
 * the database; the calendar itself is checked when the hold is placed.
 */
export async function openingsFor(
  client: DbClient,
  tenantId: string,
  now: Date,
  horizonDays: number,
): Promise<Openings | null> {
  const config = await client.query<{
    timezone: string;
    business_hours: unknown;
    default_job_minutes: number;
    hold_minutes: number;
  }>(
    `select t.timezone, c.business_hours, c.default_job_minutes, c.hold_minutes
       from app.tenants t join app.tenant_config c on c.tenant_id = t.id
      where t.id = $1`,
    [tenantId],
  );
  const row = config.rows[0];
  if (!row) return null;
  const calendar = await client.query<{ id: string; calendar_id: string; status: string }>(
    `select id, calendar_id, status from app.calendar_connections
      where tenant_id = $1 order by updated_at desc limit 1`,
    [tenantId],
  );
  const cal = calendar.rows[0];
  const until = new Date(now.getTime() + (horizonDays + 1) * 86_400_000);
  const taken = await client.query<{ start: Date; end: Date }>(
    `select b.starts_at as start, b.ends_at as end from app.calendar_busy b
      where b.tenant_id = $1 and b.connection_id = $2 and b.ends_at > $3 and b.starts_at < $4
     union all
     select r.slot_start, r.slot_end from app.requests r
      where r.tenant_id = $1 and r.state in ('pending', 'approved')
        and r.slot_end > $3 and r.slot_start < $4`,
    [tenantId, cal?.id ?? null, now, until],
  );
  const parsed = BusinessHoursListSchema.safeParse(row.business_hours);
  const busy: Interval[] = taken.rows;
  const slots = openSlots({
    hours: parsed.success ? parsed.data : [],
    timeZone: row.timezone,
    from: localDate(now, row.timezone),
    days: horizonDays + 1,
    busy,
    jobMinutes: row.default_job_minutes,
    notBefore: new Date(now.getTime() + OFFER_LEAD_MINUTES * 60_000),
  });
  return {
    timeZone: row.timezone,
    holdMinutes: row.hold_minutes,
    calendar: cal ? { id: cal.id, calendarId: cal.calendar_id, status: cal.status } : null,
    slots,
  };
}
