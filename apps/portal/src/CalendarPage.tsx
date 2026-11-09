import { CALENDAR_PROVIDER_NAMES } from '@fsc/core/calendar-providers';
import { addDays, isLocalDate, localDate } from '@fsc/scheduling';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  agoLabel,
  clockLabel,
  directionsUrl,
  preferredMaps,
  clockMinutes,
  duration,
  gridHours,
  lanes,
  onDay,
  openStretches,
  rangeLabel,
  toMinutes,
  untilLabel,
  weekDays,
  type MapsApp,
  type Span,
} from './calendar';
import { formatPhone } from './format';
import { Icon } from './icons';
import type { Appointment, CalendarView, Me } from './types';
import { useApi } from './useApi';

/**
 * The calendar: the week as the business works it. Open hours are lit, everything else is dark;
 * booked jobs are solid, times a customer picked but nobody has approved are pencilled in, and
 * the owner's own events from the connected calendar show only as hatched busy time (never their
 * titles). What is left over shows as open stretches, the time customers can be offered.
 * Choosing a job shows its details with Navigate (directions in Apple or Google Maps), Call and
 * Open contact. Read only: approving and moving happen on the Front Desk and lead pages, and
 * nothing is ever moved automatically (CLAUDE.md rule 14).
 */

const HOUR_PX = 60;

