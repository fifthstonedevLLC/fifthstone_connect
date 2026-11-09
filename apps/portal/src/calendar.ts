import { addDays, localDate, type LocalDate } from '@fsc/scheduling';

/**
 * Display rules for the calendar page: where things sit in the business's own time zone, how
 * open slots read as stretches of open time, and how overlapping blocks share a day column.
 * Everything here is pure, so it is tested without a browser.
 */

export interface Span {
  start: string;
  end: string;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes since midnight on the business's clock. */
export function clockMinutes(instant: string | Date, timeZone: string): number {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(
    f.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** A span's piece on one local day, as minutes on that day's clock (end may be 1440). */
export function onDay(span: Span, date: LocalDate, timeZone: string) {
  const startDay = localDate(new Date(span.start), timeZone);
  const endDay = localDate(new Date(span.end), timeZone);
  if (date < startDay || date > endDay) return null;
  const from = startDay === date ? clockMinutes(span.start, timeZone) : 0;
  const to = endDay === date ? clockMinutes(span.end, timeZone) : 1440;
  if (to <= from) return null;
  return { from, to };
}

/** The hours the grid shows: the business's hours, widened to anything booked outside them. */
export function gridHours(
  hours: readonly { open: string; close: string }[],
  pieces: readonly { from: number; to: number }[],
): { first: number; last: number } {
  const starts = [...hours.map((h) => toMinutes(h.open)), ...pieces.map((p) => p.from)];
  const ends = [...hours.map((h) => toMinutes(h.close)), ...pieces.map((p) => p.to)];
  if (starts.length === 0) return { first: 8, last: 17 };
  return {
    first: Math.floor(Math.min(...starts) / 60),
    last: Math.min(24, Math.ceil(Math.max(...ends) / 60)),
  };
}

/** Back-to-back or overlapping slots become one stretch of open time, with how many jobs fit. */
export function openStretches(slots: readonly Span[]): (Span & { slots: number })[] {
  const sorted = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const out: (Span & { slots: number })[] = [];
  for (const slot of sorted) {
    const last = out.at(-1);
    if (last && Date.parse(slot.start) <= Date.parse(last.end)) {
      if (Date.parse(slot.end) > Date.parse(last.end)) last.end = slot.end;
      last.slots += 1;
    } else {
      out.push({ ...slot, slots: 1 });
    }
  }
  return out;
}

/** Side-by-side lanes for blocks that overlap in one day; each gets a lane and the lane count. */
export function lanes<T extends { from: number; to: number }>(
  items: readonly T[],
): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - a.to);
  const placed: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let groupEnd = -1;
  const close = () => {
    const count = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = count;
    group = [];
  };
  for (const item of sorted) {
    if (item.from >= groupEnd) {
      close();
      groupEnd = item.to;
    } else {
      groupEnd = Math.max(groupEnd, item.to);
    }
    const used = new Set(group.filter((g) => g.to > item.from).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    const entry = { ...item, lane, lanes: 1 };
    group.push(entry);
    placed.push(entry);
  }
  close();
  return placed;
}

/** "9 AM", "12:30 PM": short clock labels. */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "9–11 AM", "11:30 AM–1 PM". */
export function rangeLabel(from: number, to: number): string {
  const a = clockLabel(from);
  const b = clockLabel(to);
  const sameHalf = from < 720 === to < 720;
  return sameHalf ? `${a.replace(/ (AM|PM)$/, '')}–${b}` : `${a}–${b}`;
}

/** "3 h free", "45 min free", "1 h 30 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "in 2 h 10 min", "in 25 min", "now". */
export function untilLabel(from: Date, to: string): string {
  const minutes = Math.round((Date.parse(to) - from.getTime()) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes >= 48 * 60) return `in ${Math.round(minutes / 1440)} days`;
  return `in ${duration(minutes)}`;
}

/** The seven local days from a Monday. */
export const weekDays = (from: LocalDate, days = 7) =>
  Array.from({ length: days }, (_, i) => addDays(from, i));

/** "just now", "3 min ago", "2 h ago", "2 days ago". */
export function agoLabel(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

export type MapsApp = 'apple' | 'google';

/**
 * Turn-by-turn directions to a job. These are the maps apps' own public links: on an iPhone or
 * Mac the Apple link opens Apple Maps, and on Android (or an iPhone with it installed) the Google
 * link opens Google Maps; anywhere else they open in the browser. Only the address is sent, and
 * only when the person taps.
 */
export function directionsUrl(address: string, app: MapsApp): string {
  const to = encodeURIComponent(address);
  return app === 'apple'
    ? `https://maps.apple.com/?daddr=${to}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${to}&travelmode=driving`;
}

/** Apple devices default to Apple Maps; everything else to Google Maps. */
export function preferredMaps(userAgent: string): MapsApp {
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent) ? 'apple' : 'google';
}
