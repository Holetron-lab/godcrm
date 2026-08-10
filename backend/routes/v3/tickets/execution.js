/**
 * Tickets Execution Routes
 * POST /tickets/:id/message — Send message in ticket's bound chat
 * POST /tickets/:id/invoke-agent — Invoke assigned agent to work on ticket (ADR-077 Task #12)
 */

import ChainHandoffService from '../../../services/ChainHandoffService.js';
import { success, created, error, badRequest } from '../../../utils/response.js';
import { dbGet, dbRun, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { resolveAgentUser } from '../../../services/agent-users.js';
import { createAndDispatchJob } from '../../../services/AgentJobService.js';
import {
  STATE_MAP, TRANSITIONS, TICKETS_TABLE_ID,
  parseStatusDirective,
} from './shared.js';

export default function registerExecutionRoutes(router) {
  /**
   * POST /tickets/:id/message
   * Send a message in the ticket's bound row conversation.
   *
   * Body: { content }
   * Returns: { message_id, conversation_id }
   */
  router.post('/tickets/:id/message', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) {
        return badRequest(res, 'Invalid ticket ID');
      }

      const { content } = req.body;
      if (!content || !content.trim()) {
        return badRequest(res, 'content is required');
      }

      // Verify ticket exists
      const ticket = await ChainHandoffService.getTicket(ticketId);
      if (!ticket) {
        return error(res, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`, 404);
      }

      // Find or create bound conversation
      let conversation = await dbGet(
        isPostgres()
          ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2 LIMIT 1`
          : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ? LIMIT 1`,
        [TICKETS_TABLE_ID, ticketId]
      );

      let conversationId;
      if (conversation) {
        conversationId = conversation.id;
      } else {
        // Create bound conversation
        const convResult = await dbRun(
          isPostgres()
            ? `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
               VALUES ($1, 'row', $2, $3, $4, NOW(), NOW()) RETURNING id`
            : `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
               VALUES (?, 'row', ?, ?, ?, datetime('now'), datetime('now'))`,
          [`Ticket #${ticketId}: ${(ticket.what || '').substring(0, 60)}`, TICKETS_TABLE_ID, ticketId, req.user.id]
        );
        conversationId = convResult?.lastInsertRowid || convResult?.rows?.[0]?.id;
      }

      // Insert message
      const msgResult = await dbRun(
        isPostgres()
          ? `INSERT INTO messages (conversation_id, sender_id, content, created_at)
             VALUES ($1, $2, $3, NOW()) RETURNING id`
          : `INSERT INTO messages (conversation_id, sender_id, content, created_at)
             VALUES (?, ?, ?, datetime('now'))`,
        [conversationId, req.user.id, content.trim()]
      );

      const messageId = msgResult?.lastInsertRowid || msgResult?.rows?.[0]?.id;

      // ADR-077 Task #7: Auto-update ticket status when agent writes status directive
      let autoStatusUpdate;
      const directive = parseStatusDirective(content.trim());
      if (directive) {
        const targetStateId = STATE_MAP[directive.targetState];
        const currentStateId = ticket.state;
        const allowed = TRANSITIONS[currentStateId] || [];

        if (targetStateId && allowed.includes(targetStateId)) {
          try {
            await ChainHandoffService.updateTicketStatus({
              ticket_id: ticketId,
              new_state: targetStateId,
              agent_id: req.user.id,
              notes: `Auto-updated from message status directive: ${directive.rawStatus}`,
            });
            autoStatusUpdate = {
              new_state: directive.targetState,
              new_state_id: targetStateId,
              raw_status: directive.rawStatus,
            };
            apiLogger.info({ ticketId, directive, targetStateId }, 'Tickets: Auto-status-update from message directive');
          } catch (updateErr) {
            apiLogger.warn({ err: updateErr, ticketId, directive }, 'Tickets: Auto-status-update failed (non-fatal)');
          }
        }
      }

      const responseData = {
        message_id: messageId,
        conversation_id: conversationId,
        ticket_id: ticketId,
      };
      if (autoStatusUpdate) {
        responseData.auto_status_update = autoStatusUpdate;
      }

      return created(res, responseData);
    } catch (err) {
      apiLogger.error({ err, ticketId: req.params.id }, 'Tickets: Message send failed');
      return error(res, 'MESSAGE_SEND_FAILED', err.message, 500);
    }
  });

  /**
   * POST /tickets/:id/invoke-agent
   * Invoke the assigned agent to work on a ticket (ADR-077 Task #12).
   *
   * This bridges ticket dispatch and agent execution:
   * 1. Looks up the ticket and its assigned agent
   * 2. Resolves the agent user (for job dispatch)
   * 3. Finds or creates a bound conversation for the ticket
   * 4. Dispatches an async agent job via AgentJobService
   * 5. Optionally transitions ticket from backlog → in_progress
   *
   * Body: { message?: string }
   * Returns: { job_id, conversation_id, agent_name, ticket_id }
   */
  router.post('/tickets/:id/invoke-agent', async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) {
        return badRequest(res, 'Invalid ticket ID');
      }

      // 1. Fetch ticket
      const ticket = await ChainHandoffService.getTicket(ticketId);
      if (!ticket) {
        return error(res, 'TICKET_NOT_FOUND', `Ticket ${ticketId} not found`, 404);
      }

      // 2. Validate state — cannot invoke on terminal ticket
      if (ticket.state === STATE_MAP.done) {
        return error(res, 'TICKET_TERMINAL', 'Cannot invoke agent on a completed ticket', 400);
      }

      // 3. Validate assigned agent
      if (!ticket.assigned_to) {
        return badRequest(res, 'Ticket has no assigned_to agent. Dispatch the ticket first.');
      }

      // 4. Resolve agent user
      const agent = await resolveAgentUser(ticket.assigned_to);
      if (!agent) {
        return error(res, 'AGENT_NOT_FOUND', `Cannot resolve agent for assigned_to=${ticket.assigned_to}`, 400);
      }

      // 5. Find or create bound conversation
      let conversationId;
      const existingConv = await dbGet(
        isPostgres()
          ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2 LIMIT 1`
          : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ? LIMIT 1`,
        [TICKETS_TABLE_ID, ticketId]
      );

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const convResult = await dbRun(
          isPostgres()
            ? `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
               VALUES ($1, 'row', $2, $3, $4, NOW(), NOW()) RETURNING id`
            : `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
               VALUES (?, 'row', ?, ?, ?, datetime('now'), datetime('now'))`,
          [`Ticket #${ticketId}: ${(ticket.what || '').substring(0, 60)}`, TICKETS_TABLE_ID, ticketId, req.user.id]
        );
        conversationId = convResult?.lastInsertRowid || convResult?.rows?.[0]?.id;
      }

      // 6. Build message content
      const { message } = req.body;
      const messageContent = message || `${ticket.what || 'Work on this ticket'}${ticket.acceptance_criteria ? `\n\nAcceptance Criteria:\n${ticket.acceptance_criteria}` : ''}`;

      // 7. Auto-transition backlog → in_progress
      if (ticket.state === STATE_MAP.backlog || ticket.state === STATE_MAP.assigned) {
        try {
          await ChainHandoffService.updateTicketStatus({
            ticket_id: ticketId,
            new_state: STATE_MAP.in_progress,
            agent_id: req.user.id,
            notes: 'Auto-transitioned by invoke-agent',
          });
        } catch (transitionErr) {
          apiLogger.warn({ err: transitionErr, ticketId }, 'Tickets: Auto-transition failed during invoke-agent (non-fatal)');
        }
      }

      // 8. Dispatch agent job
      const job = await createAndDispatchJob({
        conversationId,
        agent,
        triggeredByUserId: req.user.id,
        messageContent,
        options: { agent_mode: 'agent' },
        ticketId,
      });

      apiLogger.info({
        ticketId,
        conversationId,
        agentName: agent.name,
        jobId: job.jobId,
      }, 'Tickets: Agent invoked for ticket');

      return success(res, {
        job_id: job.jobId,
        conversation_id: conversationId,
        agent_name: agent.name,
        ticket_id: ticketId,
      });
    } catch (err) {
      apiLogger.error({ err, ticketId: req.params.id }, 'Tickets: Invoke agent failed');
      return error(res, 'INVOKE_AGENT_FAILED', err.message, 500);
    }
  });
}
