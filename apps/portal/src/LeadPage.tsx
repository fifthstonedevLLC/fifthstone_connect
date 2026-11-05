import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiPost } from './api';
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
  workLabel,
  actionErrorMessage,
} from './format';
import { Icon } from './icons';
import type { LeadDetail, Me, PortalAction } from './types';
import { useApi } from './useApi';

/**
 * One lead: what needs deciding, the details, then the whole conversation. Everything shown is
 * what the API returned (decision 24): after an action the page shows the lead exactly as the
 * server now has it, including work still in progress. Owners and staff can take every action
 * (decision 25).
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

const ACTION_LABEL: Record<PortalAction, { idle: string; busy: string }> = {
  approve: { idle: 'Approve', busy: 'Approving…' },
  suggest_time: { idle: 'Suggest another time', busy: 'Sending…' },
  nudge: { idle: 'Nudge', busy: 'Nudging…' },
  close: { idle: 'Close lead', busy: 'Closing…' },
};

/** Which actions make sense for the lead as the server reported it. */
function availableActions(lead: LeadDetail): PortalAction[] {
  const pending = lead.state === 'requested' && lead.request?.state === 'pending';
  if (pending) return ['approve', 'suggest_time', 'close'];
  if (lead.state === 'quiet') {
    // One nudge per lead: once one is queued or running, only Close remains.
    const nudging = lead.pendingWork.some((w) => w.actionType === 'send_nudge');
    return nudging ? ['close'] : ['nudge', 'close'];
  }
  if (['booked', 'closed', 'spam', 'opted_out'].includes(lead.state)) return [];
  if (lead.state === 'requested' && lead.request?.state === 'approved') return [];
  return ['close'];
}

function Actions({
  lead,
  run,
  busy,
}: {
  lead: LeadDetail;
  run: (action: PortalAction) => void;
  busy: PortalAction | null;
}) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const actions = availableActions(lead);

  if (confirmingClose) {
    return (
      <div className="decision__actions" role="group" aria-label="Confirm closing this lead">
        <p className="decision__confirm">
          Close this lead? Follow-ups stop, and any held time is released.
        </p>
        <button
          className="button button--primary"
          type="button"
          disabled={busy !== null}
          onClick={() => run('close')}
        >
          {busy === 'close' ? ACTION_LABEL.close.busy : 'Yes, close it'}
        </button>
        <button
          className="button"
          type="button"
          disabled={busy !== null}
          onClick={() => setConfirmingClose(false)}
        >
          Keep it open
        </button>
      </div>
    );
  }

  return (
    <div className="decision__actions">
      {actions.map((action, i) => (
        <button
          key={action}
          className={i === 0 && action !== 'close' ? 'button button--primary' : 'button'}
          type="button"
          disabled={busy !== null}
          onClick={() => (action === 'close' ? setConfirmingClose(true) : run(action))}
        >
          {busy === action ? ACTION_LABEL[action].busy : ACTION_LABEL[action].idle}
        </button>
      ))}
      <CallLink lead={lead} />
    </div>
  );
}

function PendingWork({ lead }: { lead: LeadDetail }) {
  if (lead.pendingWork.length === 0) return null;
  return (
    <ul className="decision__work" aria-label="In progress">
      {lead.pendingWork.map((w) => (
        <li key={`${w.actionType}-${w.status}`}>{workLabel(w.actionType, w.status)}</li>
      ))}
    </ul>
  );
}

function decidedBy(request: NonNullable<LeadDetail['request']>, timeZone: string): string | null {
  if (!request.decidedAt) return null;
  const who = request.decidedByName ? ` by ${request.decidedByName}` : '';
  const how = request.decidedVia === 'text' ? ' by text' : ' in the portal';
  return `${who}${how}, ${whenLabel(request.decidedAt, timeZone)}`;
}

