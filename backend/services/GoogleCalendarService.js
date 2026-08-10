/**
 * GoogleCalendarService — thin wrapper (ADR-119)
 *
 * All logic has been split into modules under ./google-calendar/.
 * This file re-exports everything to maintain backward compatibility.
 */

export { generateBaseId } from './google-calendar/helpers.js';

export {
  getAuthUrl,
  handleCallback,
  getOAuth2Client,
  getConnectionStatus,
  disconnectCalendar,
} from './google-calendar/auth.js';

export {
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  mapGoogleEventToCrm,
  mapCrmToGoogleEvent,
} from './google-calendar/operations.js';

export {
  syncFromGoogle,
  syncToGoogle,
  fullSync,
  syncAllAccounts,
} from './google-calendar/sync.js';

export { default } from './google-calendar/index.js';
