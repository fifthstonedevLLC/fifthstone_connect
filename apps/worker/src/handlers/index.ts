import type { JobHandler } from '../handler.js';
import { confirmCalendarEvent } from './confirm-calendar-event.js';
import { handleOfferReply } from './handle-offer-reply.js';
import { releaseHold } from './release-hold.js';
import { sendSlotOffer } from './send-slot-offer.js';
import { sendText } from './send-text.js';
import { syncCalendar } from './sync-calendar.js';

/**
 * Job types this worker runs. Other types stay queued until their handler exists: the worker
 * claims only these (`app.claim_jobs` with action types).
 */
export const HANDLERS: Record<string, JobHandler> = {
  confirm_calendar_event: confirmCalendarEvent,
  send_text: sendText,
  release_hold: releaseHold,
  sync_calendar: syncCalendar,
  send_slot_offer: sendSlotOffer,
  handle_offer_reply: handleOfferReply,
};