function Decision({
  lead,
  timeZone,
  run,
  busy,
  error,
}: {
  lead: LeadDetail;
  timeZone: string;
  run: (action: PortalAction) => void;
  busy: PortalAction | null;
  error: string | null;
}) {
  const { request } = lead;
  const name = lead.contact.name ?? 'They';

  let eyebrow: ReactNode;
  let headline: string;
  let detail: string | null = null;
  let done = false;

  if (lead.state === 'requested' && request?.state === 'pending') {
    eyebrow = `${name} picked a time. It needs your OK.`;
    headline = longSlotLabel(request.slotStart, timeZone);
    detail =
      request.hold?.state === 'active'
        ? `Held on your calendar until ${longSlotLabel(request.hold.expiresAt, timeZone)}. Approving creates the calendar event; ${name === 'They' ? 'they are' : `${name} is`} texted once it exists.`
        : null;
  } else if (lead.state === 'requested' && request?.state === 'approved') {
    eyebrow = 'Approved. Confirming with your calendar.';
    headline = longSlotLabel(request.slotStart, timeZone);
    detail = `Approved${decidedBy(request, timeZone) ?? ''}. It shows as booked once the calendar event exists.`;
  } else if (lead.state === 'requested' && request?.state === 'changed') {
    eyebrow = 'You asked for another time.';
    headline = 'Sending new times';
    detail = `Changed${decidedBy(request, timeZone) ?? ''}.`;
  } else if (lead.state === 'booked' && request?.state === 'approved') {
    eyebrow = (
      <>
        <Icon name="check" size={16} className="decision__check" />
        Booked
      </>
    );
    headline = longSlotLabel(request.slotStart, timeZone);
    detail = `Approved${decidedBy(request, timeZone) ?? ''}.`;
    done = true;
  } else if (lead.state === 'needs_attention') {
    eyebrow = 'This one needs a person';
    headline = reasonLabel(lead.reason);
  } else if (lead.state === 'closed') {
    eyebrow = 'Closed';
    headline = lead.reason === 'closed_in_portal' ? 'Closed in the portal' : 'Closed';
  } else {
    eyebrow = 'Where it stands';
    headline = statusLine(
      {
        ...lead,
        name: lead.contact.name,
        phone: lead.contact.phone,
        slotStart: request?.slotStart ?? null,
        requestState:
          request?.state === 'pending' ||
          request?.state === 'approved' ||
          request?.state === 'changed'
            ? request.state
            : null,
      },
      timeZone,
    );
  }

  return (
    <section
      className={done ? 'decision decision--done' : 'decision'}
      aria-labelledby="decision-heading"
    >
      <div className="decision__body">
        <h2 id="decision-heading" className="decision__eyebrow">
          {eyebrow}
        </h2>
        <p className="decision__headline">{headline}</p>
        {detail && <p className="decision__detail">{detail}</p>}
        <PendingWork lead={lead} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Actions
        key={`${lead.state}-${request?.state ?? 'none'}`}
        lead={lead}
        run={run}
        busy={busy}
      />
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
  const path = `/portal/leads/${encodeURIComponent(id)}`;
  const [lead, reload, replace] = useApi<LeadDetail>(path, accessToken);
  const [busy, setBusy] = useState<PortalAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const timeZone = me.tenant.timezone;

  // Show the server's answer, never an assumed result: on success the response is the lead as it
  // now stands; on a refusal nothing was written, so reload to show the latest.
  async function run(action: PortalAction) {
    setBusy(action);
    setActionError(null);
    try {
      replace(await apiPost<LeadDetail>(`${path}/actions`, accessToken, { action }));
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'error';
      setActionError(actionErrorMessage(code));
      if (error instanceof ApiError && error.status === 409) reload();
    } finally {
      setBusy(null);
    }
  }

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

          <Decision
            lead={lead.data}
            timeZone={timeZone}
            run={run}
            busy={busy}
            error={actionError}
          />

          <div className="lead-columns">
            <Conversation lead={lead.data} timeZone={timeZone} />
            <Details lead={lead.data} />
          </div>
        </>
      )}
    </div>
  );
}
