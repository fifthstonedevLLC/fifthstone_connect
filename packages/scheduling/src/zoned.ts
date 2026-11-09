/**
 * Wall-clock time in a business's time zone, with no date library: the platform's `Intl` data
 * does the time zone work. Dates are plain `YYYY-MM-DD` strings (a day on the business's own
 * calendar); instants are `Date`s.
 */

export type LocalDate = string;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Minutes the zone is ahead of UTC at an instant (Chicago in winter: -360). */
export function offsetMinutes(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock time happens in a zone. On the night clocks go back, an hour that
 * happens twice resolves to its first occurrence; on the night they go forward, a time that never
 * happens resolves to the same clock time an hour later.
 */
export function zonedTime(date: LocalDate, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  const second = guess - offsetMinutes(first, timeZone) * 60_000;
  const candidates = [first, second, first - 3_600_000];
  const real = candidates.filter((t) => {
    const w = wallClock(t, timeZone);
    return w.year === y && w.month === m && w.day === d && w.hour === h && w.minute === min;
  });
  // A time that exists takes its earliest occurrence; one in the spring gap moves forward.
  return new Date(real.length > 0 ? Math.min(...real) : Math.max(first, second));
}

/** The business's calendar day at an instant. */
export function localDate(instant: Date, timeZone: string): LocalDate {
  const w = wallClock(instant.getTime(), timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Calendar arithmetic on a local date. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/** The Monday on or before a local date. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function isLocalDate(value: string): value is LocalDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}
