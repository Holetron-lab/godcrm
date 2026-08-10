/**
 * Google Calendar — barrel re-export
 *
 * Maintains backward compatibility: any import from the old
 * GoogleCalendarService.js will resolve to the same named exports.
 */

export { generateBaseId } from './helpers.js';
export { getAuthUrl, handleCallback, getOAuth2Client, getConnectionStatus, disconnectCalendar } from './auth.js';
export { listCalendars, listEvents, createEvent, updateEvent, deleteEvent, mapGoogleEventToCrm, mapCrmToGoogleEvent } from './operations.js';
export { syncFromGoogle, syncToGoogle, fullSync, syncAllAccounts } from './sync.js';

// Default export for `import GoogleCalendarService from '...'` style
import { getAuthUrl, handleCallback, getOAuth2Client, getConnectionStatus, disconnectCalendar } from './auth.js';
import { listCalendars, listEvents, createEvent, updateEvent, deleteEvent } from './operations.js';
import { syncFromGoogle, syncToGoogle, fullSync, syncAllAccounts } from './sync.js';

export default {
  getAuthUrl,
  handleCallback,
  getOAuth2Client,
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  syncFromGoogle,
  syncToGoogle,
  fullSync,
  syncAllAccounts,
  getConnectionStatus,
  disconnectCalendar,
};
