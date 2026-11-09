import { addDays, isoWeekday, zonedTime, type LocalDate } from './zoned.js';

/**
 * Open time, from the business's own settings first: its weekly hours say which days and times
 * can ever be offered, and only then is busy time from the connected calendar (events and holds)
 * taken away. The connected calendar can close time but never opens it.
 */

/** One block of weekly hours: ISO weekdays (1 = Monday) with an open and close time (HH:MM). */
export interface WeeklyHours {
  days: readonly number[];
  open: string;
  close: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Window extends Interval {
  /** The business's calendar day the window falls on. */
  date: LocalDate;
}

export interface RangeInput {
  hours: readonly WeeklyHours[];
  timeZone: string;
  /** First local day. */
  from: LocalDate;
  /** How many days, including `from`. */
  days: number;
}

/** The business's open hours as instants, day by day, in order. */
export function openWindows({ hours, timeZone, from, days }: RangeInput): Window[] {
  const windows: Window[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const weekday = isoWeekday(date);
    for (const block of hours) {
      if (!block.days.includes(weekday)) continue;
      const start = zonedTime(date, block.open, timeZone);
      const end = zonedTime(date, block.close, timeZone);
      if (end > start) windows.push({ date, start, end });
    }
  }
  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Each window with every busy interval taken out; empty pieces are dropped. */
export function subtractBusy<W extends Interval>(
  windows: readonly W[],
  busy: readonly Interval[],
): W[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const free: W[] = [];
  for (const window of windows) {
    let cursor = window.start.getTime();
    const end = window.end.getTime();
    for (const b of sorted) {
      const bs = b.start.getTime();
      const be = b.end.getTime();
      if (be <= cursor || bs >= end) continue;
      if (bs > cursor) free.push({ ...window, start: new Date(cursor), end: new Date(bs) });
      cursor = Math.max(cursor, be);
      if (cursor >= end) break;
    }
    if (cursor < end) free.push({ ...window, start: new Date(cursor), end: new Date(end) });
  }
  return free;
}

export interface SlotInput extends RangeInput {
  /** Events and holds on the connected calendar, and requests already held or booked. */
  busy: readonly Interval[];
  /** How long one job takes. */
  jobMinutes: number;
  /** Starts fall on this step from the opening time (default 60). */
  stepMinutes?: number;
  /** Nothing earlier than this is offered (normally now). */
  notBefore?: Date;
}

/** Times a job of `jobMinutes` fits entirely inside open, free time. */
export function openSlots(input: SlotInput): Window[] {
  const step = (input.stepMinutes ?? 60) * 60_000;
  const length = input.jobMinutes * 60_000;
  const earliest = input.notBefore?.getTime() ?? Number.NEGATIVE_INFINITY;
  const windows = openWindows(input);
  const free = subtractBusy(windows, input.busy);
  const slots: Window[] = [];
  for (const piece of free) {
    // Starts keep to the window's own grid (9:00, 10:00 …) even after a busy block.
    const origin = windows.find((w) => w.start <= piece.start && piece.start < w.end)?.start;
    const base = origin?.getTime() ?? piece.start.getTime();
    const offset = piece.start.getTime() - base;
    let t = base + Math.ceil(offset / step) * step;
    while (t < earliest) t += step;
    for (; t + length <= piece.end.getTime(); t += step) {
      slots.push({ date: piece.date, start: new Date(t), end: new Date(t + length) });
    }
  }
  return slots;
}

export interface DayCapacity {
  date: LocalDate;
  /** Minutes the business is open that day. */
  openMinutes: number;
  /** Open minutes not taken by busy time. */
  freeMinutes: number;
}

/** How full each day is: open minutes, and how many of them are still free. */
export function dayCapacity(input: RangeInput & { busy: readonly Interval[] }): DayCapacity[] {
  const windows = openWindows(input);
  const free = subtractBusy(windows, input.busy);
  const minutes = (list: readonly Interval[]) =>
    list.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()) / 60_000, 0);
  const days: DayCapacity[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(input.from, i);
    days.push({
      date,
      openMinutes: minutes(windows.filter((w) => w.date === date)),
      freeMinutes: minutes(free.filter((w) => w.date === date)),
    });
  }
  return days;
}