const STATUS_WORDS: Record<Appointment['status'], string> = {
  booked: 'Booked',
  confirming: 'Confirming',
  held: 'Awaiting approval',
};

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** The clock, ticking once a minute, for the now line and countdowns. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const dayFormat = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T12:00:00Z`),
  );

const nameOf = (a: Appointment) => a.name ?? (a.phone ? formatPhone(a.phone) : 'Unknown caller');

function weekLabel(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = dayFormat(from, { month: 'long', day: 'numeric' });
  const end = dayFormat(to, sameMonth ? { day: 'numeric' } : { month: 'long', day: 'numeric' });
  return `${start} – ${end}, ${to.slice(0, 4)}`;
}

interface Placed {
  key: string;
  from: number;
  to: number;
  appointment?: Appointment;
}

/** Everything on one day, in clock minutes. */
function dayContents(view: CalendarView, date: string) {
  const tz = view.timeZone;
  const blocks: Placed[] = [];
  view.busy.forEach((b, i) => {
    const piece = onDay(b, date, tz);
    if (piece) blocks.push({ key: `busy-${i}`, ...piece });
  });
  for (const a of view.appointments) {
    const piece = onDay(a, date, tz);
    if (piece) blocks.push({ key: a.leadId, ...piece, appointment: a });
  }
  const open = openStretches(view.open)
    .map((s) => ({ span: s, slots: s.slots, piece: onDay(s, date, tz) }))
    .filter(
      (
        s,
      ): s is {
        span: Span & { slots: number };
        slots: number;
        piece: { from: number; to: number };
      } => Boolean(s.piece),
    );
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const hours = view.hours
    .filter((h) => h.days.includes(weekday))
    .map((h) => ({ from: toMinutes(h.open), to: toMinutes(h.close) }));
  return { blocks, open, hours };
}

function SyncLine({ view, now }: { view: CalendarView; now: Date }) {
  const c = view.connection;
  if (!c || c.status === 'disconnected') {
    return (
      <p className="cal-sync cal-sync--off">
        <span className="cal-sync__dot" aria-hidden="true" />
        No calendar connected, so open times come from your business hours alone.{' '}
        <Link to="/setup">Connect one in Setup</Link>
      </p>
    );
  }
  if (c.status === 'revoked') {
    return (
      <p className="cal-sync cal-sync--warn" role="status">
        <span className="cal-sync__dot" aria-hidden="true" />
        {CALENDAR_PROVIDER_NAMES[c.provider]} stopped sharing with us. Offers are paused until it is
        reconnected.
      </p>
    );
  }
  return (
    <p className="cal-sync">
      <span className="cal-sync__dot" aria-hidden="true" />
      <strong>{CALENDAR_PROVIDER_NAMES[c.provider]}</strong>
      <span>Two-way: we read your busy times and add booked jobs</span>
      {c.lastSyncedAt && (
        <span className="cal-sync__when">Synced {agoLabel(c.lastSyncedAt, now)}</span>
      )}
      <span className="cal-sync__mock">Sample sync</span>
    </p>
  );
}

function WeekStrip({
  view,
  days,
  today,
  selected,
  onSelect,
}: {
  view: CalendarView;
  days: string[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <ol className="week-strip" aria-label="Days this week">
      {days.map((date) => {
        const cap = view.capacity.find((c) => c.date === date);
        const open = cap?.openMinutes ?? 0;
        const free = cap?.freeMinutes ?? 0;
        const jobs = view.appointments.filter((a) => onDay(a, date, view.timeZone)).length;
        const taken = open > 0 ? Math.round(((open - free) / open) * 100) : 0;
        const past = date < today;
        const freeText = open === 0 ? 'Closed' : free === 0 ? 'Full' : `${duration(free)} free`;
        const classes = ['day-tile'];
        if (date === today) classes.push('day-tile--today');
        if (open === 0) classes.push('day-tile--closed');
        if (past) classes.push('day-tile--past');
        return (
          <li key={date}>
            <button
              type="button"
              className={classes.join(' ')}
              aria-pressed={selected === date}
              aria-label={`${dayFormat(date, { weekday: 'long', month: 'long', day: 'numeric' })}${date === today ? ', today' : ''}: ${freeText}, ${jobs} ${jobs === 1 ? 'appointment' : 'appointments'}`}
              onClick={() => onSelect(date)}
            >
              <span className="day-tile__name">{dayFormat(date, { weekday: 'short' })}</span>
              <span className="day-tile__date">{dayFormat(date, { day: 'numeric' })}</span>
              <span className="day-tile__meter" aria-hidden="true">
                <span className="day-tile__taken" style={{ width: `${taken}%` }} />
              </span>
              <span className="day-tile__free">{freeText}</span>
              {jobs > 0 && (
                <span className="day-tile__jobs">
                  {jobs} {jobs === 1 ? 'job' : 'jobs'}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function blockLabel(view: CalendarView, p: Placed): string {
  const time = rangeLabel(p.from, p.to);
  if (!p.appointment) return `${time}: busy on your calendar`;
  const a = p.appointment;
  return `${time}: ${nameOf(a)}, ${STATUS_WORDS[a.status]}${a.summary ? `. ${a.summary}` : ''}`;
}

/** On Apple devices directions open in Apple Maps first; elsewhere, Google Maps. */
const MAPS: MapsApp =
  typeof navigator === 'undefined' ? 'google' : preferredMaps(navigator.userAgent);

/** Navigate, Call and Open contact for one appointment. */
function AppointmentActions({ a }: { a: Appointment }) {
  return (
    <div className="appt-actions">
      {a.address && (
        <a
          className="button button--primary button--small appt-actions__navigate"
          href={directionsUrl(a.address, MAPS)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Navigate to ${nameOf(a)}, ${a.address}`}
        >
          <Icon name="pin" size={15} /> Navigate
        </a>
      )}
      {a.phone && (
        <a className="button button--small" href={`tel:${a.phone}`}>
          <Icon name="phone" size={15} /> Call
        </a>
      )}
      <Link className="button button--small" to={`/leads/${a.leadId}`}>
        Open contact
      </Link>
      {a.address && MAPS === 'apple' && (
        <a
          className="appt-actions__alt"
          href={directionsUrl(a.address, 'google')}
          target="_blank"
          rel="noopener noreferrer"
        >
          Use Google Maps
        </a>
      )}
    </div>
  );
}

