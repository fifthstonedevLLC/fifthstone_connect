/**
 * Calendars a business can connect. Google and Microsoft (Outlook / Microsoft 365) are general
 * calendars; Acuity is a booking calendar. Zod-free so the portal can name them without loading
 * the validation library. Matches the check on `app.calendar_connections.provider`.
 */

export const CALENDAR_PROVIDERS = ['google', 'microsoft', 'acuity'] as const;

export type CalendarProviderKey = (typeof CALENDAR_PROVIDERS)[number];

export const CALENDAR_PROVIDER_NAMES: Record<CalendarProviderKey, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook',
  acuity: 'Acuity Scheduling',
};
