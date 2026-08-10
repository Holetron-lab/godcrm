/**
 * Tickets Dispatch Routes
 * POST /tickets/dispatch — Dispatch single subtask
 * POST /tickets/dispatch-chain — Dispatch batch of linked subtasks
 */

import ChainHandoffService from '../../../services/ChainHandoffService.js';
import { success, created, error, badRequest } from '../../../utils/response.js';
import { dbGet, dbRun, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { STATE_MAP, TICKETS_TABLE_ID } from './shared.js';

export default function registerDispatchRoutes(router) {
  /**
   * POST /tickets/dispatch
   * Dispatch a single subtask to a specialist agent.
   *
   * Body: { what, why?, assigned_to, acceptance_criteria?, phase?, priority?, adr_ref? }
   * Returns: { ticket_id, chain_id, conversation_id? }
   */
  router.post('/tickets/dispatch', async (req, res) => {
    try {
      const {
        what,
        why,
        assigned_to,
        acceptance_criteria,
        phase,
        priority,
        type,
        adr_ref,
        chain_id,
        parent_ticket_id,
        step,
        parent_document_id,
      } = req.body;

      if (!what) {
        return badRequest(res, 'what is required (task description)');
      }
      if (!assigned_to) {
        return badRequest(res, 'assigned_to is required (agent user ID or name)');
      }

      // Resolve agent name → ID if string
      let agentId = assigned_to;
      if (typeof assigned_to === 'string') {
        agentId = ChainHandoffService.resolveAgentId(assigned_to);
        if (!agentId) {
          return badRequest(res, `Unknown agent: '${assigned_to}'`);
        }
      }

      const result = await ChainHandoffService.dispatchSubtask({
        what,
        why: why || '',
        assigned_to: agentId,
        acceptance_criteria: acceptance_criteria || '',
        priority,
        type,
        chain_id,
        parent_ticket_id,
        step,
        dispatched_by: req.user.id,
        parent_document_id,
      });

      // Attempt to create bound row conversation (ticket chat)
      let conversationId = null;
      try {
        const existingConv = await dbGet(
          isPostgres()
            ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2 LIMIT 1`
            : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ? LIMIT 1`,
          [TICKETS_TABLE_ID, result.ticket_id]
        );

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          // Create conversation bound to ticket
          const convResult = await dbRun(
            isPostgres()
              ? `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
                 VALUES ($1, 'row', $2, $3, $4, NOW(), NOW()) RETURNING id`
              : `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
                 VALUES (?, 'row', ?, ?, ?, datetime('now'), datetime('now'))`,
            [`Ticket #${result.ticket_id}: ${what.substring(0, 60)}`, TICKETS_TABLE_ID, result.ticket_id, req.user.id]
          );
          conversationId = convResult?.lastInsertRowid || convResult?.rows?.[0]?.id;
        }

        // Send first message in ticket chat
        if (conversationId) {
          const messageContent = `Task dispatched by @orchestrator:\n\n**${what}**\n\n${why ? `**Why**: ${why}\n\n` : ''}${acceptance_criteria ? `**Acceptance Criteria**:\n${acceptance_criteria}\n\n` : ''}Assigned to agent ID: ${agentId}`;

          await dbRun(
            isPostgres()
              ? `INSERT INTO messages (conversation_id, user_id, content, created_at)
                 VALUES ($1, $2, $3, NOW())`
              : `INSERT INTO messages (conversation_id, user_id, content, created_at)
                 VALUES (?, ?, ?, datetime('now'))`,
            [conversationId, req.user.id, messageContent]
          );
        }
      } catch (chatErr) {
        // Don't fail dispatch if chat creation fails
        apiLogger.warn({ err: chatErr, ticketId: result.ticket_id }, 'Tickets: Failed to create ticket chat');
      }

      return created(res, {
        ticket_id: result.ticket_id,
        chain_id: result.chain_id,
        step: result.step,
        state: 'backlog',
        state_id: STATE_MAP.backlog,
        assigned_to: agentId,
        conversation_id: conversationId,
      });
    } catch (err) {
      apiLogger.error({ err }, 'Tickets: Dispatch failed');
      return error(res, 'DISPATCH_FAILED', err.message, 500);
    }
  });

  /**
   * POST /tickets/dispatch-chain
   * Dispatch multiple linked subtasks at once.
   *
   * Body: { tasks: [...], chain_id?, parent_ticket_id? }
   * Returns: { chain_id, tickets: [...] }
   */
  router.post('/tickets/dispatch-chain', async (req, res) => {
    try {
      const { tasks, chain_id, parent_ticket_id, parent_document_id } = req.body;

      if (!Array.isArray(tasks) || tasks.length === 0) {
        return badRequest(res, 'tasks array is required with at least one task');
      }

      // Resolve agent names in tasks. Per-task `parent_document_id` wins over
      // the chain-level default so callers can override on a single task.
      const resolvedTasks = tasks.map((task, idx) => {
        let agentId = task.assigned_to;
        if (typeof agentId === 'string') {
          agentId = ChainHandoffService.resolveAgentId(agentId);
          if (!agentId) {
            throw new Error(`Unknown agent '${task.assigned_to}' in task ${idx + 1}`);
          }
        }
        const effectiveParentDocId =
          task.parent_document_id != null ? task.parent_document_id : parent_document_id;
        return {
          ...task,
          assigned_to: agentId,
          ...(effectiveParentDocId != null ? { parent_document_id: effectiveParentDocId } : {}),
        };
      });

      const result = await ChainHandoffService.dispatchChain({
        tasks: resolvedTasks,
        chain_id,
        parent_ticket_id,
        dispatched_by: req.user.id,
      });

      return created(res, {
        chain_id: result.chain_id,
        parent_ticket_id: result.parent_ticket_id,
        task_count: result.task_count,
        tickets: result.tasks.map(t => ({
          ticket_id: t.ticket_id,
          chain_id: t.chain_id,
          step: t.step,
          state: 'backlog',
          assigned_to: t.assigned_to,
          what: t.what,
        })),
      });
    } catch (err) {
      apiLogger.error({ err }, 'Tickets: Dispatch chain failed');
      if (err.message.includes('Unknown agent')) {
        return badRequest(res, err.message);
      }
      return error(res, 'DISPATCH_CHAIN_FAILED', err.message, 500);
    }
  });
}
