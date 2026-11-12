import { countSegments } from '@fsc/core/segments';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError, apiPost } from './api';
import {
  authorLabel,
  durationLabel,
  formatPhone,
  guidanceFor,
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
import { newId } from './ids';
import type { LeadDetail, Me, PortalAction } from './types';
import { useApi } from './useApi';

/** Closed out: nothing more goes to the customer from here. */
const CLOSED_STATES: readonly LeadDetail['state'][] = ['closed', 'spam', 'opted_out'];

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
  close: { idle: 'Close out', busy: 'Closing…' },
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
  // The next step already offers the call when that is what the lead needs.
  const callIsNext = lead.next.action === 'call' || lead.next.action === 'reschedule';

  if (confirmingClose) {
    return (
      <div className="decision__actions" role="group" aria-label="Confirm closing out this contact">
        <p className="decision__confirm">
          Close out this contact? Follow-ups stop, and any held time is released.
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
      <NextControl lead={lead} />
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
      {!callIsNext && <CallLink lead={lead} />}
    </div>
  );
}

/** Moves to a part of this lead (the reply box, the voicemail) and puts keyboard focus there. */
function goTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  const focusable = target.querySelector<HTMLElement>('input, button, a[href]');
  (id === 'reply' && focusable ? focusable : target).focus({ preventScroll: true });
}

/**
 * The lead's next step as the leading button, matched to what it needs (the server's `next`):
 * a call, a reply, the voicemail. Approve and Nudge are already the leading actions.
 */
