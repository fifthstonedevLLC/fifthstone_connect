import type {
  CalendarProvider,
  CalendarRef,
  ConfirmHoldInput,
  PlaceHoldInput,
} from '../calendar.js';
import { fail, ok, overlaps, type ConnectorResult, type TimeRange } from '../result.js';
import { MockConnector } from './base.js';

export interface MockCalendarEntry {
  ref: string;
  calendarId: string;
  kind: 'event' | 'hold';
  range: TimeRange;
  title: string;
}

/** In-memory calendars per tenant, with holds that block slots like real events. */
export class MockCalendar extends MockConnector implements CalendarProvider {
  private readonly entries = new Map<string, MockCalendarEntry[]>();
  private readonly revoked = new Set<string>();

  constructor() {
    super('CAL');
  }

  /** Seeds an existing appointment. */
  addEvent(tenantId: string, calendarId: string, range: TimeRange, title = 'Existing job'): string {
    const ref = this.nextRef();
    this.list(tenantId).push({ ref, calendarId, kind: 'event', range, title });
    return ref;
  }

  /**
   * Puts back a hold the database already records. The mock keeps calendars in memory only, so a
   * worker started after the hold was placed mirrors it before confirming or releasing it. Mock
   * only: a real calendar already has the hold.
   */
  restoreHold(
    tenantId: string,
    calendarId: string,
    ref: string,
    range: TimeRange,
    title = 'Hold',
  ): void {
    const entries = this.list(tenantId);
    if (entries.some((e) => e.calendarId === calendarId && e.ref === ref)) return;
    entries.push({ ref, calendarId, kind: 'hold', range, title });
  }

  /** Simulates the tenant revoking calendar access (MOCK_DATA.md case X-05). */
  revokeAccess(tenantId: string): void {
    this.revoked.add(tenantId);
  }

  entriesFor(tenantId: string): readonly MockCalendarEntry[] {
    return this.list(tenantId);
  }

  async busy(input: CalendarRef & { range: TimeRange }) {
    return this.guard(input.tenantId, () =>
      this.run(() =>
        ok(
          this.list(input.tenantId)
            .filter((e) => e.calendarId === input.calendarId && overlaps(e.range, input.range))
            .map((e) => e.range),
        ),
      ),
    );
  }

  async placeHold(input: PlaceHoldInput) {
    return this.guard(input.tenantId, () =>
      this.once(input.tenantId, input.idempotencyKey, () => {
        if (!(input.slot.start < input.slot.end)) {
          return fail('permanent', 'invalid_range', 'Slot must end after it starts');
        }
        const entries = this.list(input.tenantId);
        const taken = entries.some(
          (e) => e.calendarId === input.calendarId && overlaps(e.range, input.slot),
        );
        if (taken) return fail('permanent', 'slot_unavailable', 'Slot is no longer free');
        const holdRef = this.nextRef();
        entries.push({
          ref: holdRef,
          calendarId: input.calendarId,
          kind: 'hold',
          range: input.slot,
          title: input.title,
        });
        return ok({ holdRef });
      }),
    );
  }

  async confirmHold(input: ConfirmHoldInput) {
    return this.guard(input.tenantId, () =>
      this.once(input.tenantId, input.idempotencyKey, () => {
        const hold = this.find(input);
        if (!hold || hold.kind !== 'hold') {
          return fail('permanent', 'hold_not_found', 'Hold was released or expired');
        }
        hold.kind = 'event';
        hold.title = input.title;
        return ok({ eventRef: hold.ref });
      }),
    );
  }

  async releaseHold(input: CalendarRef & { holdRef: string }) {
    return this.guard(input.tenantId, () =>
      this.run((): ConnectorResult<void> => {
        const entry = this.find(input);
        if (entry?.kind === 'event') {
          return fail('permanent', 'hold_confirmed', 'Hold is already a confirmed event');
        }
        if (entry) {
          const entries = this.list(input.tenantId);
          entries.splice(entries.indexOf(entry), 1);
        }
        return ok(undefined);
      }),
    );
  }

  private list(tenantId: string): MockCalendarEntry[] {
    let entries = this.entries.get(tenantId);
    if (!entries) {
      entries = [];
      this.entries.set(tenantId, entries);
    }
    return entries;
  }

  private find(input: CalendarRef & { holdRef: string }): MockCalendarEntry | undefined {
    return this.list(input.tenantId).find(
      (e) => e.calendarId === input.calendarId && e.ref === input.holdRef,
    );
  }

  private guard<T>(tenantId: string, call: () => ConnectorResult<T>): ConnectorResult<T> {
    if (this.revoked.has(tenantId)) {
      return fail('permanent', 'auth_revoked', 'Calendar access was revoked by the tenant');
    }
    return call();
  }
}
