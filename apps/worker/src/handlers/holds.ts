import type { CalendarProvider } from '@fsc/connectors';
import { MockCalendar } from '@fsc/connectors/mock';
import type { DbClient } from '../db.js';

/** A request's calendar hold, as the database records it. */
export interface HoldRow {
  hold_id: string;
  hold_state: 'active' | 'converted' | 'released';
  calendar_id: string;
  provider_hold_ref: string;
  slot_start: Date;
  slot_end: Date;
}

export async function holdFor(
  client: DbClient,
  tenantId: string,
  requestId: string,
): Promise<HoldRow | null> {
  const { rows } = await client.query<HoldRow>(
    `select id as hold_id, state as hold_state, calendar_id, provider_hold_ref, slot_start, slot_end
       from app.calendar_holds where tenant_id = $1 and request_id = $2`,
    [tenantId, requestId],
  );
  return rows[0] ?? null;
}

/**
 * The mock calendar lives in memory, so a hold placed before this worker started is unknown to
 * it. Mirror the database's hold into the mock before using it. A real calendar already has the
 * hold, so this does nothing there.
 */
export function mirrorHoldIntoMock(
  calendar: CalendarProvider,
  tenantId: string,
  hold: HoldRow,
): void {
  if (calendar instanceof MockCalendar) {
    calendar.restoreHold(tenantId, hold.calendar_id, hold.provider_hold_ref, {
      start: hold.slot_start,
      end: hold.slot_end,
    });
  }
}
