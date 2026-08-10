// calendar/ticketLinkController.js — Ticket <-> Calendar event linking

import { Router } from 'express';
import {
  getConnectionStatus,
  createEvent,
  generateBaseId,
} from '../../../services/GoogleCalendarService.js';
import { dbGet, dbRun, safeJsonParse, sqlNow } from '../../../database/connection.js';
import {
  calLogger,
  DEFAULT_EVENTS_TABLE_ID,
  TICKETS_TABLE_ID,
  DEFAULT_STATE_BACKLOG,
  DEFAULT_TYPE_TASK,
  DEFAULT_PRIORITY_MEDIUM,
  respondSuccess,
  respondError,
} from './helpers.js';

const router = Router();

// =============================================================================
// TICKET <-> CALENDAR EVENT LINKING
// =============================================================================

/**
 * POST /api/v3/calendar/create-event-from-ticket
 * Create a Google Calendar event from a ticket and link them
 * Body: { ticketRowId, calendarId?, pushToGoogle? }
 */
router.post('/create-event-from-ticket', async (req, res) => {
  try {
    const { ticketRowId, calendarId, pushToGoogle } = req.body;
    if (!ticketRowId) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'ticketRowId is required');
    }

    // Get ticket data
    const ticketRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [ticketRowId, TICKETS_TABLE_ID]
    );
    if (!ticketRow) {
      return respondError(res, 404, 'NOT_FOUND', 'Ticket not found');
    }

    const ticketData = safeJsonParse(ticketRow.data) || {};

    // Build calendar event from ticket
    const startDate = ticketData.scheduled_date || ticketData.due_date || new Date().toISOString();
    const endDate = ticketData.due_date || new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString();

    const eventData = {
      title: `[Ticket] ${ticketData.what || 'Untitled'}`,
      description: [
        ticketData.why || '',
        ticketData.acceptance_criteria ? `\n\nAcceptance Criteria:\n${ticketData.acceptance_criteria}` : '',
        `\n\n---\nCRM Ticket #${ticketRowId}`,
      ].join(''),
      start_datetime: startDate,
      end_datetime: endDate,
      status: 'confirmed',
      calendar_id: calendarId || 'primary',
      sync_direction: 'crm_to_google',
      ticket_id: ticketRowId,
    };

    // Create event row in CRM
    const baseId = generateBaseId();
    const result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [DEFAULT_EVENTS_TABLE_ID, baseId, JSON.stringify(eventData), req.user.id]
    );
    const eventRowId = result.lastID || result.lastInsertRowid;

    // Push to Google Calendar if requested
    let googleEvent = null;
    if (pushToGoogle !== false) {
      try {
        const status = await getConnectionStatus(req.user.id);
        if (status.connected) {
          googleEvent = await createEvent(req.user.id, calendarId || 'primary', {
            title: eventData.title,
            description: eventData.description,
            start_datetime: eventData.start_datetime,
            end_datetime: eventData.end_datetime,
          });
          eventData.event_id = googleEvent.id;
          eventData.link = googleEvent.htmlLink || '';
          await dbRun(
            `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
            [JSON.stringify(eventData), eventRowId]
          );
        }
      } catch (pushErr) {
        calLogger.warn({ err: pushErr }, 'Failed to push event to Google (created in CRM only)');
      }
    }

    // Link: update ticket with calendar_event reference
    ticketData.calendar_event = eventRowId;
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(ticketData), ticketRowId]
    );

    calLogger.info({ ticketRowId, eventRowId, googleEventId: googleEvent?.id }, 'Created calendar event from ticket');

    return respondSuccess(res, {
      ticketRowId,
      eventRowId,
      eventData,
      googleEvent,
      linked: true,
    }, 201);
  } catch (err) {
    calLogger.error({ err }, 'Failed to create event from ticket');
    return respondError(res, 500, 'CREATE_FAILED', 'Failed to create event from ticket', err.message);
  }
});

/**
 * POST /api/v3/calendar/create-ticket-from-event
 * Create a ticket from a calendar event and link them
 * Body: { eventRowId, priority?, type?, state?, assigned_to?, tickets_table_id? }
 */
router.post('/create-ticket-from-event', async (req, res) => {
  try {
    const { eventRowId, priority, type, state, assigned_to, tickets_table_id } = req.body;
    if (!eventRowId) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'eventRowId is required');
    }

    const ticketsTableId = tickets_table_id || TICKETS_TABLE_ID;

    // Get calendar event data
    const eventRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [eventRowId, DEFAULT_EVENTS_TABLE_ID]
    );
    if (!eventRow) {
      return respondError(res, 404, 'NOT_FOUND', 'Calendar event not found');
    }

    const eventData = safeJsonParse(eventRow.data) || {};

    // Check if ticket already exists for this event
    if (eventData.ticket_id) {
      const existingTicket = await dbGet(
        'SELECT id FROM table_rows WHERE id = ? AND table_id = ?',
        [eventData.ticket_id, ticketsTableId]
      );
      if (existingTicket) {
        return respondError(res, 409, 'ALREADY_LINKED', 'This event already has a linked ticket', { ticketRowId: eventData.ticket_id });
      }
    }

    // Build ticket from event
    const ticketData = {
      what: eventData.title || 'Calendar Event',
      why: [
        eventData.description || '',
        `\n\n📅 From Google Calendar: ${eventData.calendar_name || eventData.calendar_id || ''}`,
        eventData.link ? `\n🔗 ${eventData.link}` : '',
      ].join(''),
      state: state || DEFAULT_STATE_BACKLOG,
      type: type || DEFAULT_TYPE_TASK,
      priority: priority || DEFAULT_PRIORITY_MEDIUM,
      assigned_to: assigned_to || null,
      scheduled_date: eventData.start_datetime || null,
      due_date: eventData.end_datetime || null,
      calendar_event: eventRowId,
    };

    // Create ticket row
    const baseId = generateBaseId();
    const result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [ticketsTableId, baseId, JSON.stringify(ticketData), req.user.id]
    );
    const ticketRowId = result.lastID || result.lastInsertRowid;

    // Link: update event with ticket reference
    eventData.ticket_id = ticketRowId;
    eventData.auto_ticket = false; // Manual creation
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(eventData), eventRowId]
    );

    calLogger.info({ eventRowId, ticketRowId }, 'Created ticket from calendar event');

    return respondSuccess(res, {
      eventRowId,
      ticketRowId,
      ticketData,
      linked: true,
    }, 201);
  } catch (err) {
    calLogger.error({ err }, 'Failed to create ticket from event');
    return respondError(res, 500, 'CREATE_FAILED', 'Failed to create ticket from event', err.message);
  }
});

/**
 * POST /api/v3/calendar/link
 * Manually link an existing ticket to an existing calendar event (bidirectional)
 * Body: { ticketRowId, eventRowId }
 */
router.post('/link', async (req, res) => {
  try {
    const { ticketRowId, eventRowId } = req.body;
    if (!ticketRowId || !eventRowId) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'Both ticketRowId and eventRowId are required');
    }

    // Update ticket with calendar event reference
    const ticketRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [ticketRowId, TICKETS_TABLE_ID]
    );
    if (!ticketRow) {
      return respondError(res, 404, 'NOT_FOUND', 'Ticket not found');
    }

    const ticketData = safeJsonParse(ticketRow.data) || {};
    ticketData.calendar_event = eventRowId;
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(ticketData), ticketRowId]
    );

    // Update event with ticket reference
    const eventRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [eventRowId, DEFAULT_EVENTS_TABLE_ID]
    );
    if (!eventRow) {
      return respondError(res, 404, 'NOT_FOUND', 'Calendar event not found');
    }

    const eventData = safeJsonParse(eventRow.data) || {};
    eventData.ticket_id = ticketRowId;
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(eventData), eventRowId]
    );

    calLogger.info({ ticketRowId, eventRowId }, 'Linked ticket to calendar event');

    return respondSuccess(res, { ticketRowId, eventRowId, linked: true });
  } catch (err) {
    calLogger.error({ err }, 'Failed to link ticket and event');
    return respondError(res, 500, 'LINK_FAILED', 'Failed to link ticket and event', err.message);
  }
});

/**
 * DELETE /api/v3/calendar/link
 * Unlink a ticket from a calendar event
 * Body: { ticketRowId, eventRowId }
 */
router.delete('/link', async (req, res) => {
  try {
    const { ticketRowId, eventRowId } = req.body;
    if (!ticketRowId || !eventRowId) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'Both ticketRowId and eventRowId are required');
    }

    // Remove calendar_event from ticket
    const ticketRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [ticketRowId, TICKETS_TABLE_ID]
    );
    if (ticketRow) {
      const ticketData = safeJsonParse(ticketRow.data) || {};
      delete ticketData.calendar_event;
      await dbRun(
        `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
        [JSON.stringify(ticketData), ticketRowId]
      );
    }

    // Remove ticket_id from event
    const eventRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [eventRowId, DEFAULT_EVENTS_TABLE_ID]
    );
    if (eventRow) {
      const eventData = safeJsonParse(eventRow.data) || {};
      delete eventData.ticket_id;
      eventData.auto_ticket = false;
      await dbRun(
        `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
        [JSON.stringify(eventData), eventRowId]
      );
    }

    return respondSuccess(res, { ticketRowId, eventRowId, unlinked: true });
  } catch (err) {
    calLogger.error({ err }, 'Failed to unlink ticket and event');
    return respondError(res, 500, 'UNLINK_FAILED', 'Failed to unlink', err.message);
  }
});

export default router;
