import { Link } from 'react-router';
import {
  displayName,
  formatPhone,
  isEmergency,
  statusLine,
  summarySentence,
  whenLabel,
} from './format';
import { Icon, type IconName } from './icons';
import type { LeadCard, Me, Today } from './types';
import { useApi } from './useApi';

const LANES: {
  key: keyof Today['lanes'];
  title: string;
  icon: IconName;
  tone: string;
  empty: string;
}[] = [
  {
    key: 'needsYou',
    title: 'Needs you',
    icon: 'alert',
    tone: 'bronze',
    empty: 'Nothing needs you right now.',
  },
  {
    key: 'waitingOnCustomer',
    title: 'Waiting on customer',
    icon: 'clock',
    tone: 'river',
    empty: 'Nobody is mid-conversation.',
  },
  { key: 'booked', title: 'Booked', icon: 'check', tone: 'sage', empty: 'Nothing booked yet.' },
  {
    key: 'wentQuiet',
    title: 'Went quiet',
    icon: 'pause',
    tone: 'river',
    empty: 'Nobody has gone quiet. Leads land here after a day without a reply.',
  },
];

const STEPS = ['Missed call', 'Details gathered', 'Time picked', 'Your approval', 'Booked'];

function Card({ card, timeZone }: { card: LeadCard; timeZone: string }) {
  const emergency = isEmergency(card);
  return (
    <article className={emergency ? 'card card--emergency' : 'card'}>
      <div className="card__head">
        <h3 className="card__name">
          <Link to={`/leads/${card.id}`}>{displayName(card)}</Link>
        </h3>
        <span className="card__when">{whenLabel(card.createdAt, timeZone)}</span>
      </div>
      {emergency && (
        <p className="card__flag">
          <Icon name="warning" size={15} />
          Emergency
        </p>
      )}
      {card.summary && <p className="card__summary">{card.summary}</p>}
      {/* An emergency's flag already says "Emergency"; only add facts beyond it. */}
      {!(emergency && card.reason === 'emergency') && (
        <p className="card__status">{statusLine(card, timeZone)}</p>
      )}
      {emergency && card.phone && (
        <a className="button button--primary" href={`tel:${card.phone}`}>
          Call {card.name ?? formatPhone(card.phone)}
        </a>
      )}
    </article>
  );
}

export function TodayPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const [today, reload] = useApi<Today>('/portal/today', accessToken);
  const timeZone = me.tenant.timezone;
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());

  return (
    <div className="page">
      <div className="page__bar">
        <span className="page__date">{date}</span>
      </div>

      <header className="page__header">
        <h1 className="page__title">Today</h1>
        <p className="page__lede" aria-live="polite">
          {today.status === 'ready' ? summarySentence(today.data.lanes.needsYou) : ' '}
        </p>
      </header>

      <section className="steps" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="steps__heading">
          Every lead follows the same five steps. The first three run from your templates and
          calendar.
        </h2>
        <ol className="steps__list">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className={i < 3 ? 'step step--auto' : i === 3 ? 'step step--you' : 'step'}
            >
              <span className="step__dot" aria-hidden="true" />
              {step}
            </li>
          ))}
        </ol>
      </section>

      {today.status === 'loading' && (
        <p className="page__note" role="status">
          Loading today's leads…
        </p>
      )}

      {today.status === 'error' && (
        <div className="notice" role="alert">
          <p>We couldn't load today's leads. Nothing has changed; this is only the view.</p>
          <button className="button" type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {today.status === 'ready' && (
        <div className="lanes">
          {LANES.map((lane) => {
            const cards = today.data.lanes[lane.key];
            return (
              <section
                key={lane.key}
                className={`lane lane--${lane.tone}`}
                aria-labelledby={`lane-${lane.key}`}
              >
                <div className="lane__head">
                  <Icon name={lane.icon} size={18} className="lane__icon" />
                  <h2 id={`lane-${lane.key}`} className="lane__title">
                    {lane.title}
                  </h2>
                </div>
                {cards.length === 0 ? (
                  <p className="lane__empty">{lane.empty}</p>
                ) : (
                  cards.map((card) => <Card key={card.id} card={card} timeZone={timeZone} />)
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="page__note">Sample data. {me.tenant.name} is fictional.</p>
    </div>
  );
}
