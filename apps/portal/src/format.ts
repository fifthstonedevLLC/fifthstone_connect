import { MAX_TEMPLATE_SEGMENTS, OPT_OUT_LINE, type TemplateProblem } from '@fsc/conversation';
import type { LeadCard, LeadSource, LeadState, ServiceState, Urgency } from './types';

/**
 * Turns lead data into the plain words the dashboard shows. Every line describes what the server
 * reported; nothing here guesses at a state the data does not hold (decision 24).
 */

const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: 'emergency',
  this_week: 'this week',
  flexible: 'flexible',
};

const REASON_LABEL: Record<string, string> = {
  emergency: 'Emergency',
  safety_message_sent: 'Safety message sent',
  unsure: "We couldn't tell what they need",
  price_question: 'Asked about price',
  hold_expired: 'Hold expired before approval',
  delivery_failed: 'Text-back undelivered',
  complaint: 'Upset; needs a person',
  minor: 'May be under 18',
  texting_not_live: "Texting wasn't live yet; call them",
  not_english: 'Not in English',
  reschedule: 'Wants to move a booking',
  cancellation: 'Wants to cancel a booking',
  voicemail_to_review: 'Voicemail to listen to',
  private_details: 'Shared private details',
  crisis_message_sent: 'Crisis message sent',
};

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** "9:42 AM" today, "Yesterday", or "Mon, Nov 2", in the business's time zone. */
export function whenLabel(iso: string, timeZone: string, now = new Date()): string {
  const date = new Date(iso);
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
  const day = dayKey(date, timeZone);
  if (day === today) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  if (day === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** "Thu 2:00 PM" for a slot, in the business's time zone. */
export function slotLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** The flag on an urgent card (the server decides which cards are urgent). */
export function urgentFlag(card: LeadCard): string {
  return card.reason === 'crisis_message_sent' ? 'Crisis' : 'Emergency';
}

/** The one-line status under each card. */
export function statusLine(
  card: Omit<LeadCard, 'urgent' | 'waitingSince' | 'next'>,
  timeZone: string,
): string {
  const urgency = card.urgency ? ` · ${URGENCY_LABEL[card.urgency]}` : '';
  const slot = card.slotStart ? slotLabel(card.slotStart, timeZone) : null;
  const byState: Partial<Record<LeadState, string>> = {
    needs_attention: (card.reason && REASON_LABEL[card.reason]) ?? 'Needs a person',
    requested:
      card.requestState === 'approved'
        ? `Approved · confirming ${slot ?? 'the time'} with your calendar`
        : card.requestState === 'changed'
          ? 'Sending new times'
          : slot
            ? `Picked ${slot}${urgency} · waiting for your OK`
            : `Waiting for your OK${urgency}`,
    offered: `Times sent, no pick yet${urgency}`,
    clarifying: `Waiting for their details${urgency}`,
    new: 'Just came in',
    booked: slot ? `On your calendar · ${slot}` : 'Booked',
    quiet: 'No reply for a day or more',
  };
  return byState[card.state] ?? card.state;
}

/** "+13195550142" as "(319) 555-0142"; other numbers are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** The person's name, or their number when no name is known yet. */
export function displayName(card: LeadCard): string {
  return card.name ?? (card.phone ? formatPhone(card.phone) : 'Unknown caller');
}

const SERVICE_LABEL: Record<ServiceState, string> = {
  not_started: 'Not started',
  submitted: 'Pending approval',
  approved: 'Live',
  rejected: 'Needs attention',
  disabled: 'Off',
};

export function serviceLabel(state: ServiceState): string {
  return SERVICE_LABEL[state];
}

/** The sentence under "Front Desk": who needs the owner, by name, in plain words. */
const FIRST_STEP: Record<LeadSource, string> = {
  missed_call: 'Missed call',
  text: 'Text received',
  email: 'Email received',
  form: 'Form received',
};

/** States on the normal path, and which of the five steps each one is at (0-based). */
const STEP_OF: Partial<Record<LeadState, number>> = {
  new: 0,
  clarifying: 1,
  offered: 2,
  requested: 3,
  booked: 4,
};

/**
 * The five-step line for one lead, or null when the lead has left the normal path (needs a
 * person, went quiet, closed). Steps before the current one are done; `booked` completes all.
 */
export function leadProgress(
  source: LeadSource,
  state: LeadState,
): { label: string; status: 'done' | 'current' | 'upcoming' }[] | null {
  const at = STEP_OF[state];
  if (at === undefined) return null;
  const labels = [FIRST_STEP[source], 'Details gathered', 'Time picked', 'Your approval', 'Booked'];
  return labels.map((label, i) => ({
    label,
    status: state === 'booked' || i < at ? 'done' : i === at ? 'current' : 'upcoming',
  }));
}

/** "Thursday, Nov 12 at 2:00 PM" in the business's time zone. */
export function longSlotLabel(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${day} at ${time}`;
}

/** "0:24" for a voicemail length. */
export function durationLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function urgencyLabel(urgency: Urgency | null): string {
  return urgency ? URGENCY_LABEL[urgency].replace(/^./, (c) => c.toUpperCase()) : 'Not known yet';
}

/** Who wrote a message, as the owner should read it. */
export function authorLabel(
  author: 'customer' | 'template' | 'staff' | 'ai_question',
  contactName: string,
): string {
  return {
    customer: contactName,
    template: 'You, from your template',
    staff: 'You',
    ai_question: 'You, AI-drafted question',
  }[author];
}

export function reasonLabel(reason: string | null): string {
  return (reason && REASON_LABEL[reason]) ?? 'Needs a person';
}

const WORK_LABEL: Record<string, string> = {
  confirm_calendar_event: 'Creating the calendar event',
  release_hold: 'Releasing the held time',
  send_slot_offer: 'Texting new times',
  send_nudge: 'Sending a nudge',
  approval_reminder: 'Approval reminder',
  send_clarifying_question: 'Texting a question',
  transcribe_voicemail: 'Transcribing the voicemail',
  send_text_back: 'Texting back',
  send_text: 'Sending your reply',
};

const WORK_STATUS: Record<'queued' | 'running' | 'failed' | 'dead', string> = {
  queued: 'queued',
  running: 'in progress',
  failed: 'retrying',
  dead: "didn't go through",
};

/** "Creating the calendar event: queued" for one item of a lead's pending work. */
export function workLabel(actionType: string, status: keyof typeof WORK_STATUS): string {
  return `${WORK_LABEL[actionType] ?? 'Working'}: ${WORK_STATUS[status]}`;
}

const ACTION_ERROR: Record<string, string> = {
  no_pending_request:
    'This request was already decided, maybe by someone else. Showing the latest.',
  hold_expired:
    "The held time has lapsed, so it can't be approved. Suggest another time or call them.",
  not_quiet: "This contact isn't quiet anymore. Showing the latest.",
  already_nudged: 'A nudge has already gone to this person. Only one is sent per request.',
  opted_out: 'This person replied STOP, so no more texts can go to them. Call them instead.',
  already_closed: 'This contact is already closed out.',
  booked: "A booked job can't be closed here; it is on your calendar.",
  lead_closed: 'This contact is closed out, so no replies can go out.',
  not_reply_template: "That template can't be sent as a reply.",
  template_not_found: 'That reply template no longer exists. Pick another.',
  unfilled_placeholder: "That template has a blank we can't fill for this customer.",
  network: "We couldn't reach the server. Nothing was changed; try again.",
};

/** Plain words for a refused or failed action. Nothing was written when an action is refused. */
export function actionErrorMessage(code: string): string {
  return ACTION_ERROR[code] ?? "That didn't work. Nothing was changed; try again.";
}

const PLACEHOLDER_LABEL: Record<string, string> = {
  business: 'business name',
  name: 'first name',
  need: 'what they need',
  question: 'next question',
  slots: 'open times',
  slot: 'the time',
  summary: 'short summary',
};

/** "{slot} (the time)" for a placeholder in settings hints. */
export function placeholderLabel(placeholder: string): string {
  const words = PLACEHOLDER_LABEL[placeholder];
  return words ? `{${placeholder}} (${words})` : `{${placeholder}}`;
}

/** One template problem in plain words, from the shared rules the server enforces. */
export function templateProblemMessage(problem: TemplateProblem): string {
  switch (problem.code) {
    case 'unknown_template':
      return "This isn't a template the system sends.";
    case 'empty':
      return "This template can't be empty.";
    case 'missing_placeholder':
      return problem.placeholder === 'business'
        ? 'Keep your business name in this text, written out or as {business}.'
        : `Keep ${placeholderLabel(problem.placeholder)} in this text.`;
    case 'missing_opt_out':
      return `Keep the opt-out line: "${OPT_OUT_LINE}"`;
    case 'unknown_placeholder':
      return `{${problem.placeholder}} can't be filled in this template.`;
    case 'stray_brace':
      return 'A { or } here is not part of a placeholder and would be sent as typed.';
    case 'non_gsm':
      return `Replace ${problem.characters.join(' ')}: curly quotes and emoji make every text cost more. Use straight quotes and no emoji.`;
    case 'too_long':
      return `This runs to ${problem.segments} segments when sent; keep it to ${MAX_TEMPLATE_SEGMENTS}.`;
  }
}

/** "Nov 5, 2:10 PM" for when a settings version was saved. */
export function savedAtLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

const SETTINGS_ERROR: Record<string, string> = {
  stale_version:
    'These settings changed since you opened them, maybe from another device. The latest is shown; make your change again.',
  template_keys_changed:
    'The set of templates changed. The latest is shown; make your change again.',
  owner_only: 'Only the owner can change these settings.',
  minimum_data: 'This business does not use AI instructions.',
  version_breaks_rules:
    "That version no longer meets today's template rules, so it can't be made live. Edit the live version instead.",
  not_found: 'That version no longer exists. The latest is shown.',
  invalid_request: 'Some fields are too long or have too many lines. Shorten them and try again.',
  template_problems:
    'Some templates need a fix before they can be saved. See the notes below each one.',
  network: "We couldn't reach the server. Nothing was saved; try again.",
};

/** Plain words for a refused settings save or restore. Nothing was written when one is refused. */
export function settingsErrorMessage(code: string): string {
  return SETTINGS_ERROR[code] ?? "That didn't work. Nothing was saved; try again.";
}

/** "Waiting 25 min", "Waiting 3 h", "Waiting 2 days": how long a lead has waited on a person. */
export function waitingLabel(iso: string, now = new Date()): string {
  const minutes = Math.max(1, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `Waiting ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Waiting ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The tile's need line: the status in plain words, from what the server reported. */
export function needLine(card: LeadCard, timeZone: string): string {
  if (card.next.need === 'nudged') return 'Nudged. Waiting for a reply.';
  return statusLine(card, timeZone);
}

const GUIDANCE: Record<string, string> = {
  emergency: 'Call now.',
  safety_message_sent: 'The fixed safety message went out first. Call now.',
  crisis_message_sent:
    'A fixed crisis message pointing to 988 and 911 went out. Call as soon as you can.',
  reschedule:
    'Call to agree a new time, then move it on your calendar. Bookings are never moved automatically.',
  cancellation:
    'Call to confirm, then take it off your calendar. Nothing is cancelled automatically.',
  price_question: 'Prices only ever come from you. Call, or send one of your reply templates.',
  voicemail_to_review: "Listen to the voicemail and call back. It wasn't transcribed.",
  unsure: "We couldn't tell what they need. Listen to the voicemail, or call.",
  minor: 'They may be under 18. Call to check before booking anything.',
  not_english: 'Your templates are in English, so a call works best.',
  hold_expired: 'The held time lapsed before anyone approved it. Call to agree a time.',
  booking_failed:
    "The calendar event couldn't be made. Check your calendar connection, then call to confirm the time.",
  texting_not_live: "No text went out because texting wasn't live yet. Call them.",
  private_details: 'They shared private details. Call; nothing they wrote is repeated in a text.',
  complaint: "They're upset. A call works better than a text.",
  delivery_failed: "The text didn't arrive. Call instead.",
};

/** What to do about a lead that needs a person, in one sentence; null when there is no advice. */
export function guidanceFor(reason: string | null): string | null {
  return (reason && GUIDANCE[reason]) ?? null;
}

/** Ends text with one period, even when it already ends in an initial ("Next: Ben C."). */
export function sentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}
