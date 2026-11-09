import type { JobHandler } from '../handler.js';
import { sendApprovalRequest, sendApproverText } from './approver-texts.js';
import { confirmCalendarEvent } from './confirm-calendar-event.js';
import { handleOfferReply } from './handle-offer-reply.js';
import { releaseHold } from './release-hold.js';
import { sendSlotOffer } from './send-slot-offer.js';
import { sendText } from './send-text.js';
import { sendTextBack } from './send-text-back.js';
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
  send_text_back: sendTextBack,
  send_approval_request: sendApprovalRequest,
  send_approver_text: sendApproverText,
};
