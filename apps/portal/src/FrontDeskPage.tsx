import {
  DEFAULT_QUEUE,
  inQueue,
  isOwnerQueue,
  isQueueKey,
  orderForQueue,
  priorityOf,
  PRIORITIES,
  QUEUES,
  queueFor,
  topPriority,
  type Priority,
  type PriorityResult,
  type QueueKey,
} from '@fsc/conversation';
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  displayName,
  needLine,
  sentence,
  urgentFlag,
  waitLimitLabel,
  waitingLabel,
  whenLabel,
} from './format';
import { Icon, type IconName } from './icons';
import { LeadWorkspace } from './LeadPage';
import type { LeadCard, Me, Need, Today } from './types';
import { useApi } from './useApi';

/**
 * The Front Desk: the work list as queues. The board shows every queue with its count; choosing one lists its
 * leads in working order; choosing a lead opens all of it beside the list, without leaving the
 * page. Which queue a lead is in, and the order, come from the shared rules in
 * `@fsc/conversation` over the server's `next` (decision 24). After an action the list refreshes
 * and, if the lead left the queue, the next one opens. The queue and lead live in the address,
 * so links and Back work. On a phone the lead opens on its own page instead.
 */

const QUEUE_UI: Record<QueueKey, { label: string; hint: string; icon: IconName }> = {
  act_now: { label: 'Act now', hint: 'At risk or running late', icon: 'warning' },
  approve: { label: 'Approve', hint: 'Customer picked a time', icon: 'check' },
  reply: { label: 'Reply', hint: 'Questions for the business', icon: 'reply' },
  call_back: { label: 'Call back', hint: 'Calls to make', icon: 'phone' },
  reschedule: { label: 'Reschedule or cancel', hint: 'Changes to a booking', icon: 'reschedule' },
  listen: { label: 'Listen', hint: 'Voicemails to hear', icon: 'voicemail' },
  review: { label: 'Review', hint: "Something didn't go through", icon: 'alert' },
  follow_up: { label: 'Follow up', hint: 'Quiet for a day', icon: 'send' },
  waiting: { label: 'Waiting on customer', hint: 'Awaiting their reply', icon: 'clock' },
  booked: { label: 'Booked', hint: 'On the calendar or being confirmed', icon: 'calendar' },
};

/** The row's icon for what the lead needs. */
const NEED_ICON: Record<Need, IconName> = {
  call_now: 'phone',
  approve: 'check',
  call_back: 'phone',
  reply: 'reply',
  reschedule: 'reschedule',
  cancel: 'calendar',
  listen: 'voicemail',
  review: 'alert',
  follow_up: 'send',
  confirming: 'clock',
  their_move: 'templates',
  nudged: 'send',
  booked: 'calendar',
};

/** Priority, always in words beside its colour (red, amber, green). */
const PRIORITY_LABEL: Record<Priority, string> = {
  now: 'Act now',
  soon: 'Soon',
  on_track: 'On track',
};

const PRIORITY_REASON: Record<PriorityResult['reason'], string> = {
  risk: 'Someone may be at risk',
  hold_expiring: 'Held time runs out soon',
  appointment_soon: 'Appointment is coming up',
  overdue: 'Waited too long',
  yours: 'Needs a response',
  theirs: 'No action needed',
};

/** Wide enough for the list and the lead side by side. */
const WIDE = '(min-width: 1100px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

const allCards = (data: Today) => Object.values(data.lanes).flat();

// The appointment matters for a move or cancel; the hold for a request to approve (decision 37).
const facts = (card: LeadCard, overdueHours: number) => ({
  need: card.next.need,
  urgent: card.urgent,
  waitingSince: card.waitingSince,
  holdExpiresAt: card.holdExpiresAt,
  appointmentAt: card.slotStart,
  overdueHours,
});

const cardPriority = (card: LeadCard, overdueHours: number) =>
  priorityOf(facts(card, overdueHours));

function queueItems(data: Today, queue: QueueKey): LeadCard[] {
  return orderForQueue(
    queue,
    allCards(data).filter((card) => inQueue(queue, facts(card, data.actNowAfterHours))),
    (card) => card,
  );
}

