import { Link } from 'react-router';
import { Icon } from './icons';
import type { Me, ServiceState } from './types';

/**
 * What a business sees before it is live (decisions 35 and 36). The owner lands here once setup
 * is finished; staff see it until the business goes live. Going live does not wait on texting. The working pages stay locked
 * on the server too, and nothing is sent to customers until Fifth Stone Dev turns the business on.
 */

const TEXTING: Record<ServiceState, string> = {
  not_started: 'Sent to Fifth Stone Dev, who submit it to the carriers.',
  submitted: 'With the carriers for review. This can take several days or longer.',
  approved: 'Approved.',
  rejected:
    'Needs a fix. Fifth Stone Dev will tell you what to change; then send it again from Setup.',
  disabled: 'Turned off. Contact Fifth Stone Dev.',
};

function Row({ done, title, children }: { done: boolean; title: string; children: string }) {
  return (
    <li className="status-row">
      <Icon
        name={done ? 'check' : 'clock'}
        size={18}
        className={done ? 'service__icon--live' : 'service__icon'}
      />
      <div>
        <p className="status-row__title">
          {title}
          <span className="sr-only">{done ? ' (done)' : ' (waiting)'}</span>
        </p>
        <p className="meta">{children}</p>
      </div>
    </li>
  );
}

export function StatusPage({ me }: { me: Me }) {
  const business = me.tenant.name;
  const owner = me.role === 'owner';

  if (me.stage === 'setting_up') {
    return (
      <div className="page">
        <header className="page__header">
          <h1 className="page__title">{business} is getting set up</h1>
          <p className="page__lede">
            The owner is finishing setup. Your Front Desk opens when {business} goes live.
          </p>
        </header>
      </div>
    );
  }

  const texting = me.services.texting;
  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">
          {owner ? 'Setup is finished' : `${business} is almost ready`}
        </h1>
        <p className="page__lede">
          The Front Desk opens when {business} goes live. Until then, nothing is sent to customers.
        </p>
      </header>
      <ul className="status-list">
        <Row done title="Setup finished">
          {owner ? 'You can still change any step.' : 'The owner finished setup.'}
        </Row>
        {me.textingDeclined ? (
          <Row done title="Texting">
            {owner
              ? 'Not used. Missed calls come to your Front Desk to call back; you can turn on texting later from Setup.'
              : 'Not used. Missed calls come to the Front Desk to call back.'}
          </Row>
        ) : (
          <Row done={texting === 'approved'} title="Texting registration">
            {TEXTING[texting]}
          </Row>
        )}
        <Row done={false} title="Going live">
          {`Fifth Stone Dev turns ${business} on and lets you know. Texting does not hold this up: it switches on whenever it is approved.`}
        </Row>
      </ul>
      {owner && (
        <div className="setup-actions">
          <Link className="button" to="/setup">
            Review setup
          </Link>
          <Link className="button" to="/templates">
            Templates &amp; AI
          </Link>
        </div>
      )}
    </div>
  );
}