const whenOf = (a: Appointment, tz: string) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(a.start))} · ${rangeLabel(clockMinutes(a.start, tz), clockMinutes(a.end, tz))}`;

/** The chosen appointment, at the top of the rail. */
function AppointmentDetail({
  a,
  view,
  onClose,
}: {
  a: Appointment;
  view: CalendarView;
  onClose: () => void;
}) {
  return (
    <section
      className={`rail-card appt-detail appt-detail--${a.status}`}
      aria-labelledby="appt-heading"
    >
      <div className="appt-detail__top">
        <p className="rail-card__kicker">{STATUS_WORDS[a.status]}</p>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <Icon name="close" size={16} />
        </button>
      </div>
      <h2 id="appt-heading" className="appt-detail__name">
        {nameOf(a)}
      </h2>
      <p className="rail-next__when">{whenOf(a, view.timeZone)}</p>
      {a.summary && <p className="rail-next__summary">{a.summary}</p>}
      {a.address ? (
        <p className="appt-detail__address">
          <Icon name="pin" size={15} /> {a.address}
        </p>
      ) : (
        <p className="appt-detail__address appt-detail__address--none">No address on file</p>
      )}
      <AppointmentActions a={a} />
    </section>
  );
}

function Block({
  view,
  p,
  first,
  selectedId,
  onSelect,
}: {
  view: CalendarView;
  p: Placed & { lane: number; lanes: number };
  first: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const style = {
    top: ((p.from - first * 60) / 60) * HOUR_PX,
    height: Math.max(((p.to - p.from) / 60) * HOUR_PX - 3, 22),
    left: `calc(${(p.lane / p.lanes) * 100}% + 4px)`,
    width: `calc(${100 / p.lanes}% - 8px)`,
  };
  const short = p.to - p.from < 50;
  // A one-hour job has room for its time and name; longer ones also show what it is.
  const roomy = p.to - p.from >= 90;
  if (!p.appointment) {
    const provider = view.connection ? CALENDAR_PROVIDER_NAMES[view.connection.provider] : '';
    return (
      <li className="cal-block cal-block--busy" style={style} aria-label={blockLabel(view, p)}>
        <span className="cal-block__title">Busy</span>
        {!short && <span className="cal-block__meta">{provider}</span>}
      </li>
    );
  }
  const a = p.appointment;
  return (
    <li
      className={`cal-block cal-block--${a.status}${short ? ' cal-block--short' : ''}${selectedId === a.leadId ? ' cal-block--selected' : ''}`}
      style={style}
    >
      <button
        type="button"
        className="cal-block__link"
        aria-label={blockLabel(view, p)}
        aria-pressed={selectedId === a.leadId}
        onClick={() => onSelect(a.leadId)}
      >
        <span className="cal-block__time">{rangeLabel(p.from, p.to)}</span>
        <span className="cal-block__title">{nameOf(a)}</span>
        {roomy && a.summary && <span className="cal-block__meta">{a.summary}</span>}
        {roomy && a.status !== 'booked' && (
          <span className="cal-block__state">{STATUS_WORDS[a.status]}</span>
        )}
      </button>
    </li>
  );
}

function WeekGrid({
  view,
  days,
  today,
  now,
  selectedId,
  onSelect,
}: {
  view: CalendarView;
  days: string[];
  today: string;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const contents = days.map((date) => ({ date, ...dayContents(view, date) }));
  const { first, last } = gridHours(
    view.hours,
    contents.flatMap((c) => c.blocks),
  );
  const hourMarks = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const height = (last - first) * HOUR_PX;
  const nowMinutes = clockMinutes(now, view.timeZone);
  const showNow = days.includes(today) && nowMinutes >= first * 60 && nowMinutes <= last * 60;
  const y = (minutes: number) => ((minutes - first * 60) / 60) * HOUR_PX;

  return (
    <div className="cal-grid" style={{ ['--cal-height' as string]: `${height}px` }}>
      <div className="cal-grid__head" aria-hidden="true">
        <span />
        {days.map((date) => (
          <span
            key={date}
            className={`cal-grid__day${date === today ? ' cal-grid__day--today' : ''}`}
          >
            <span className="cal-grid__dayname">{dayFormat(date, { weekday: 'short' })}</span>
            <span className="cal-grid__daynum">{dayFormat(date, { day: 'numeric' })}</span>
          </span>
        ))}
      </div>
      <div className="cal-grid__body">
        <div className="cal-grid__spine" aria-hidden="true">
          {hourMarks.map((h) => (
            <span key={h} className="cal-grid__hour" style={{ top: y(h * 60) }}>
              {clockLabel(h * 60)}
            </span>
          ))}
          {showNow && (
            <span className="cal-now__label" style={{ top: y(nowMinutes) }}>
              {clockLabel(nowMinutes)}
            </span>
          )}
        </div>
        {contents.map(({ date, blocks, open, hours }) => (
          <section
            key={date}
            className={`cal-col${date < today ? ' cal-col--past' : ''}`}
            aria-label={dayFormat(date, { weekday: 'long', month: 'long', day: 'numeric' })}
          >
            {hourMarks.slice(1, -1).map((h) => (
              <span
                key={h}
                className="cal-col__rule"
                style={{ top: y(h * 60) }}
                aria-hidden="true"
              />
            ))}
            {hours.map((h) => (
              <span
                key={`${h.from}`}
                className="cal-col__lit"
                style={{ top: y(h.from), height: ((h.to - h.from) / 60) * HOUR_PX }}
                aria-hidden="true"
              />
            ))}
            {hours.length === 0 && <span className="cal-col__closed">Closed</span>}
            <ol className="cal-col__items">
              {open.map(({ span, slots, piece }) => (
                <li
                  key={span.start}
                  className="cal-block cal-block--open"
                  style={{
                    top: y(piece.from) + 2,
                    height: Math.max(((piece.to - piece.from) / 60) * HOUR_PX - 5, 22),
                  }}
                >
                  <span className="cal-block__title">Open</span>
                  <span className="cal-block__time">{rangeLabel(piece.from, piece.to)}</span>
                  {piece.to - piece.from >= 120 && (
                    <span className="cal-block__meta">
                      {slots} {slots === 1 ? 'time' : 'times'} to offer
                    </span>
                  )}
                </li>
              ))}
              {lanes(blocks).map((p) => (
                <Block
                  key={p.key}
                  view={view}
                  p={p}
                  first={first}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ol>
            {showNow && date === today && (
              <>
                <span
                  className="cal-col__gone"
                  style={{ height: y(nowMinutes) }}
                  aria-hidden="true"
                />
                <span className="cal-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** One day as a list, for phones: appointments, busy time and open stretches in order. */
function DayAgenda({
  view,
  date,
  now,
  selectedId,
  onSelect,
}: {
  view: CalendarView;
  date: string;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { blocks, open, hours } = dayContents(view, date);
  const items = [
    ...blocks.map((p) => ({ kind: p.appointment ? 'appointment' : 'busy', p, slots: 0 })),
    ...open.map((o) => ({ kind: 'open', p: { key: o.span.start, ...o.piece }, slots: o.slots })),
  ].sort((a, b) => a.p.from - b.p.from);
  const heading = dayFormat(date, { weekday: 'long', month: 'long', day: 'numeric' });
  const hoursText =
    hours.length === 0 ? 'Closed' : hours.map((h) => rangeLabel(h.from, h.to)).join(', ');
  return (
    <section className="agenda" aria-labelledby="agenda-heading">
      <h2 id="agenda-heading" className="agenda__heading">
        {heading}
        <span className="agenda__hours">{hoursText}</span>
      </h2>
      {items.length === 0 ? (
        <p className="agenda__empty">
          {hours.length === 0
            ? 'Closed all day.'
            : 'Nothing on the calendar, and no open time left.'}
        </p>
      ) : (
        <ol className="agenda__list">
          {items.map(({ kind, p, slots }) => {
            const a = (p as Placed).appointment;
            return (
              <li key={p.key} className={`agenda__item agenda__item--${a ? a.status : kind}`}>
                <span className="agenda__time">{rangeLabel(p.from, p.to)}</span>
                {a ? (
                  <div className="agenda__body">
                    <button
                      type="button"
                      className="agenda__toggle"
                      aria-expanded={selectedId === a.leadId}
                      onClick={() => onSelect(a.leadId)}
                    >
                      <span className="agenda__title">{nameOf(a)}</span>
                      {a.summary && <span className="agenda__meta">{a.summary}</span>}
                      <span className="agenda__state">{STATUS_WORDS[a.status]}</span>
                    </button>
                    {selectedId === a.leadId && (
                      <div className="agenda__more">
                        {a.address && (
                          <p className="appt-detail__address">
                            <Icon name="pin" size={15} /> {a.address}
                          </p>
                        )}
                        <AppointmentActions a={a} />
                      </div>
                    )}
                  </div>
                ) : kind === 'busy' ? (
                  <span className="agenda__body">
                    <span className="agenda__title">Busy</span>
                    <span className="agenda__meta">On your calendar</span>
                  </span>
                ) : (
                  <span className="agenda__body">
                    <span className="agenda__title">Open</span>
                    <span className="agenda__meta">
                      {slots} {slots === 1 ? 'time' : 'times'} to offer
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {date === localDate(now, view.timeZone) && (
        <p className="agenda__now meta">
          It is {clockLabel(clockMinutes(now, view.timeZone))} now.
        </p>
      )}
    </section>
  );
}

function Rail({
  view,
  now,
  selected,
  onClose,
}: {
  view: CalendarView;
  now: Date;
  selected: Appointment | null;
  onClose: () => void;
}) {
  const upcoming = view.appointments
    .filter((a) => a.status !== 'held' && Date.parse(a.end) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const next = upcoming[0];
  const held = view.appointments.filter((a) => a.status === 'held');
  const tz = view.timeZone;
  const when = (a: Appointment) =>
    `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(a.start))} ${rangeLabel(clockMinutes(a.start, tz), clockMinutes(a.end, tz))}`;
  const freeMinutes = view.capacity.reduce((sum, c) => sum + c.freeMinutes, 0);
  const booked = view.appointments.filter((a) => a.status !== 'held').length;

  return (
    <aside className="cal-rail" aria-label="This week">
      {selected && <AppointmentDetail a={selected} view={view} onClose={onClose} />}
      <section className="rail-card rail-card--next" aria-labelledby="next-heading">
        <h2 id="next-heading" className="rail-card__kicker">
          Next up
        </h2>
        {next ? (
          <>
            <p className="rail-next__until">{untilLabel(now, next.start)}</p>
            <p className="rail-next__when">{when(next)}</p>
            <p className="rail-next__name">{nameOf(next)}</p>
            {next.summary && <p className="rail-next__summary">{next.summary}</p>}
            {next.address && <p className="appt-detail__address">{next.address}</p>}
            <AppointmentActions a={next} />
          </>
        ) : (
          <p className="rail-card__empty">Nothing else booked this week.</p>
        )}
      </section>

      <section className="rail-card" aria-labelledby="held-heading">
        <h2 id="held-heading" className="rail-card__kicker">
          Pencilled in
        </h2>
        {held.length === 0 ? (
          <p className="rail-card__empty">No times waiting for approval.</p>
        ) : (
          <ul className="rail-held">
            {held.map((a) => (
              <li key={a.leadId}>
                <Link to={`/?queue=approve&lead=${a.leadId}`} className="rail-held__link">
                  <span className="rail-held__name">{nameOf(a)}</span>
                  <span className="rail-held__when">{when(a)}</span>
                  {a.holdExpiresAt && (
                    <span className="rail-held__expires">
                      Released {untilLabel(now, a.holdExpiresAt)} unless approved
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rail-card" aria-labelledby="week-heading">
        <h2 id="week-heading" className="rail-card__kicker">
          The week
        </h2>
        <dl className="rail-stats">
          <div>
            <dt>Booked</dt>
            <dd>{booked}</dd>
          </div>
          <div>
            <dt>Free time</dt>
            <dd>{Math.round(freeMinutes / 60)} h</dd>
          </div>
          <div>
            <dt>Job length</dt>
            <dd>{duration(view.jobMinutes)}</dd>
          </div>
        </dl>
      </section>

      <ul className="cal-legend" aria-label="Key">
        <li>
          <span className="cal-legend__swatch cal-legend__swatch--booked" aria-hidden="true" />
          Booked
        </li>
        <li>
          <span className="cal-legend__swatch cal-legend__swatch--held" aria-hidden="true" />
          Awaiting approval
        </li>
        <li>
          <span className="cal-legend__swatch cal-legend__swatch--busy" aria-hidden="true" />
          Busy on your calendar
        </li>
        <li>
          <span className="cal-legend__swatch cal-legend__swatch--open" aria-hidden="true" />
          Open to offer
        </li>
      </ul>
    </aside>
  );
}

export function CalendarPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const [params, setParams] = useSearchParams();
  const rawWeek = params.get('week');
  const week = rawWeek && isLocalDate(rawWeek) ? rawWeek : null;
  const [state, reload] = useApi<CalendarView>(
    `/portal/calendar${week ? `?from=${week}` : ''}`,
    accessToken,
    { refreshEvery: 60_000 },
  );
  const wide = useMedia('(min-width: 880px)');
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const view = state.status === 'ready' ? state.data : null;
  const timeZone = view?.timeZone ?? me.tenant.timezone;
  const today = localDate(now, timeZone);
  const days = useMemo(() => (view ? weekDays(view.from, view.days) : []), [view]);
  const selected =
    picked && days.includes(picked) ? picked : days.includes(today) ? today : (days[0] ?? today);

  const chosenAppointment = view?.appointments.find((a) => a.leadId === chosen) ?? null;
  // Choosing the same job again closes it, as does Escape.
  const choose = (id: string) => setChosen((current) => (current === id ? null : id));
  useEffect(() => {
    if (!chosen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChosen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen]);

  const goWeek = (offset: number) => {
    if (!view) return;
    setPicked(null);
    setParams({ week: addDays(view.from, offset * 7) });
  };

  return (
    <div className="page page--calendar">
      <header className="cal-head">
        <div className="cal-head__title">
          <h1 className="page__title">Calendar</h1>
          {view && (
            <p className="cal-head__range">
              {weekLabel(days[0] ?? view.from, days.at(-1) ?? view.from)}
            </p>
          )}
        </div>
        <div className="cal-head__nav" role="group" aria-label="Change week">
          <button
            type="button"
            className="button button--small"
            onClick={() => goWeek(-1)}
            aria-label="Previous week"
          >
            ←
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={!week}
            onClick={() => {
              setPicked(null);
              setParams({});
            }}
          >
            This week
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => goWeek(1)}
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </header>

      {state.status === 'loading' && (
        <p className="page__note" role="status">
          Loading your calendar…
        </p>
      )}
      {state.status === 'error' && (
        <div className="notice" role="alert">
          <p>We couldn't load your calendar. Nothing has changed; this is only the view.</p>
          <button className="button" type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {view && (
        <>
          <SyncLine view={view} now={now} />
          <WeekStrip
            view={view}
            days={days}
            today={today}
            selected={selected}
            onSelect={setPicked}
          />
          <div className="cal-body">
            {wide ? (
              <WeekGrid
                view={view}
                days={days}
                today={today}
                now={now}
                selectedId={chosen}
                onSelect={choose}
              />
            ) : (
              <DayAgenda
                view={view}
                date={selected}
                now={now}
                selectedId={chosen}
                onSelect={choose}
              />
            )}
            <Rail
              view={view}
              now={now}
              selected={wide ? chosenAppointment : null}
              onClose={() => setChosen(null)}
            />
          </div>
        </>
      )}

      <p className="page__note">
        Sample data. {me.tenant.name} is fictional, and so is its calendar.
      </p>
    </div>
  );
}