/** With no queue in the address: Act now if anything is in it, else the first queue with work. */
function openingQueue(counts: Record<QueueKey, number>): QueueKey {
  if (counts[DEFAULT_QUEUE] > 0) return DEFAULT_QUEUE;
  return QUEUES.find((q) => q.owner && counts[q.key] > 0)?.key ?? DEFAULT_QUEUE;
}

const contactWord = (n: number) => (n === 1 ? 'contact' : 'contacts');

function QueueTile({
  queue,
  levels,
  selected,
  onSelect,
}: {
  queue: QueueKey;
  /** The priority of each lead in the queue. */
  levels: Priority[];
  selected: boolean;
  onSelect: () => void;
}) {
  const ui = QUEUE_UI[queue];
  const count = levels.length;
  const urgent = levels.filter((l) => l === 'now').length;
  const top = topPriority(levels);
  const classes = ['queue'];
  if (queue === 'act_now') classes.push('queue--lead');
  if (count === 0) classes.push('queue--empty');
  // The tile takes the colour of its most urgent lead.
  if (top) classes.push(`queue--${top}`);
  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-pressed={selected}
      aria-label={`${ui.label}, ${count} ${contactWord(count)}${urgent && queue !== 'act_now' ? `, ${urgent} urgent` : ''}`}
      onClick={onSelect}
    >
      <span className="queue__top">
        <Icon name={ui.icon} size={16} className="queue__icon" />
        <span className="queue__count">{count}</span>
      </span>
      <span className="queue__label">{ui.label}</span>
      {urgent > 0 && queue !== 'act_now' ? (
        <span className="queue__alert">{urgent} urgent</span>
      ) : (
        <span className="queue__hint">{ui.hint}</span>
      )}
    </button>
  );
}

