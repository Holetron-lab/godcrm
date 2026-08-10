// calendar/helpers.js — Shared helpers and constants for calendar routes

import { logger } from '../../../utils/logger.js';

export const calLogger = logger.child({ module: 'calendar-routes' });

// Default events table ID (google_calendar_events in space 37)
export const DEFAULT_EVENTS_TABLE_ID = 2671;
// Tickets table ID (Development space)
export const TICKETS_TABLE_ID = 1708;
// Ticket defaults
export const DEFAULT_STATE_BACKLOG = 24275;
export const DEFAULT_TYPE_TASK = 24269;
export const DEFAULT_PRIORITY_MEDIUM = 24272;

export function respondSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
}

export function respondError(res, status, code, message, details) {
  return res.status(status).json({ success: false, error: { code, message, details }, timestamp: new Date().toISOString() });
}
