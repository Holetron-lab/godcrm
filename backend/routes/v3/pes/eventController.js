// PES Event Controller — CRM → PES event bridge

import { success, error, badRequest } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import * as pesBridge from '../../../services/pes/bridge.js';

// Valid CRM event types that PES understands
const VALID_EVENT_TYPES = [
  'ticket_created',      // New ticket → PES alert
  'ticket_resolved',     // Ticket resolved → PES happy
  'agent_completed',     // Agent finished job → PES fetch
  'agent_failed',        // Agent failed → PES concern
  'deployment_success',  // Deploy OK → PES celebrate
  'deployment_failed',   // Deploy failed → PES bug_detected
  'user_login',          // Owner logged in → PES greeting
  'user_logout',         // Owner left → PES lonely
  'error_spike',         // Error rate up → PES alert
  'custom',              // Custom event with data
];

export default function registerEventRoutes(router) {
  /**
   * POST /api/v3/pes/events
   * Push a CRM event for PES to consume
   */
  router.post('/events', async (req, res) => {
    try {
      const { type, data } = req.body;
      if (!type) return badRequest(res, 'Event type is required');
      if (!VALID_EVENT_TYPES.includes(type)) {
        return badRequest(res, `Invalid event type. Valid: ${VALID_EVENT_TYPES.join(', ')}`);
      }

      const pushed = pesBridge.pushEvent(type, {
        ...data,
        source: 'crm',
        userId: req.user?.id,
        userName: req.user?.name,
      });

      if (!pushed) {
        return error(res, 'PES_EVENT_FAILED', 'Failed to push event to PES', 500);
      }

      apiLogger.info({ type, userId: req.user?.id }, 'CRM event pushed to PES');
      return success(res, { pushed: true, type });
    } catch (err) {
      apiLogger.error({ err }, 'PES event push error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/events/pending
   * Get pending events (for PES polling)
   */
  router.get('/events/pending', async (req, res) => {
    try {
      const events = pesBridge.getPendingEvents();
      return success(res, events);
    } catch (err) {
      apiLogger.error({ err }, 'PES pending events error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * POST /api/v3/pes/events/consume
   * Mark events as consumed (PES calls this after processing)
   */
  router.post('/events/consume', async (req, res) => {
    try {
      const { eventIds } = req.body;
      if (!Array.isArray(eventIds) || eventIds.length === 0) {
        return badRequest(res, 'eventIds array is required');
      }
      pesBridge.consumeEvents(eventIds);
      return success(res, { consumed: eventIds.length });
    } catch (err) {
      apiLogger.error({ err }, 'PES consume events error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });
}
