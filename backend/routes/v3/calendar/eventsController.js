// calendar/eventsController.js — Events CRUD (list, create, update, push, delete)

import { Router } from 'express';
import {
  getConnectionStatus,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  syncToGoogle,
  generateBaseId,
} from '../../../services/GoogleCalendarService.js';
import { dbGet, dbRun, dbAll, safeJsonParse, sqlNow } from '../../../database/connection.js';
import { calLogger, DEFAULT_EVENTS_TABLE_ID, respondSuccess, respondError } from './helpers.js';

const router = Router();

// =============================================================================
// EVENTS
// =============================================================================

/**
 * GET /api/v3/calendar/events
 * Get events from Google Calendar (or from CRM table)
 * Query params: calendarId, startDate, endDate, source (google|crm), maxResults
 */
router.get('/events', async (req, res) => {
  try {
    const { calendarId, startDate, endDate, source, maxResults } = req.query;

    if (source === 'crm') {
      // Fetch from CRM table
      const tableId = req.query.tableId || DEFAULT_EVENTS_TABLE_ID;
      let query = 'SELECT id, data, created_at, updated_at FROM table_rows WHERE table_id = ?';
      const params = [tableId];

      const rows = await dbAll(query, params);
      const events = rows.map(row => {
        const data = safeJsonParse(row.data) || {};
        return { id: row.id, ...data, _crm_created_at: row.created_at, _crm_updated_at: row.updated_at };
      });

      // Filter by date range if provided
      let filtered = events;
      if (startDate) {
        filtered = filtered.filter(e => e.start_datetime >= startDate);
      }
      if (endDate) {
        filtered = filtered.filter(e => e.start_datetime <= endDate);
      }
      if (calendarId) {
        filtered = filtered.filter(e => e.calendar_id === calendarId);
      }

      return respondSuccess(res, filtered);
    }

    // Fetch from Google Calendar API directly
    const status = await getConnectionStatus(req.user.id);
    if (!status.connected) {
      return respondError(res, 401, 'NOT_CONNECTED', 'Google Calendar is not connected. Please authorize first.');
    }

    const events = await listEvents(
      req.user.id,
      calendarId || 'primary',
      startDate,
      endDate,
      maxResults ? parseInt(maxResults) : undefined
    );

    return respondSuccess(res, events);
  } catch (err) {
    calLogger.error({ err }, 'Failed to get events');
    return respondError(res, 500, 'FETCH_FAILED', 'Failed to get events', err.message);
  }
});

/**
 * POST /api/v3/calendar/events
 * Create event in CRM and optionally push to Google Calendar
 * Body: { title, start_datetime, end_datetime, ..., calendarId?, pushToGoogle?: boolean }
 */
router.post('/events', async (req, res) => {
  try {
    const { pushToGoogle: shouldPush, calendarId, ...eventData } = req.body;

    if (!eventData.title) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'title is required');
    }
    if (!eventData.start_datetime) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'start_datetime is required');
    }

    // Store in CRM table first
    const tableId = req.body.tableId || DEFAULT_EVENTS_TABLE_ID;
    const baseId = generateBaseId();
    const crmData = {
      ...eventData,
      calendar_id: calendarId || 'primary',
      sync_direction: shouldPush ? 'crm_to_google' : 'google_to_crm',
    };

    const result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [tableId, baseId, JSON.stringify(crmData), req.user.id]
    );

    const rowId = result.lastID || result.lastInsertRowid;

    // Optionally push to Google Calendar
    let googleEvent = null;
    if (shouldPush) {
      try {
        const status = await getConnectionStatus(req.user.id);
        if (status.connected) {
          googleEvent = await createEvent(req.user.id, calendarId || 'primary', eventData);
          // Update CRM row with Google event_id
          crmData.event_id = googleEvent.id;
          crmData.link = googleEvent.htmlLink || '';
          await dbRun(
            `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
            [JSON.stringify(crmData), rowId]
          );
        }
      } catch (pushErr) {
        calLogger.warn({ err: pushErr }, 'Failed to push event to Google (created in CRM only)');
      }
    }

    return respondSuccess(res, {
      id: rowId,
      ...crmData,
      googleEvent,
    }, 201);
  } catch (err) {
    calLogger.error({ err }, 'Failed to create event');
    return respondError(res, 500, 'CREATE_FAILED', 'Failed to create event', err.message);
  }
});

/**
 * PUT /api/v3/calendar/events/:id
 * Update event in CRM and optionally push to Google Calendar
 */
router.put('/events/:id', async (req, res) => {
  try {
    const rowId = parseInt(req.params.id);
    const tableId = req.body.tableId || DEFAULT_EVENTS_TABLE_ID;
    const { pushToGoogle: shouldPush, ...updates } = req.body;

    // Get existing row
    const row = await dbGet('SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?', [rowId, tableId]);
    if (!row) {
      return respondError(res, 404, 'NOT_FOUND', 'Event not found');
    }

    const existingData = safeJsonParse(row.data) || {};
    const mergedData = { ...existingData, ...updates };

    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(mergedData), rowId]
    );

    // Push to Google if requested and has event_id
    if (shouldPush && mergedData.event_id) {
      try {
        const calendarId = mergedData.calendar_id || 'primary';
        await updateEvent(req.user.id, calendarId, mergedData.event_id, mergedData);
      } catch (pushErr) {
        calLogger.warn({ err: pushErr }, 'Failed to push update to Google');
      }
    }

    return respondSuccess(res, { id: rowId, ...mergedData });
  } catch (err) {
    calLogger.error({ err }, 'Failed to update event');
    return respondError(res, 500, 'UPDATE_FAILED', 'Failed to update event', err.message);
  }
});

/**
 * POST /api/v3/calendar/events/:id/push
 * Push a CRM event to Google Calendar
 */
router.post('/events/:id/push', async (req, res) => {
  try {
    const rowId = parseInt(req.params.id);
    const tableId = req.query.tableId || DEFAULT_EVENTS_TABLE_ID;

    const result = await syncToGoogle(req.user.id, tableId, rowId);
    return respondSuccess(res, result);
  } catch (err) {
    calLogger.error({ err }, 'Failed to push event to Google');
    return respondError(res, 500, 'PUSH_FAILED', 'Failed to push event to Google', err.message);
  }
});

/**
 * DELETE /api/v3/calendar/events/:id
 * Delete event from CRM and optionally from Google Calendar
 * Query params: deleteFromGoogle=true (optional)
 */
router.delete('/events/:id', async (req, res) => {
  try {
    const rowId = parseInt(req.params.id);
    const tableId = req.query.tableId || DEFAULT_EVENTS_TABLE_ID;

    if (req.query.deleteFromGoogle === 'true') {
      try {
        const row = await dbGet('SELECT data FROM table_rows WHERE id = ? AND table_id = ?', [rowId, tableId]);
        if (row) {
          const data = safeJsonParse(row.data) || {};
          if (data.event_id) {
            await deleteEvent(req.user.id, data.calendar_id || 'primary', data.event_id);
          }
        }
      } catch (err) {
        calLogger.warn({ err }, 'Failed to delete from Google (will still delete from CRM)');
      }
    }

    await dbRun('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [rowId, tableId]);
    return respondSuccess(res, { message: 'Event deleted' });
  } catch (err) {
    calLogger.error({ err }, 'Failed to delete event');
    return respondError(res, 500, 'DELETE_FAILED', 'Failed to delete event', err.message);
  }
});

export default router;
