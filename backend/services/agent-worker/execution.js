// agent-worker/execution.js — Ticket execution, conversation binding, agent config, context builders
import { dbGet, dbRun, isPostgres, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { agentLoop as executeAgentToolLoop, saveStepMessage, resolveAllowedTools } from '../AgentLoopService.js';
import {
  resolveAgentProvider as sharedResolveAgentProvider,
  buildAgentSystemPrompt as sharedBuildAgentSystemPrompt,
  detectProvider,
} from '../chat/agent-execution-shared.js';
import { createAndDispatchJob } from '../AgentJobService.js';
import ChainHandoffService, { STATE, AGENT_USERS } from '../ChainHandoffService.js';
import { generateBaseId } from '../../utils/baseId.js';
import {
  TICKETS_TABLE_ID,
  AI_AGENTS_TABLE_ID,
  SPACE_ID,
  AGENT_USER_TO_ROW,
  normalizeAgentId,
} from './constants.js';

/**
 * Execute a single ticket: assign → execute → review/error.
 * @param {Object} ticket - Ticket row from DB
 * @param {Map} _activeJobs - Reference to the active jobs map (for duration tracking)
 */
async function executeTicket(ticket, _activeJobs) {
  const ticketData = safeJsonParse(ticket.data, {});
  // Normalise assigned_to: may be an integer, numeric string, or slug.
  const rawAssignedTo = ticketData.assigned_to;
  const agentUserId = normalizeAgentId(rawAssignedTo);

  if (agentUserId !== rawAssignedTo) {
    apiLogger.info({
      ticket_id: ticket.id,
      raw: rawAssignedTo,
      resolved: agentUserId,
    }, 'AgentWorker: Normalised string-slug assigned_to to integer user ID');
  }

  const agentName = ChainHandoffService.getAgentName(agentUserId);

  apiLogger.info({
    ticket_id: ticket.id,
    what: (ticketData.what || '').substring(0, 80),
    agentUserId,
    agentName,
  }, 'AgentWorker: Executing ticket');

  try {
    // 1. Transition to in_progress (acts as lock)
    await ChainHandoffService.updateTicketStatus({
      ticket_id: ticket.id,
      new_state: STATE.IN_PROGRESS,
      agent_id: agentUserId,
      notes: 'AgentWorker: picked up for execution',
    });

    // 2. Get or create a bound conversation
    const conversationId = await ensureTicketConversation(ticket.id, agentUserId, ticketData);

    // 3. Load agent config from AI Agents table
    const agentConfig = await loadAgentConfig(agentUserId);
    if (!agentConfig) {
      throw new Error(`No agent config found for user ${agentUserId} (${agentName})`);
    }

    // 4. Build execution context
    const systemPrompt = await buildTicketSystemPrompt(agentConfig, ticketData);
    const userMessage = buildTicketUserMessage(ticketData);

    // 5. Post the task as a user message in the ticket conversation
    await saveStepMessage(conversationId, {
      content: userMessage,
      role: 'user',
      senderType: 'system',
      contentType: 'text',
      metadata: JSON.stringify({
        source: 'agent_worker',
        ticket_id: ticket.id,
      }),
    });

    // 6. Resolve provider and detect type
    const resolved = await sharedResolveAgentProvider(agentConfig);
    const agentRowId = AGENT_USER_TO_ROW[agentUserId] || null;
    const { isClaudeCode } = detectProvider(resolved.provider, resolved.model);

    let responseText;

    if (isClaudeCode) {
      // ── Claude Code agents: async dispatch via AgentJobService ──
      apiLogger.info({
        ticket_id: ticket.id,
        agentName,
        provider: resolved.provider,
      }, 'AgentWorker: Claude-code agent detected, dispatching async job');

      const agentForJob = {
        id: agentUserId,
        name: agentName,
        managed_by_agent_row_id: agentRowId,
        _agentConfig: agentConfig,
      };

      await createAndDispatchJob({
        conversationId,
        agent: agentForJob,
        triggeredByUserId: agentUserId,
        messageContent: userMessage,
        options: { agent_mode: 'agent' },
        ticketId: ticket.id,
      });

      // Claude Code job runs async — do NOT transition ticket here.
      apiLogger.info({ ticket_id: ticket.id, agentName }, 'AgentWorker: Claude-code job dispatched, ticket stays in_progress until job completes');
      return; // Skip the synchronous REVIEW transition below
    } else {
      // ── Non-claude-code agents: synchronous tool loop ──
      responseText = await executeAgentToolLoop({
        conversationId,
        systemPrompt,
        history: [],
        userMessage,
        agentConfig,
        resolved,
        agentRowId,
        senderId: agentUserId,
        spaceId: SPACE_ID,
        userId: agentUserId,
        ticketData,
      });
    }

    // 7. Success → transition to review
    await ChainHandoffService.updateTicketStatus({
      ticket_id: ticket.id,
      new_state: STATE.REVIEW,
      agent_id: agentUserId,
      notes: `Completed. Response: ${(responseText || '').substring(0, 200)}`,
    });

    // 8. Log activity
    await ChainHandoffService.logActivity({
      action: 'agent_worker_completed',
      agent_id: agentUserId,
      ticket_id: ticket.id,
      chain_id: ticketData._chain?.chain_id,
      details: {
        response_length: responseText?.length || 0,
        duration_ms: Date.now() - (_activeJobs.get(ticket.id)?.startedAt || Date.now()),
      },
    });

    apiLogger.info({
      ticket_id: ticket.id,
      agentName,
      responseLength: responseText?.length || 0,
    }, 'AgentWorker: Ticket completed successfully');

  } catch (err) {
    apiLogger.error({ err, ticket_id: ticket.id, agentName }, 'AgentWorker: Ticket execution failed');

    // Save error to ticket conversation
    try {
      const convId = await findTicketConversation(ticket.id);
      if (convId) {
        await saveStepMessage(convId, {
          content: `Agent "${agentName}" encountered an error: ${err.message || 'Unknown error'}`,
          role: 'system',
          senderType: 'system',
          contentType: 'text',
          metadata: JSON.stringify({
            type: 'agent_error',
            error: err.message,
            ticket_id: ticket.id,
          }),
        });
      }
    } catch (msgErr) {
      apiLogger.error({ err: msgErr }, 'AgentWorker: Failed to save error message');
    }

    // Update ticket back to backlog so it can be retried
    try {
      await ChainHandoffService.updateTicketStatus({
        ticket_id: ticket.id,
        new_state: STATE.BACKLOG,
        agent_id: agentUserId,
        notes: `Error (will retry): ${err.message || 'Unknown error'}`,
      });
    } catch (statusErr) {
      apiLogger.error({ err: statusErr }, 'AgentWorker: Failed to update ticket status on error');
    }
  } finally {
    _activeJobs.delete(ticket.id);
  }
}

// ----- TICKET-CONVERSATION BINDING -----

/**
 * Get or create a conversation bound to a ticket.
 */
async function ensureTicketConversation(ticketId, agentUserId, ticketData) {
  // Check for existing bound conversation
  const existing = await findTicketConversation(ticketId);
  if (existing) return existing;

  // Create new conversation bound to the ticket
  const title = `Ticket #${ticketId}: ${(ticketData.what || 'Task').substring(0, 100)}`;
  const baseId = generateBaseId('conv');

  const result = await dbRun(
    isPostgres()
      ? `INSERT INTO conversations (space_id, type, title, bound_table_id, bound_row_id, created_by, base_id, created_at, updated_at)
         VALUES ($1, 'ticket_chat', $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id`
      : `INSERT INTO conversations (space_id, type, title, bound_table_id, bound_row_id, created_by, base_id, created_at, updated_at)
         VALUES (?, 'ticket_chat', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [SPACE_ID, title, TICKETS_TABLE_ID, ticketId, agentUserId, baseId]
  );

  const conversationId = result?.lastInsertRowid;

  if (!conversationId) {
    throw new Error(`Failed to create conversation for ticket #${ticketId}`);
  }

  // Add agent as participant
  try {
    await dbRun(
      isPostgres()
        ? `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
           VALUES ($1, $2, 'agent', NOW())
           ON CONFLICT (conversation_id, user_id) DO NOTHING`
        : `INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role, joined_at)
           VALUES (?, ?, 'agent', datetime('now'))`,
      [conversationId, agentUserId]
    );
  } catch (partErr) {
    apiLogger.warn({ err: partErr }, 'AgentWorker: Failed to add agent as participant (non-fatal)');
  }

  apiLogger.info({
    conversationId,
    ticketId,
    agentUserId,
    title,
  }, 'AgentWorker: Created ticket conversation');

  return conversationId;
}

/**
 * Find existing conversation bound to a ticket.
 */
async function findTicketConversation(ticketId) {
  const row = await dbGet(
    isPostgres()
      ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2`
      : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ?`,
    [TICKETS_TABLE_ID, ticketId]
  );
  return row?.id || null;
}

// ----- AGENT CONFIG -----

/**
 * Load agent configuration from AI Agents table by user ID.
 */
async function loadAgentConfig(agentUserId) {
  // Map user ID to agent row ID
  const agentRowId = AGENT_USER_TO_ROW[agentUserId];

  if (agentRowId) {
    const row = await dbGet(
      isPostgres()
        ? `SELECT data FROM table_rows WHERE id = $1 AND table_id = $2`
        : `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [agentRowId, AI_AGENTS_TABLE_ID]
    );
    if (row) {
      const config = safeJsonParse(row.data, {});
      config.row_id = agentRowId;
      return config;
    }
  }

  // Fallback: search by agent name
  const agentName = ChainHandoffService.getAgentName(agentUserId);
  const row = await dbGet(
    isPostgres()
      ? `SELECT tr.id, tr.data FROM table_rows tr
         WHERE tr.table_id = $1 AND tr.data->>'name' ILIKE $2
         LIMIT 1`
      : `SELECT tr.id, tr.data FROM table_rows tr
         WHERE tr.table_id = ? AND json_extract(tr.data, '$.name') LIKE ?
         LIMIT 1`,
    [AI_AGENTS_TABLE_ID, `%${agentName}%`]
  );

  if (row) {
    const config = safeJsonParse(row.data, {});
    config.row_id = row.id;
    return config;
  }

  return null;
}

// ----- CONTEXT BUILDERS -----

/**
 * Build the system prompt for ticket execution.
 * Combines the agent's own system prompt with ticket-specific context.
 */
async function buildTicketSystemPrompt(agentConfig, ticketData) {
  const basePrompt = await sharedBuildAgentSystemPrompt(agentConfig, {
    spaceId: SPACE_ID,
    agentMode: 'agent',
  }, 'account');

  const ticketContext = [
    '',
    '## Current Task (from Ticket)',
    '',
    `**Ticket**: #${ticketData._chain?.ticket_id || 'unknown'}`,
    `**Task**: ${ticketData.what || 'No description'}`,
    ticketData.acceptance_criteria ? `**Acceptance Criteria**: ${ticketData.acceptance_criteria}` : '',
    ticketData._chain ? `**Chain**: ${ticketData._chain.chain_id} (step ${ticketData._chain.step})` : '',
    '',
    'Complete this task. Use the available tools. Report your results.',
  ].filter(Boolean).join('\n');

  return basePrompt + ticketContext;
}

/**
 * Build the user message from ticket data.
 */
function buildTicketUserMessage(ticketData) {
  const parts = [
    `## Task: ${ticketData.what || 'No description'}`,
  ];

  if (ticketData.why) {
    parts.push('', `### Context`, ticketData.why);
  }

  if (ticketData.acceptance_criteria) {
    parts.push('', `### Acceptance Criteria`, ticketData.acceptance_criteria);
  }

  if (ticketData._chain) {
    parts.push('', `### Chain Info`, `Chain: ${ticketData._chain.chain_id} | Step: ${ticketData._chain.step}`);
    if (ticketData._chain.dispatched_by) {
      const dispatcherName = ChainHandoffService.getAgentName(ticketData._chain.dispatched_by);
      parts.push(`Dispatched by: ${dispatcherName}`);
    }
  }

  return parts.join('\n');
}

export {
  executeTicket,
  ensureTicketConversation,
  findTicketConversation,
  loadAgentConfig,
  buildTicketSystemPrompt,
  buildTicketUserMessage,
};
