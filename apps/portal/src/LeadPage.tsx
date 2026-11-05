import { Link, useParams } from 'react-router';
import {
  authorLabel,
  durationLabel,
  formatPhone,
  leadProgress,
  longSlotLabel,
  reasonLabel,
  statusLine,
  urgencyLabel,
  whenLabel,
} from './format';
import { Icon } from './icons';
import type { LeadDetail, Me } from './types';
import { useApi } from './useApi';

/**
 * One lead: what needs deciding, the details, then the whole conversation. Everything shown is
 * what the API returned (decision 24). Approving from the portal is the next step; until it
 * exists the page says how to approve instead of showing a button that does nothing.
 */

function CallLink({ lead }: { lead: LeadDetail }) {
  const { name, phone } = lead.contact;
  if (!phone) return null;
  return (
    <a className="button" href={`tel:${phone}`}>
      Call {name ?? formatPhone(phone)}
    </a>
  );
}

function Decision({ lead, timeZone }: { lead: LeadDetail; timeZone: string }) {
  const { request } = lead;
  const name = lead.contact.name ?? 'They';

  if (lead.state === 'requested' && request?.state === 'pending') {
    return (
      <section className="decision" aria-labelledby="decision-heading">
        <div className="decision__body">
          <h2 id="decision-heading" className="decision__eyebrow">
            {name} picked a time. It needs your OK.
          </h2>
          <p className="decision__headline">{longSlotLabel(request.slotStart, timeZone)}</p>
          {request.hold?.state === 'active' && (
            <p className="decision__detail">
              Held on your calendar until {longSlotLabel(request.hold.expiresAt, timeZone)}.
            </p>
          )}
          <p className="decision__note">
            Approving here is coming next. For now, reply 1 to the approval text to approve.
          </p>
        </div>
        <div className="decision__actions">
          <CallLink lead={lead} />
        </div>
      </section>
    );
  }

  if (lead.state === 'booked' && request?.state === 'approved') {
    const by = request.decidedByName
      ? ` by ${request.decidedByName}${request.decidedVia === 'text' ? ' by text' : ' in the portal'}`
      : '';
    return (
      <section className="decision decision--done" aria-labelledby="decision-heading">
        <div className="decision__body">
          <h2 id="decision-heading" className="decision__eyebrow">
            <Icon name="check" size={16} className="decision__check" />
            Booked
          </h2>
          <p className="decision__headline">{longSlotLabel(request.slotStart, timeZone)}</p>
          {request.decidedAt && (
            <p className="decision__detail">
              Approved{by}, {whenLabel(request.decidedAt, timeZone)}.
            </p>
          )}
        </div>
        <div className="decision__actions">
          <CallLink lead={lead} />
        </div>
      </section>
    );
  }

  const needsPerson = lead.state === 'needs_attention';
  return (
    <section className="decision" aria-labelledby="decision-heading">
      <div className="decision__body">
        <h2 id="decision-heading" className="decision__eyebrow">
          {needsPerson ? 'This one needs a person' : 'Where it stands'}
        </h2>
        <p className="decision__headline">
          {needsPerson
            ? reasonLabel(lead.reason)
            : statusLine(
                {
                  ...lead,
                  name: lead.contact.name,
                  phone: lead.contact.phone,
                  slotStart: request?.slotStart ?? null,
                },
                timeZone,
              )}
        </p>
      </div>
      <div className="decision__actions">
        <CallLink lead={lead} />
      </div>
    </section>
  );
}

