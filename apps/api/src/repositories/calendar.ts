import { BusinessHoursListSchema } from '@fsc/core';
import type { CalendarProviderKey } from '@fsc/core/calendar-providers';
import {
  addDays,
  dayCapacity,
  openSlots,
  zonedTime,
  type DayCapacity,
  type Interval,
  type LocalDate,
} from '@fsc/scheduling';
import type { DbClient } from '../db.js';

/**
 * The portal calendar for a run of days: the business's hours, its appointments (held and
 * booked), busy time synced from its connected calendar, the open slots left, and how full each
 * day is. Busy time comes from `app.calendar_busy`, written by the worker's sync; this read never
 * calls a calendar provider (CLAUDE.md rule 1). Runs inside `withTenant`.
 */

export const APPOINTMENT_STATUSES = ['held', 'confirming', 'booked'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  leadId: string;
  name: string | null;
  phone: string | null;
  summary: string | null;
  /** Where the job is, when the customer gave one (trades); clinics and studios have none. */
  address: string | null;
  start: string;
  end: string;
  /** `held`: picked by the customer, awaiting approval; `confirming`: approved, being written. */
  status: AppointmentStatus;
  /** When a held slot is released if nobody approves it. */
  holdExpiresAt: string | null;
}

export interface CalendarView {
  timeZone: string;
  from: LocalDate;
  days: number;
  hours: { days: number[]; open: string; close: string }[];
  jobMinutes: number;
  connection: {
    provider: CalendarProviderKey;
    status: 'connected' | 'revoked' | 'disconnected';
    lastSyncedAt: string | null;
  } | null;
  appointments: Appointment[];
  busy: { start: string; end: string }[];
  open: { start: string; end: string }[];
  capacity: DayCapacity[];
}

const iso = (d: Date) => d.toISOString();

export async function getCalendar(
  client: DbClient,
  tenantId: string,
  range: { from: LocalDate; days: number },
  now: Date = new Date(),
): Promise<CalendarView | null> {
  const config = await client.query<{
    timezone: string;
    business_hours: unknown;
    default_job_minutes: number;
  }>(
    `select t.timezone, c.business_hours, c.default_job_minutes
       from app.tenants t join app.tenant_config c on c.tenant_id = t.id
      where t.id = $1`,
    [tenantId],
  );
  const row = config.rows[0];
  if (!row) return null;
  const timeZone = row.timezone;
  const parsed = BusinessHoursListSchema.safeParse(row.business_hours);
  const hours: CalendarView['hours'] = parsed.success ? parsed.data : [];
  const start = zonedTime(range.from, '00:00', timeZone);
  const end = zonedTime(addDays(range.from, range.days), '00:00', timeZone);

  const [connection, appointments, busy] = await Promise.all([
    client.query<{
      provider: CalendarProviderKey;
      status: 'connected' | 'revoked' | 'disconnected';
      last_synced_at: Date | null;
    }>(
      `select provider, status, last_synced_at from app.calendar_connections
        where tenant_id = $1 order by updated_at desc limit 1`,
      [tenantId],
    ),
    client.query<{
      lead_id: string;
      display_name: string | null;
      phone: string | null;
      summary: string | null;
      address: string | null;
      slot_start: Date;
      slot_end: Date;
      request_state: 'pending' | 'approved';
      lead_state: string;
      hold_expires_at: Date | null;
    }>(
      `select l.id as lead_id, c.display_name, c.phone, l.summary, l.address, r.slot_start, r.slot_end,
              r.state as request_state, l.state as lead_state, h.expires_at as hold_expires_at
         from app.requests r
         join app.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
         join app.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
         left join app.calendar_holds h
           on h.tenant_id = r.tenant_id and h.request_id = r.id and h.state = 'active'
        where r.tenant_id = $1 and r.state in ('pending', 'approved')
          and l.state not in ('closed', 'spam', 'opted_out')
          and r.slot_start < $3 and r.slot_end > $2
        order by r.slot_start`,
      [tenantId, start, end],
    ),
    client.query<{ starts_at: Date; ends_at: Date }>(
      `select b.starts_at, b.ends_at from app.calendar_busy b
         join app.calendar_connections c on c.tenant_id = b.tenant_id and c.id = b.connection_id
        where b.tenant_id = $1 and c.status = 'connected'
          and b.starts_at < $3 and b.ends_at > $2
        order by b.starts_at`,
      [tenantId, start, end],
    ),
  ]);

  const appts: Appointment[] = appointments.rows.map((a) => ({
    leadId: a.lead_id,
    name: a.display_name,
    phone: a.phone,
    summary: a.summary,
    address: a.address,
    start: iso(a.slot_start),
    end: iso(a.slot_end),
    status:
      a.request_state === 'pending' ? 'held' : a.lead_state === 'booked' ? 'booked' : 'confirming',
    holdExpiresAt:
      a.request_state === 'pending' && a.hold_expires_at ? iso(a.hold_expires_at) : null,
  }));
  const busyTimes: Interval[] = busy.rows.map((b) => ({ start: b.starts_at, end: b.ends_at }));
  // Appointments take time just as the owner's own events do.
  const taken: Interval[] = [
    ...busyTimes,
    ...appointments.rows.map((a) => ({ start: a.slot_start, end: a.slot_end })),
  ];
  const input = { hours, timeZone, from: range.from, days: range.days, busy: taken };
  const c = connection.rows[0];

  return {
    timeZone,
    from: range.from,
    days: range.days,
    hours,
    jobMinutes: row.default_job_minutes,
    connection: c
      ? {
          provider: c.provider,
          status: c.status,
          lastSyncedAt: c.last_synced_at ? iso(c.last_synced_at) : null,
        }
      : null,
    appointments: appts,
    busy: busyTimes.map((b) => ({ start: iso(b.start), end: iso(b.end) })),
    open: openSlots({ ...input, jobMinutes: row.default_job_minutes, notBefore: now }).map((s) => ({
      start: iso(s.start),
      end: iso(s.end),
    })),
    capacity: dayCapacity(input),
  };
}
