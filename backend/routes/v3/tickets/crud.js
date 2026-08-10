/**
 * Tickets CRUD Routes
 * GET /tickets/:id — Get ticket with allowed transitions
 * PATCH /tickets/:id/status — Change ticket state (state machine validated)
 */

import ChainHandoffService from '../../../services/ChainHandoffService.js';
import QualityGateService from '../../../services/QualityGateService.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import {
  STATE_MAP, STATE_NAMES, TRANSITIONS,
  HUMAN_ONLY_STATES, SUPERVISOR_AGENT_IDS,
  resolveState, executeCascade,
} from './shared.js';
import { checkCompletionGate, formatGateError } from '../../../services/bdd/completionGate.js';

export default function registerCrudRoutes(router) {
  /**
   * PATCH /tickets/:id/status
   * Change ticket status with state machine validation.
   *
   * Body: { new_state: "review" | 24277, notes?: "reason" }
   * Response 200: { ticket_id, old_state, old_state_id, new_state, new_state_id, chain_id, updated_at }
   */
  router.patch('/tickets/:id/status', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) {
        return badRequest(res, 'Invalid ticket ID');
      }

      const { new_state, notes } = req.body;

      if (new_state === undefined || new_state === null) {
        return badRequest(res, 'new_state is required');
      }

      // 1. Resolve state name/ID
      const { stateId, error: stateError } = resolveState(new_state);
      if (stateError) {
        return error(res, 'INVALID_STATE', stateError, 400);
      }

      // 2. Fetch current ticket
      const ticket = await ChainHandoffService.getTicket(ticketId);
      if (!ticket) {
        return error(res, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found in tickets table`, 404);
      }

      const currentStateId = ticket.state;

      // 3. Validate transition
      const allowed = TRANSITIONS[currentStateId] || [];
      if (!allowed.includes(stateId)) {
        const fromName = STATE_NAMES[currentStateId] || String(currentStateId);
        const toName = STATE_NAMES[stateId] || String(stateId);
        const allowedNames = allowed.map(s => STATE_NAMES[s]).join(', ') || 'none';
        return error(res, 'INVALID_TRANSITION',
          `Cannot transition from '${fromName}' to '${toName}'. Allowed: ${allowedNames}`, 400);
      }

      // 4. Control gate: human OR supervisor can transition from 'control' state (ADR-109)
      if (HUMAN_ONLY_STATES.has(currentStateId)) {
        const userType = req.user.user_type || req.user.type || 'unknown';
        const isSupervisor = SUPERVISOR_AGENT_IDS.has(req.user.id);

        if (userType !== 'human' && !isSupervisor) {
          return error(res, 'CONTROL_GATE',
            `Only human users or supervisors can transition from '${STATE_NAMES[currentStateId]}'. ` +
            `Agent user_type='${userType}' (id=${req.user.id}) is not allowed.`, 403);
        }

        // ADR-109: Audit trail for supervisor bypass
        if (isSupervisor) {
          apiLogger.info({
            action: 'supervisor_bypass',
            agent_id: req.user.id,
            ticket_id: ticketId,
            from_state: STATE_NAMES[currentStateId],
            to_state: STATE_NAMES[stateId],
            notes: notes || '',
          }, 'Control Gate: Supervisor bypass activated (ADR-109)');

          // Log to Agent Activity table (1701)
          try {
            await ChainHandoffService.logActivity({
              action: 'supervisor_bypass',
              agent_id: req.user.id,
              ticket_id: ticketId,
              details: {
                from_state: STATE_NAMES[currentStateId],
                to_state: STATE_NAMES[stateId],
                notes,
              },
            });
          } catch (e) {
            apiLogger.warn({ err: e.message }, 'Failed to log supervisor bypass activity');
          }
        }
      }

      // 4b. ADR-0002 §8 Phase 3 (G4) — completion gate on transition → done.
      // Reject with 409 if any Must criterion is not yet `verified`. The gate
      // is a no-op for tickets without Must criteria (must_total === 0).
      if (stateId === STATE_MAP.done) {
        try {
          const gate = await checkCompletionGate(ticketId);
          if (!gate.ok) {
            apiLogger.info(
              { ticket_id: ticketId, must_total: gate.must_total, must_verified: gate.must_verified, blocker_count: gate.blockers.length },
              'ADR-0002 G4: completion gate blocked done transition'
            );
            const body = formatGateError(gate);
            return error(
              res,
              body.code,
              `Cannot transition to 'done' — ${gate.blockers.length} of ${gate.must_total} must-criteria are not verified`,
              409,
              { must_total: body.must_total, must_verified: body.must_verified, failed: body.failed }
            );
          }
        } catch (gateErr) {
          // Gate query failure is logged but does not block the transition —
          // we treat the gate as non-authoritative when its read fails.
          apiLogger.warn({ err: gateErr.message, ticket_id: ticketId }, 'completion gate query failed, allowing transition');
        }
      }

      // 5. Execute status update via ChainHandoffService
      const result = await ChainHandoffService.updateTicketStatus({
        ticket_id: ticketId,
        new_state: stateId,
        agent_id: req.user.id,
        notes: notes || '',
      });

      // 6. Execute cascade updates (Phase 1)
      const cascadeResults = await executeCascade({
        ticketId,
        oldState: currentStateId,
        newState: stateId,
        agentId: req.user.id,
        ticket,
      });

      // 7. ADR-109 Part C: Fire-and-forget quality gate on in_progress -> review
      if (currentStateId === STATE_MAP.in_progress && stateId === STATE_MAP.review) {
        QualityGateService.runQualityGate(ticketId, {
          agent_id: req.user.id,
          chain_id: ticket?._chain?.chain_id || null,
        }).catch(err => {
          apiLogger.error({ err, ticketId }, 'Tickets: Quality gate fire-and-forget failed');
        });
      }

      // 8. Return structured response
      return success(res, {
        ticket_id: result.ticket_id,
        old_state: STATE_NAMES[result.old_state] || String(result.old_state),
        old_state_id: result.old_state,
        new_state: STATE_NAMES[result.new_state] || String(result.new_state),
        new_state_id: result.new_state,
        chain_id: result.chain_id || null,
        cascade: cascadeResults.levels,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      apiLogger.error({ err, ticketId: req.params.id }, 'Tickets: Status update failed');
      if (err.message && err.message.includes('not found')) {
        return error(res, 'TICKET_NOT_FOUND', err.message, 404);
      }
      return error(res, 'STATUS_UPDATE_FAILED', err.message, 500);
    }
  });

  /**
   * GET /tickets/:id
   * Get ticket details with human-readable state and allowed transitions.
   */
  router.get('/tickets/:id', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) {
        return badRequest(res, 'Invalid ticket ID');
      }

      const ticket = await ChainHandoffService.getTicket(ticketId);
      if (!ticket) {
        return error(res, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found in tickets table`, 404);
      }

      const currentState = ticket.state;
      const allowedTransitions = (TRANSITIONS[currentState] || [])
        .map(s => ({ id: s, name: STATE_NAMES[s] || String(s) }));

      return success(res, {
        ...ticket,
        state_name: STATE_NAMES[currentState] || 'unknown',
        allowed_transitions: allowedTransitions,
      });
    } catch (err) {
      apiLogger.error({ err, ticketId: req.params.id }, 'Tickets: Fetch failed');
      return error(res, 'TICKET_FETCH_FAILED', err.message, 500);
    }
  });
}