function Row({
  card,
  queue,
  timeZone,
  overdueHours,
  selected,
  onOpen,
}: {
  card: LeadCard;
  queue: QueueKey;
  timeZone: string;
  overdueHours: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const owner = isOwnerQueue(queue);
  const priority = cardPriority(card, overdueHours);
  return (
    <li>
      <button
        id={`row-${card.id}`}
        type="button"
        className={`row row--${priority.level}`}
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="row__head">
          <span className="row__name">{displayName(card)}</span>
          {priority.level !== 'on_track' && queue !== 'act_now' && (
            <span className={`priority priority--${priority.level}`}>
              {PRIORITY_LABEL[priority.level]}
            </span>
          )}
          <span className="row__when">
            {owner ? waitingLabel(card.waitingSince) : whenLabel(card.createdAt, timeZone)}
          </span>
        </span>
        <span className="row__need">
          <Icon name={NEED_ICON[card.next.need]} size={15} />
          <span>
            {card.urgent && card.reason !== 'emergency' && `${urgentFlag(card)} · `}
            {needLine(card, timeZone)}
          </span>
        </span>
        {card.summary && <span className="row__summary">{card.summary}</span>}
      </button>
    </li>
  );
}

export function FrontDeskPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const [leads, reload, , refresh] = useApi<Today>('/portal/today', accessToken, {
    refreshEvery: 30_000,
  });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const wide = useWide();
  const [toast, setToast] = useState<string | null>(null);
  const timeZone = me.tenant.timezone;

  const data = leads.status === 'ready' ? leads.data : null;
  // Each queue's leads by priority; the clock is read on every render, and the list refreshes
  // every 30 seconds, so a lead turns red on its own once it has waited too long.
  const levels = useMemo(
    () =>
      Object.fromEntries(
        QUEUES.map((q) => [
          q.key,
          data
            ? queueItems(data, q.key).map((card) => cardPriority(card, data.actNowAfterHours).level)
            : [],
        ]),
      ) as Record<QueueKey, Priority[]>,
    [data],
  );
  const counts = Object.fromEntries(QUEUES.map((q) => [q.key, levels[q.key].length])) as Record<
    QueueKey,
    number
  >;
  const rawQueue = params.get('queue');
  const queue: QueueKey = isQueueKey(rawQueue) ? rawQueue : openingQueue(counts);
  const items = useMemo(() => (data ? queueItems(data, queue) : []), [data, queue]);
  // On a wide screen the first lead opens beside the list until another is chosen.
  const selectedId = params.get('lead') ?? (wide ? (items[0]?.id ?? null) : null);
  const index = items.findIndex((c) => c.id === selectedId);
  const selected = index >= 0 ? items[index] : null;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const chooseQueue = (key: QueueKey) => {
    setParams({ queue: key });
    // On a phone the list sits below the board: bring it into view.
    if (!wide) {
      requestAnimationFrame(() => {
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document
          .getElementById('queue-heading')
          ?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      });
    }
  };
  const select = (card: LeadCard, focusRow = false) => {
    if (!wide) {
      navigate(`/leads/${card.id}`);
      return;
    }
    setParams({ queue, lead: card.id }, { replace: true });
    if (focusRow) document.getElementById(`row-${card.id}`)?.focus();
  };

  // ↑/↓ (or k/j) move through the list; Home/End jump to either end.
  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) return;
    const at = Math.max(index, 0);
    const to: Record<string, number> = {
      ArrowDown: Math.min(at + 1, items.length - 1),
      j: Math.min(at + 1, items.length - 1),
      ArrowUp: Math.max(at - 1, 0),
      k: Math.max(at - 1, 0),
      Home: 0,
      End: items.length - 1,
    };
    const target = to[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const card = items[target];
    if (card) select(card, true);
  }

  // After an action the server accepted: fetch the queues again. If the lead left this queue
  // (approved, nudged, closed), open the one now in its place and say where it went.
  async function afterChange(leadId: string) {
    const before = items.findIndex((c) => c.id === leadId);
    const name = items[before] ? displayName(items[before]) : 'That contact';
    const fresh = await refresh();
    if (!fresh) return;
    const after = queueItems(fresh, queue);
    if (after.some((c) => c.id === leadId)) return;
    const next = after[Math.min(Math.max(before, 0), after.length - 1)] ?? null;
    const moved = allCards(fresh).find((c) => c.id === leadId);
    const where = moved ? `moved to ${QUEUE_UI[queueFor(moved.next.need)].label}` : 'is closed';
    setParams(next ? { queue, lead: next.id } : { queue }, { replace: true });
    setToast(
      `${name} ${where}. ${next ? sentence(`Next: ${displayName(next)}`) : `${QUEUE_UI[queue].label} is clear.`}`,
    );
  }

  // Act now stays first; then queues holding a red lead, then amber, then the rest, each group
  // in its usual order. Tiles reorder as priorities change.
  const rank = (key: QueueKey) => {
    if (key === 'act_now') return -1;
    const top = topPriority(levels[key]);
    return top ? PRIORITIES.indexOf(top) : PRIORITIES.length;
  };
  const ownerQueues = QUEUES.filter((q) => q.owner).sort((a, b) => rank(a.key) - rank(b.key));
  const customerQueues = QUEUES.filter((q) => !q.owner);

  return (
    <div className="page page--work">
      <header className="page__header">
        <h1 className="page__title">Front Desk</h1>
      </header>

      {leads.status === 'loading' && (
        <p className="page__note" role="status">
          Loading your queues…
        </p>
      )}

      {leads.status === 'error' && (
        <div className="notice" role="alert">
          <p>We couldn't load your contacts. Nothing has changed; this is only the view.</p>
          <button className="button" type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <nav className="board" aria-label="Queues">
            <div className="board__group" role="group" aria-label="Needs action">
              <div className="board__tiles">
                {ownerQueues.map((q) => (
                  <QueueTile
                    key={q.key}
                    queue={q.key}
                    levels={levels[q.key]}
                    selected={queue === q.key}
                    onSelect={() => chooseQueue(q.key)}
                  />
                ))}
              </div>
            </div>
            <div
              className="board__group board__group--other"
              role="group"
              aria-label="No action needed"
            >
              <div className="board__tiles">
                {customerQueues.map((q) => (
                  <QueueTile
                    key={q.key}
                    queue={q.key}
                    levels={levels[q.key]}
                    selected={queue === q.key}
                    onSelect={() => chooseQueue(q.key)}
                  />
                ))}
              </div>
            </div>
          </nav>
          <ul className="legend" aria-label="What the colours mean">
            <li>
              <span className="legend__dot legend__dot--now" aria-hidden="true" />
              <strong>Act now</strong> at risk, about to lose a time, or waiting over{' '}
              {waitLimitLabel(data?.actNowAfterHours ?? 24)}
            </li>
            <li>
              <span className="legend__dot legend__dot--soon" aria-hidden="true" />
              <strong>Soon</strong> needs a response
            </li>
            <li>
              <span className="legend__dot legend__dot--on_track" aria-hidden="true" />
              <strong>On track</strong> waiting on the customer, or booked
            </li>
          </ul>

          <div className="work">
            <section className="work__list" aria-labelledby="queue-heading">
              <div className="work__head">
                <h2 id="queue-heading" className="section-title">
                  {QUEUE_UI[queue].label}
                  <span className="work__count">{counts[queue]}</span>
                </h2>
                <p className="meta">
                  {isOwnerQueue(queue)
                    ? 'Most urgent first, then longest waiting.'
                    : queue === 'booked'
                      ? 'Soonest appointment first.'
                      : 'Most recent first.'}
                </p>
              </div>
              {items.length === 0 ? (
                <p className="work__empty">
                  Nothing in {QUEUE_UI[queue].label}.{' '}
                  {queue !== DEFAULT_QUEUE && counts[DEFAULT_QUEUE] > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => chooseQueue(DEFAULT_QUEUE)}
                    >
                      See Act now
                    </button>
                  )}
                </p>
              ) : (
                <ul
                  className="rows"
                  aria-label={`${QUEUE_UI[queue].label} contacts`}
                  onKeyDown={onListKey}
                >
                  {items.map((card) => (
                    <Row
                      key={card.id}
                      card={card}
                      queue={queue}
                      timeZone={timeZone}
                      overdueHours={data.actNowAfterHours}
                      selected={wide && card.id === selected?.id}
                      onOpen={() => select(card)}
                    />
                  ))}
                </ul>
              )}
              {wide && items.length > 1 && (
                <p className="work__keys meta">↑ ↓ to move through the list</p>
              )}
            </section>

            {wide && selected && (
              <section className="pane" aria-label={`Contact: ${displayName(selected)}`}>
                <div className="pane__bar">
                  {(() => {
                    const p = cardPriority(selected, data.actNowAfterHours);
                    return (
                      <span className={`priority priority--${p.level} priority--wide`}>
                        {PRIORITY_LABEL[p.level]} · {PRIORITY_REASON[p.reason]}
                      </span>
                    );
                  })()}
                  <span className="meta">
                    {index + 1} of {items.length} in {QUEUE_UI[queue].label}
                  </span>
                  <div className="pane__nav">
                    <button
                      type="button"
                      className="button button--small"
                      disabled={index <= 0}
                      onClick={() => {
                        const prev = items[index - 1];
                        if (prev) select(prev, true);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="button button--small"
                      disabled={index >= items.length - 1}
                      onClick={() => {
                        const next = items[index + 1];
                        if (next) select(next, true);
                      }}
                    >
                      Next
                    </button>
                    <Link className="button button--small" to={`/leads/${selected.id}`}>
                      Full page
                    </Link>
                  </div>
                </div>
                <LeadWorkspace
                  key={selected.id}
                  id={selected.id}
                  me={me}
                  accessToken={accessToken}
                  heading="h2"
                  onChanged={(id) => void afterChange(id)}
                />
              </section>
            )}
          </div>
        </>
      )}

      <p className="page__note">Sample data. {me.tenant.name} is fictional.</p>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast}</span>
            <button
              className="icon-button toast__close"
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