function Conversation({ lead, timeZone }: { lead: LeadDetail; timeZone: string }) {
  const name = lead.contact.name ?? 'Caller';
  const { voicemail } = lead;
  return (
    <section className="conversation" aria-labelledby="conversation-heading">
      <h2 id="conversation-heading" className="section-title">
        Conversation
      </h2>

      {voicemail && (
        <div className="voicemail">
          <p className="meta">
            Voicemail from {name} · {durationLabel(voicemail.durationSeconds)} ·{' '}
            {whenLabel(voicemail.receivedAt, timeZone)}
          </p>
          {voicemail.transcript ? (
            <>
              <blockquote className="voicemail__transcript">"{voicemail.transcript}"</blockquote>
              {voicemail.confidence !== null && voicemail.confidence < 0.5 && (
                <p className="meta">
                  The transcript may be wrong; the recording was hard to make out.
                </p>
              )}
            </>
          ) : (
            <p className="meta">Not transcribed.</p>
          )}
        </div>
      )}

      {lead.messages.length === 0 && !voicemail && <p className="meta">No messages yet.</p>}

      <ol className="thread">
        {lead.messages.map((m) => (
          <li key={m.id} className={m.direction === 'out' ? 'message message--out' : 'message'}>
            <p className="meta">
              {authorLabel(m.author, name)} · {whenLabel(m.occurredAt, timeZone)}
              {(m.deliveryStatus === 'undelivered' || m.deliveryStatus === 'failed') && (
                <span className="message__failed"> · Not delivered</span>
              )}
            </p>
            <p className="message__body">{m.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Details({ lead }: { lead: LeadDetail }) {
  const { contact } = lead;
  return (
    <section className="details" aria-labelledby="details-heading">
      <h2 id="details-heading" className="section-title">
        Details
      </h2>
      <dl className="details__list">
        {lead.summary && (
          <div>
            <dt>What they need</dt>
            <dd>{lead.summary}</dd>
          </div>
        )}
        <div>
          <dt>How soon</dt>
          <dd>{urgencyLabel(lead.urgency)}</dd>
        </div>
        {lead.address && (
          <div>
            <dt>Address</dt>
            <dd>{lead.address}</dd>
          </div>
        )}
        {contact.phone && (
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${contact.phone}`}>{formatPhone(contact.phone)}</a>
            </dd>
          </div>
        )}
        {contact.email && (
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </dd>
          </div>
        )}
        <div>
          <dt>History</dt>
          <dd>
            {contact.earlierLeads === 0
              ? 'First time contacting you'
              : `${contact.earlierLeads} earlier request${contact.earlierLeads === 1 ? '' : 's'}`}
          </dd>
        </div>
      </dl>
      {lead.summary && (
        <p className="meta">
          "What they need" is summarized by AI from the voicemail and texts. Check it before you
          rely on it.
        </p>
      )}
    </section>
  );
}

const ARRIVED: Record<LeadDetail['source'], string> = {
  missed_call: 'missed call',
  text: 'text',
  email: 'email',
  form: 'website form',
};

/** "First contact 8:26 AM by missed call". */
function firstContact(lead: LeadDetail, timeZone: string): string {
  const when = whenLabel(lead.createdAt, timeZone);
  return `First contact ${when === 'Yesterday' ? 'yesterday' : when} by ${ARRIVED[lead.source]}`;
}

export function LeadPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const { id = '' } = useParams();
  const [lead, reload] = useApi<LeadDetail>(`/portal/leads/${encodeURIComponent(id)}`, accessToken);
  const timeZone = me.tenant.timezone;

  return (
    <div className="page page--narrow">
      <Link className="back-link" to="/">
        ← Back to Today
      </Link>

      {lead.status === 'loading' && (
        <p className="page__note" role="status">
          Loading this lead…
        </p>
      )}

      {lead.status === 'error' && (
        <div className="notice" role="alert">
          <p>
            {lead.error.status === 404 || lead.error.status === 400
              ? "We couldn't find this lead. It may belong to a different business, or the link is wrong."
              : "We couldn't load this lead. Nothing has changed; this is only the view."}
          </p>
          {lead.error.status !== 404 && lead.error.status !== 400 && (
            <button className="button" type="button" onClick={reload}>
              Try again
            </button>
          )}
        </div>
      )}

      {lead.status === 'ready' && (
        <>
          <header className="page__header">
            <h1 className="page__title">
              {lead.data.contact.name ??
                (lead.data.contact.phone ? formatPhone(lead.data.contact.phone) : 'Unknown caller')}
            </h1>
            <p className="page__lede">{firstContact(lead.data, timeZone)}</p>
          </header>

          {(() => {
            const steps = leadProgress(lead.data.source, lead.data.state);
            return steps ? (
              <ol className="steps__list steps__list--lead" aria-label="Progress">
                {steps.map((step) => (
                  <li
                    key={step.label}
                    className={`step step--${step.status}`}
                    aria-current={step.status === 'current' ? 'step' : undefined}
                  >
                    <span className="step__dot" aria-hidden="true" />
                    {step.label}
                  </li>
                ))}
              </ol>
            ) : null;
          })()}

          <Decision lead={lead.data} timeZone={timeZone} />

          <div className="lead-columns">
            <Conversation lead={lead.data} timeZone={timeZone} />
            <Details lead={lead.data} />
          </div>
        </>
      )}
    </div>
  );
}
