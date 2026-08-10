/**
 * Ticket / Orchestration Tool Handlers (ADR-098, ADR-101)
 *
 * Handles: dispatch_task, update_ticket_status, send_ticket_message,
 *          get_chain_status, get_my_tasks, supervisor_decide
 */

import { aiLogger } from '../../utils/logger.js';

/**
 * Ticket tool handlers
 */
export const ticketToolHandlers = {
  // === TICKET / ORCHESTRATION (ADR-098) ===
  async dispatch_task({ what, why, assigned_to, acceptance_criteria, priority, chain_id, parent_ticket_id, execute_immediately }, userId) {
    try {
      const { default: ChainHandoffService } = await import('../ChainHandoffService.js');

      let agentId = assigned_to;
      if (typeof assigned_to === 'string') {
        agentId = ChainHandoffService.resolveAgentId(assigned_to);
        if (!agentId) {
          return { error: `Unknown agent: '${assigned_to}'. Valid: architect, developer, developer-ralph, frontend, frontend-qa, n, nikich` };
        }
      }

      const result = await ChainHandoffService.dispatchSubtask({
        what,
        why: why || '',
        assigned_to: agentId,
        acceptance_criteria: acceptance_criteria || '',
        priority,
        chain_id,
        parent_ticket_id,
        dispatched_by: userId || 1,
      });

      // ADR-104: Optionally trigger immediate execution via AgentWorkerService
      if (execute_immediately && result.ticket_id) {
        try {
          const { AgentWorkerService } = await import('../AgentWorkerService.js');
          const ticketRow = { id: result.ticket_id, data: JSON.stringify(result.data) };
          AgentWorkerService.executeTicket(ticketRow).catch(err => {
            aiLogger.error({ err, ticket_id: result.ticket_id }, 'ADR-104: Immediate execution failed (non-blocking)');
          });
        } catch (workerErr) {
          aiLogger.warn({ err: workerErr }, 'ADR-104: AgentWorkerService not available for immediate execution');
        }
      }

      return {
        success: true,
        ticket_id: result.ticket_id,
        chain_id: result.chain_id,
        step: result.step,
        state: 'backlog',
        assigned_to: agentId,
        message: `Task dispatched: "${what}" → agent ${assigned_to}${execute_immediately ? ' (immediate execution)' : ''}`
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async update_ticket_status({ ticket_id, new_state, notes }, userId) {
    try {
      const { default: ChainHandoffService } = await import('../ChainHandoffService.js');

      const result = await ChainHandoffService.updateTicketStatus({
        ticket_id,
        new_state: typeof new_state === 'string'
          ? ChainHandoffService.STATE[new_state.toUpperCase()] || parseInt(new_state, 10)
          : new_state,
        agent_id: userId || 1,
        notes: notes || '',
      });

      return {
        success: true,
        ticket_id: result.ticket_id,
        old_state: result.old_state,
        new_state: result.new_state,
        chain_id: result.chain_id,
        message: `Ticket #${ticket_id} status updated`
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async send_ticket_message({ ticket_id, content }, userId) {
    try {
      const TICKETS_TABLE_ID = 1708;
      const { default: ChainHandoffService } = await import('../ChainHandoffService.js');

      // Verify ticket exists
      const ticket = await ChainHandoffService.getTicket(ticket_id);
      if (!ticket) return { error: `Ticket ${ticket_id} not found` };

      // Find or create bound conversation
      const { dbGet: g, dbRun: r, isPostgres: pg } = await import('../../database/connection.js');
      let conv = await g(
        pg() ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2 LIMIT 1`
             : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ? LIMIT 1`,
        [TICKETS_TABLE_ID, ticket_id]
      );

      let conversationId;
      if (conv) {
        conversationId = conv.id;
      } else {
        const convResult = await r(
          pg() ? `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
                  VALUES ($1, 'row', $2, $3, $4, NOW(), NOW()) RETURNING id`
               : `INSERT INTO conversations (title, type, bound_table_id, bound_row_id, created_by, created_at, updated_at)
                  VALUES (?, 'row', ?, ?, ?, datetime('now'), datetime('now'))`,
          [`Ticket #${ticket_id}: ${(ticket.what || '').substring(0, 60)}`, TICKETS_TABLE_ID, ticket_id, userId || 1]
        );
        conversationId = convResult?.lastInsertRowid || convResult?.rows?.[0]?.id;
      }

      const msgResult = await r(
        pg() ? `INSERT INTO messages (conversation_id, sender_id, content, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id`
             : `INSERT INTO messages (conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, datetime('now'))`,
        [conversationId, userId || 1, content]
      );

      return {
        success: true,
        message_id: msgResult?.lastInsertRowid || msgResult?.rows?.[0]?.id,
        conversation_id: conversationId,
        ticket_id,
        message: `Message sent to ticket #${ticket_id} chat`
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async get_chain_status({ chain_id }) {
    try {
      const { default: ChainHandoffService } = await import('../ChainHandoffService.js');
      const status = await ChainHandoffService.getChainStatus(chain_id);

      if (status.status === 'not_found') {
        return { error: `Chain '${chain_id}' not found` };
      }

      return {
        success: true,
        chain_id: status.chain_id,
        status: status.status,
        progress_pct: status.progress.percent_complete,
        total: status.progress.total,
        completed: status.progress.completed,
        in_progress: status.progress.in_progress,
        tasks: status.tasks.map(t => ({
          ticket_id: t.ticket_id,
          what: t.what,
          state: t.state,
          step: t.step,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async get_my_tasks(args, userId) {
    try {
      const { default: ChainHandoffService } = await import('../ChainHandoffService.js');
      const tasks = await ChainHandoffService.getAgentPendingTasks(userId);

      return {
        success: true,
        agent_id: userId,
        count: tasks.length,
        tasks: tasks.map(t => ({
          ticket_id: t.ticket_id,
          what: t.what,
          state: t.state,
          priority: t.priority,
          chain: t.chain,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  // === INFLIGHT PAUSE REGISTRY (ADR-0063-A §P3) ===
  // Watchdog-facing read-only view over _inflight_runs. Reuses the scope
  // filter from SystemTableService.queryInflightRuns so the per-space
  // projection rule (metadata.space_id) stays in one place.
  //
  // Contract (architect, §P3): { agent_slug?, conversation_id?, limit?, admin? }.
  // Caller's space is derived from context.spaceId — no explicit space_id arg.
  // `admin: true` is honoured only when context.spaceId === 1 (system space);
  // from any other space it is silently dropped (the run stays scoped to the
  // caller's space, so a non-admin can't escape their bucket by setting admin).
  async query_inflight_paused(
    { agent_slug, conversation_id, limit, admin } = {},
    userId,
    context = {}
  ) {
    try {
      const { queryInflightRuns } = await import('../SystemTableService.js');
      const callerSpaceId = context?.spaceId ?? context?.space_id ?? null;
      const isAdminSystemSpace = admin === true && callerSpaceId === 1;
      const cappedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

      const rows = await queryInflightRuns({
        spaceId: callerSpaceId,
        isAdminSystemSpace,
        status: 'paused',
        agent_slug: agent_slug || null,
        conversation_id: conversation_id != null ? Number(conversation_id) : null,
        limit: cappedLimit,
      });

      return {
        success: true,
        space_id: callerSpaceId,
        admin_view: isAdminSystemSpace,
        count: rows.length,
        runs: rows.map(r => ({
          id: r.id,
          ticket_id: r.ticket_id,
          agent_slug: r.agent_slug,
          conversation_id: r.conversation_id,
          started_at: r.started_at,
          last_step_id: r.last_step_id,
          status: r.status,
          reason: r.reason,
          resume_at: r.resume_at,
          resume_attempts: r.resume_attempts,
          metadata: r.metadata,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  // === CHAIN SUPERVISOR (ADR-101) ===
  async supervisor_decide({ decision, reason, next_cycle_plan, tasks, final_report, optional_ideas }, userId, context) {
    try {
      // Validate decision (ADR-101: Goal-First + CONSULT for optional ideas)
      if (!['CONTINUE', 'COMPLETE', 'CONSULT', 'ESCALATE'].includes(decision)) {
        return { error: 'Invalid decision. Must be CONTINUE, COMPLETE, CONSULT, or ESCALATE.' };
      }

      const { default: ChainHandoffService, SUPERVISOR_CONFIG } = await import('../ChainHandoffService.js');

      // ADR-101 T1 fix: Extract _chain_memory from ticket data passed via executeTool context
      const memory = context?.ticketData?._chain_memory
        || arguments[0]?._chain_memory;  // fallback: args contain _chain_memory directly

      if (!memory) {
        return { error: 'No _chain_memory found. This tool only works in supervisor mode (ticket must have _chain_memory).' };
      }

      if (decision === 'CONTINUE') {
        if (!next_cycle_plan || !tasks || tasks.length === 0) {
          return { error: 'CONTINUE requires next_cycle_plan and at least one task.' };
        }

        if (tasks.length > (SUPERVISOR_CONFIG.trigger_at_step - 1)) {
          return { error: `Maximum ${SUPERVISOR_CONFIG.trigger_at_step - 1} tasks per cycle.` };
        }

        // Resolve agent names to user IDs
        const resolvedTasks = tasks.map(t => ({
          ...t,
          assigned_to: ChainHandoffService.resolveAgentId(t.assigned_to) || t.assigned_to,
        }));

        const invalidAgents = resolvedTasks.filter(t => typeof t.assigned_to === 'string');
        if (invalidAgents.length > 0) {
          return { error: `Unknown agents: ${invalidAgents.map(t => t.assigned_to).join(', ')}. Valid: developer-ralph, frontend, test-runner, architect, frontend-qa, developer, widget-developer, n, nikich` };
        }

        const newCycle = await ChainHandoffService.startNewCycle({
          cycle_group_id: memory.cycle_group_id,
          cycle_number: (memory.cycle_number || 0) + 1,
          knowledge_stack: memory.knowledge_stack || [],
          original_goal: memory.original_goal,
          next_cycle_plan,
          tasks: resolvedTasks,
        });

        return {
          success: true,
          status: 'CONTINUE',
          reason,
          new_chain_id: newCycle.chain_id,
          new_cycle_number: newCycle.cycle_number,
          tasks_dispatched: newCycle.tasks.length,
          message: `New cycle ${newCycle.cycle_number} started with ${newCycle.tasks.length} tasks.`,
        };
      }

      if (decision === 'COMPLETE') {
        await ChainHandoffService.logActivity({
          action: 'supervisor_complete',
          agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
          chain_id: memory.parent_chain_id,
          details: {
            cycle_group_id: memory.cycle_group_id,
            total_cycles: memory.cycle_number,
            reason,
            report: final_report?.substring(0, 1000),
          },
        });

        return {
          success: true,
          status: 'COMPLETE',
          reason,
          total_cycles: memory.cycle_number,
          cycle_group_id: memory.cycle_group_id,
          final_report: final_report || reason,
          message: `Chain completed after ${memory.cycle_number} cycle(s). Goal: ${memory.original_goal}`,
        };
      }

      if (decision === 'CONSULT') {
        // ADR-101 Goal-First: Core goal done, supervisor proposes optional ideas to owner
        if (!optional_ideas || optional_ideas.length === 0) {
          return { error: 'CONSULT requires at least one optional_idea to propose to the owner.' };
        }

        await ChainHandoffService.logActivity({
          action: 'supervisor_consult',
          agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
          chain_id: memory.parent_chain_id,
          details: {
            cycle_group_id: memory.cycle_group_id,
            cycle_number: memory.cycle_number,
            reason,
            ideas_count: optional_ideas.length,
            ideas: optional_ideas.map(i => i.idea).join('; ').substring(0, 500),
          },
        });

        return {
          success: true,
          status: 'CONSULT',
          reason,
          cycle_number: memory.cycle_number,
          cycle_group_id: memory.cycle_group_id,
          original_goal: memory.original_goal,
          optional_ideas,
          message: `Core goal achieved. Consulting owner about ${optional_ideas.length} optional idea(s): ${optional_ideas.map(i => i.idea).join(', ')}`,
        };
      }

      if (decision === 'ESCALATE') {
        await ChainHandoffService.logActivity({
          action: 'supervisor_escalate',
          agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
          chain_id: memory.parent_chain_id,
          details: {
            cycle_group_id: memory.cycle_group_id,
            cycle_number: memory.cycle_number,
            reason,
            report: final_report?.substring(0, 1000),
          },
        });

        return {
          success: true,
          status: 'ESCALATE',
          reason,
          cycle_number: memory.cycle_number,
          cycle_group_id: memory.cycle_group_id,
          final_report: final_report || reason,
          message: `Escalated to owner after cycle ${memory.cycle_number}. Reason: ${reason}`,
        };
      }
    } catch (err) {
      return { error: err.message };
    }
  }
};
