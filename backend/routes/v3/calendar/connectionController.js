// calendar/connectionController.js — Connection/auth and calendars listing

import { Router } from 'express';
import {
  getAuthUrl,
  handleCallback,
  getConnectionStatus,
  disconnectCalendar,
  listCalendars,
} from '../../../services/GoogleCalendarService.js';
import { calLogger, respondSuccess, respondError } from './helpers.js';

const router = Router();

// =============================================================================
// CONNECTION / AUTH
// =============================================================================

/**
 * GET /api/v3/calendar/status
 * Check Google Calendar connection status for current user
 */
router.get('/status', async (req, res) => {
  try {
    const status = await getConnectionStatus(req.user.id);
    return respondSuccess(res, status);
  } catch (err) {
    calLogger.error({ err }, 'Failed to get calendar status');
    return respondError(res, 500, 'STATUS_FAILED', 'Failed to get calendar status', err.message);
  }
});

/**
 * GET /api/v3/calendar/connect
 * Generate URL for connecting Google Calendar
 * Query params: redirect_uri (optional)
 */
router.get('/connect', async (req, res) => {
  try {
    const url = getAuthUrl(req.user.id, req.query.redirect_uri);
    return respondSuccess(res, { url });
  } catch (err) {
    calLogger.error({ err }, 'Failed to generate connect URL');
    return respondError(res, 500, 'CONNECT_FAILED', 'Failed to generate connect URL', err.message);
  }
});

/**
 * POST /api/v3/calendar/callback
 * OAuth callback — exchange code for tokens and store account
 * Body: { code, redirect_uri? }
 */
router.post('/callback', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) {
      return respondError(res, 400, 'NO_CODE', 'Authorization code is required');
    }

    const result = await handleCallback(code, redirect_uri, req.user.id);
    calLogger.info({ userId: req.user.id }, 'Calendar account connected');

    // Get email and calendars for response
    let email = req.user.email;
    let calendars = [];
    try {
      calendars = await listCalendars(req.user.id);
    } catch (e) {
      calLogger.warn({ err: e }, 'Could not list calendars after connect');
    }

    return respondSuccess(res, { ...result, email, calendars });
  } catch (err) {
    calLogger.error({ err }, 'Calendar callback failed');
    return respondError(res, 500, 'CALLBACK_FAILED', 'Calendar callback failed', err.message);
  }
});

/**
 * POST /api/v3/calendar/disconnect
 * Disconnect Google Calendar for current user
 */
router.post('/disconnect', async (req, res) => {
  try {
    const result = disconnectCalendar(req.user.id);
    return respondSuccess(res, result);
  } catch (err) {
    calLogger.error({ err }, 'Failed to disconnect calendar');
    return respondError(res, 500, 'DISCONNECT_FAILED', 'Failed to disconnect calendar', err.message);
  }
});

// =============================================================================
// CALENDARS
// =============================================================================

/**
 * GET /api/v3/calendar/calendars
 * List all Google Calendars for current user
 */
router.get('/calendars', async (req, res) => {
  try {
    const status = await getConnectionStatus(req.user.id);
    if (!status.connected) {
      return respondError(res, 401, 'NOT_CONNECTED', 'Google Calendar is not connected. Please authorize first.');
    }

    const calendars = await listCalendars(req.user.id);
    return respondSuccess(res, calendars);
  } catch (err) {
    calLogger.error({ err }, 'Failed to get calendar list');
    return respondError(res, 500, 'FETCH_FAILED', 'Failed to get calendar list', err.message);
  }
});

export default router;