function NextControl({ lead }: { lead: LeadDetail }) {
  const { name, phone } = lead.contact;
  const who = name ?? (phone ? formatPhone(phone) : 'them');
  switch (lead.next.action) {
    case 'call':
    case 'reschedule':
      return phone ? (
        <a className="button button--primary button--cta" href={`tel:${phone}`}>
          <Icon name="phone" size={16} />
          {lead.next.action === 'reschedule' ? `Call ${who} to reschedule` : `Call ${who}`}
        </a>
      ) : null;
    case 'reply':
      return lead.replyOptions.length > 0 ? (
        <button
          className="button button--primary button--cta"
          type="button"
          onClick={() => goTo('reply')}
        >
          <Icon name="reply" size={16} />
          Reply
        </button>
      ) : null;
    case 'listen':
      return lead.voicemail ? (
        <button
          className="button button--primary button--cta"
          type="button"
          onClick={() => goTo('voicemail')}
        >
          <Icon name="voicemail" size={16} />
          Listen to the voicemail
        </button>
      ) : null;
    default:
      return null;
  }
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
    detail = guidanceFor(lead.reason);
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
        holdExpiresAt: null,
      },
      timeZone,
    );
  }

  return (
    <section
      className={done ? 'decision decision--done' : 'decision'}
      aria-labelledby="decision-heading"
      id="decision"
      tabIndex={-1}
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

/**
 * Replies: an owner-approved template (decision 26), or the person's own words where the owner
 * switched free text on and lets them use it (decisions 39 and 40). The server checks all of it
 * again. The message ID is made once per reply, so a double click records one message.
 */
function ReplyBox({
  lead,
  me,
  onSent,
  accessToken,
  path,
}: {
  lead: LeadDetail;
  me: Me;
  onSent: (lead: LeadDetail) => void;
  accessToken: string;
  path: string;
}) {
  const canTemplates = me.capabilities.includes('reply_templates') && lead.replyOptions.length > 0;
  const canType =
    me.capabilities.includes('reply_free_text') &&
    me.freeTextChannels.includes('sms') &&
    !CLOSED_STATES.includes(lead.state);
  const [mode, setMode] = useState<'template' | 'text'>(canTemplates ? 'template' : 'text');
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [messageId, setMessageId] = useState(() => newId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canTemplates && !canType) return null;
  const typing = mode === 'text' && canType;
  const segments = countSegments(text.trim()).segments;

  async function send() {
    if (typing ? text.trim() === '' : !choice) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiPost<LeadDetail>(
        `${path}/replies`,
        accessToken,
        typing ? { text, messageId } : { templateKey: choice, messageId },
      );
      setChoice(null);
      setText('');
      setMessageId(newId());
      onSent(updated);
    } catch (e) {
      setError(actionErrorMessage(e instanceof ApiError ? e.code : 'error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="reply"
      id="reply"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {canTemplates && canType && (
        <div className="reply__modes" role="radiogroup" aria-label="How to reply">
          {(['template', 'text'] as const).map((m) => (
            <label key={m} className="day-toggle">
              <input
                type="radio"
                name="reply-mode"
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setError(null);
                }}
              />
              <span>{m === 'template' ? 'Template' : 'Your own words'}</span>
            </label>
          ))}
        </div>
      )}
      {typing ? (
        <label className="field">
          <span className="section-title">Reply in your own words</span>
          <textarea
            className="field__input reply__text"
            rows={4}
            maxLength={1600}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="meta">
            {segments <= 1 ? 'One text' : `${segments} texts`} when sent. Keep it short; no prices
            you have not agreed.
          </span>
        </label>
      ) : (
        <fieldset className="reply__options">
          <legend className="section-title">Reply with a template</legend>
          {lead.replyOptions.map((option) => (
            <label key={option.key} className="reply__option">
              <input
                type="radio"
                name="reply"
                value={option.key}
                checked={choice === option.key}
                onChange={() => setChoice(option.key)}
              />
              <span>{option.body}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="reply__actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || (typing ? text.trim() === '' : !choice)}
        >
          {busy ? 'Sending…' : 'Send reply'}
        </button>
        {!typing && (
          <span className="meta">Only templates your business approved are sent from here.</span>
        )}
      </div>
    </form>
  );
}

const DELIVERY_LABEL: Partial<Record<LeadDetail['messages'][number]['deliveryStatus'], string>> = {
  queued: 'Queued',
  sent: 'Sent',
  undelivered: 'Not delivered',
  failed: 'Not delivered',
};

function Conversation({
  lead,
  timeZone,
  reply,
}: {
  lead: LeadDetail;
  timeZone: string;
  reply: ReactNode;
}) {
  const name = lead.contact.name ?? 'Caller';
  const { voicemail } = lead;
  return (
    <section className="conversation" aria-labelledby="conversation-heading">
      <h2 id="conversation-heading" className="section-title">
        Conversation
      </h2>

      {voicemail && (
        <div className="voicemail" id="voicemail" tabIndex={-1}>
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
              {DELIVERY_LABEL[m.deliveryStatus] && (
                <span
                  className={
                    m.deliveryStatus === 'undelivered' || m.deliveryStatus === 'failed'
                      ? 'message__failed'
                      : undefined
                  }
                >
                  {' '}
                  · {DELIVERY_LABEL[m.deliveryStatus]}
                </span>
              )}
            </p>
            <p className="message__body">{m.body}</p>
          </li>
        ))}
      </ol>
      {reply}
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

export interface LeadWorkspaceProps {
  id: string;
  me: Me;
  accessToken: string;
  /** The full page uses a page title; the work list's side pane uses a section heading. */
  heading?: 'h1' | 'h2';
  /** Follow `#reply`, `#voicemail` or `#decision` in the address once the lead loads. */
  followHash?: boolean;
  /** Called after an action or reply the server accepted, so a list beside it can refresh. */
  onChanged?: (leadId: string) => void;
}

/**
 * One lead, all of it: progress, the decision and its actions, the conversation with template
 * replies, and the details. Used by the lead page and by the work list's side pane.
 */
export function LeadWorkspace({
  id,
  me,
  accessToken,
  heading = 'h1',
  followHash = false,
  onChanged,
}: LeadWorkspaceProps) {
  const path = `/portal/leads/${encodeURIComponent(id)}`;
  const [lead, reload, replace] = useApi<LeadDetail>(path, accessToken);
  const location = useLocation();

  // A deep link (#reply, #voicemail, #decision) lands on that part of the lead with keyboard
  // focus there, once the lead has loaded.
  const ready = lead.status === 'ready';
  useEffect(() => {
    if (!followHash || !ready || !location.hash) return;
    goTo(location.hash.slice(1));
  }, [followHash, ready, location.hash]);
  const [busy, setBusy] = useState<PortalAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const timeZone = me.tenant.timezone;
  const Title = heading;

  // Show the server's answer, never an assumed result: on success the response is the lead as it
  // now stands; on a refusal nothing was written, so reload to show the latest.
  async function run(action: PortalAction) {
    setBusy(action);
    setActionError(null);
    try {
      replace(await apiPost<LeadDetail>(`${path}/actions`, accessToken, { action }));
      onChanged?.(id);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'error';
      setActionError(actionErrorMessage(code));
      if (error instanceof ApiError && error.status === 409) reload();
    } finally {
      setBusy(null);
    }
  }

  if (lead.status === 'loading') {
    return (
      <p className="page__note" role="status">
        Loading this contact…
      </p>
    );
  }

  if (lead.status === 'error') {
    return (
      <div className="notice" role="alert">
        <p>
          {lead.error.status === 404 || lead.error.status === 400
            ? "We couldn't find this contact. It may belong to a different business, or the link is wrong."
            : "We couldn't load this contact. Nothing has changed; this is only the view."}
        </p>
        {lead.error.status !== 404 && lead.error.status !== 400 && (
          <button className="button" type="button" onClick={reload}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const steps = leadProgress(lead.data.source, lead.data.state);
  return (
    <>
      <header className="page__header">
        <Title className={heading === 'h1' ? 'page__title' : 'pane__title'}>
          {lead.data.contact.name ??
            (lead.data.contact.phone ? formatPhone(lead.data.contact.phone) : 'Unknown caller')}
        </Title>
        <p className="page__lede">{firstContact(lead.data, timeZone)}</p>
      </header>

      {steps && (
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
      )}

      <Decision lead={lead.data} timeZone={timeZone} run={run} busy={busy} error={actionError} />

      <div className="lead-columns">
        <Conversation
          lead={lead.data}
          timeZone={timeZone}
          reply={
            <ReplyBox
              lead={lead.data}
              me={me}
              onSent={(updated) => {
                replace(updated);
                onChanged?.(id);
              }}
              accessToken={accessToken}
              path={path}
            />
          }
        />
        <Details lead={lead.data} />
      </div>
    </>
  );
}

export function LeadPage({ me, accessToken }: { me: Me; accessToken: string }) {
  const { id = '' } = useParams();
  return (
    <div className="page page--narrow">
      <Link className="back-link" to="/">
        ← Back to Front Desk
      </Link>
      <LeadWorkspace key={id} id={id} me={me} accessToken={accessToken} followHash />
    </div>
  );
}
