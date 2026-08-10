/**
 * Google Calendar — CRUD Operations & Event Mapping
 *
 * listCalendars, listEvents, createEvent, updateEvent, deleteEvent,
 * mapGoogleEventToCrm, mapCrmToGoogleEvent
 */

import { google } from 'googleapis';
import { apiLogger } from '../../utils/logger.js';
import { getOAuth2Client } from './auth.js';

// ---------------------------------------------------------------------------
// Calendar Operations
// ---------------------------------------------------------------------------

export async function listCalendars(userId) {
  const auth = await getOAuth2Client(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.calendarList.list();
  return res.data.items || [];
}

export async function listEvents(userId, calendarId, timeMin, timeMax, maxResults) {
  const auth = await getOAuth2Client(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const params = {
    calendarId: calendarId || 'primary',
    singleEvents: true,
    orderBy: 'startTime',
  };

  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;
  if (maxResults) params.maxResults = maxResults;

  const res = await calendar.events.list(params);
  return res.data.items || [];
}

export async function createEvent(userId, calendarId, eventData) {
  const auth = await getOAuth2Client(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = mapCrmToGoogleEvent(eventData);

  const res = await calendar.events.insert({
    calendarId: calendarId || 'primary',
    requestBody: event,
  });

  apiLogger.info(`Created Google Calendar event ${res.data.id} for user ${userId}`);
  return res.data;
}

export async function updateEvent(userId, calendarId, eventId, eventData) {
  const auth = await getOAuth2Client(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = mapCrmToGoogleEvent(eventData);

  const res = await calendar.events.update({
    calendarId: calendarId || 'primary',
    eventId,
    requestBody: event,
  });

  apiLogger.info(`Updated Google Calendar event ${eventId} for user ${userId}`);
  return res.data;
}

export async function deleteEvent(userId, calendarId, eventId) {
  const auth = await getOAuth2Client(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.delete({
    calendarId: calendarId || 'primary',
    eventId,
  });

  apiLogger.info(`Deleted Google Calendar event ${eventId} for user ${userId}`);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Event Data Mapping
// ---------------------------------------------------------------------------

export function mapGoogleEventToCrm(event, calendarId, calendarSummary) {
  return {
    event_id: event.id,
    title: event.summary || '',
    description: event.description || '',
    start_datetime: (event.start && (event.start.dateTime || event.start.date)) || '',
    end_datetime: (event.end && (event.end.dateTime || event.end.date)) || '',
    location: event.location || '',
    attendees: event.attendees ? event.attendees.map(a => a.email).join(', ') : '',
    organizer: event.organizer ? event.organizer.email : '',
    status: event.status || '',
    link: event.htmlLink || '',
    color: event.colorId || '',
    calendar_id: calendarId,
    calendar_name: calendarSummary || '',
  };
}

export function mapCrmToGoogleEvent(data) {
  const event = {};

  if (data.title) {
    event.summary = data.title;
  }
  if (data.description) {
    event.description = data.description;
  }
  if (data.location) {
    event.location = data.location;
  }

  if (data.start_datetime) {
    // Check if it is a date-only value (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.start_datetime)) {
      event.start = { date: data.start_datetime };
    } else {
      event.start = {
        dateTime: data.start_datetime,
        timeZone: data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
  }

  if (data.end_datetime) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(data.end_datetime)) {
      event.end = { date: data.end_datetime };
    } else {
      event.end = {
        dateTime: data.end_datetime,
        timeZone: data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
  }

  if (data.attendees) {
    const emails = data.attendees.split(',').map(e => e.trim()).filter(Boolean);
    event.attendees = emails.map(email => ({ email }));
  }

  return event;
}
