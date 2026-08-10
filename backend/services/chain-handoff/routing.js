/**
 * ChainHandoffService — Routing Module
 *
 * Agent resolution, name lookup, state name mapping,
 * ticket queries, chain queries, handoff metadata, and activity logging.
 */

import { dbGet, dbAll, isPostgres, safeJsonParse } from '../../database/connection.js';
import { dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { generateBaseId } from '../../utils/baseId.js';
import {
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  AGENT_ACTIVITY_TABLE_ID,
} from './constants.js';
import { checkCompletionGate } from '../bdd/completionGate.js';

// ----- AGENT RESOLUTION -----

/**
 * Resolve agent user ID from name/slug.
 * Maps common agent names to user IDs.
 *
 * @param {string} agentName - Agent name or slug
 * @returns {number|null} Agent user ID or null
 */
function resolveAgentId(agentName) {
  if (!agentName) return null;
  const name = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const mapping = {
    'orchestrator': AGENT_USERS.ORCHESTRATOR,
    'architect': AGENT_USERS.ARCHITECT,
    'developer': AGENT_USERS.DEVELOPER,
    'developer-ralph': AGENT_USERS.DEV_RALPH,
    'dev-ralph': AGENT_USERS.DEV_RALPH,
    'frontend': AGENT_USERS.FRONTEND,
    'frontend-qa': AGENT_USERS.FRONTEND_QA,
    'frontendqa': AGENT_USERS.FRONTEND_QA,
    'test-runner': AGENT_USERS.TEST_RUNNER,
    'test_runner': AGENT_USERS.TEST_RUNNER,
    'table-architect': AGENT_USERS.TABLE_ARCHITECT,
    'widget-developer': AGENT_USERS.WIDGET_DEVELOPER,
    'document-agent': AGENT_USERS.DOCUMENT_AGENT,
    'marketer': AGENT_USERS.MARKETER,
    'nikich': AGENT_USERS.NIKICH,
    'fitness-coach': AGENT_USERS.FITNESS_COACH,
    'fitness_coach': AGENT_USERS.FITNESS_COACH,
    'sysadmin': AGENT_USERS.SYSADMIN,
    'sys-admin': AGENT_USERS.SYSADMIN,
  };

  return mapping[name] || null;
}

/**
 * Get agent name from user ID.
 *
 * @param {number} agentId - Agent user ID
 * @returns {string} Agent name
 */
function getAgentName(agentId) {
  const mapping = {
    [AGENT_USERS.ORCHESTRATOR]: 'Orchestrator',
    [AGENT_USERS.ARCHITECT]: 'Architect',
    [AGENT_USERS.DEVELOPER]: 'Developer',
    [AGENT_USERS.DEV_RALPH]: 'Developer Ralph',
    [AGENT_USERS.FRONTEND]: 'Frontend',
    [AGENT_USERS.FRONTEND_QA]: 'Frontend QA',
    [AGENT_USERS.TEST_RUNNER]: 'Test Runner',
    [AGENT_USERS.TABLE_ARCHITECT]: 'Table Architect',
    [AGENT_USERS.WIDGET_DEVELOPER]: 'Widget Developer',
    [AGENT_USERS.DOCUMENT_AGENT]: 'Document Agent',
    [AGENT_USERS.MARKETER]: 'Marketer',
    [AGENT_USERS.NIKICH]: 'Nikich',
    [AGENT_USERS.FITNESS_COACH]: 'Fitness Coach',
    [AGENT_USERS.SYSADMIN]: 'SysAdmin',
  };

  return mapping[agentId] || `Agent-${agentId}`;
}

/**
 * Convert state ID to human-readable name.
 * ADR-101 Stage 3
 */
function getStateName(stateId) {
  const names = {
    [STATE.BACKLOG]: 'backlog',
    [STATE.ASSIGNED]: 'assigned',
    [STATE.IN_PROGRESS]: 'in_progress',
    [STATE.REVIEW]: 'review',
    [STATE.CONTROL]: 'control',
    [STATE.REJECTED]: 'rejected',
    [STATE.DONE]: 'done',
  };
  return names[stateId] || 'unknown';
}

// ----- TICKET QUERIES -----

/**
 * Get a single ticket by ID from the Tickets table.
 * ADR-098: Used by tickets API routes for validation and display.
 *
 * @param {number} ticketId - Ticket row ID
 * @returns {Promise<Object|null>} Ticket data with id, created_at, updated_at, or null
 */
async function getTicket(ticketId) {
  if (!ticketId) return null;

  const row = await dbGet(
    isPostgres()
      ? `SELECT id, data, created_at, updated_at FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT id, data, created_at, updated_at FROM table_rows WHERE id = ? AND table_id = ?`,
    [ticketId, TICKETS_TABLE_ID]
  );

  if (!row) return null;

  const data = safeJsonParse(row.data, {});
  return {
    id: row.id,
    ...data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ----- CHAIN QUERIES -----

/**
 * Get all tasks in a chain.
 *
 * @param {string} chain_id - Chain identifier
 * @returns {Promise<Array>} Array of ticket objects in the chain
 */
async function getChainTasks(chain_id) {
  if (!chain_id) return [];

  const rows = await dbAll(
    isPostgres()
      ? `SELECT id, data, created_at, updated_at FROM table_rows
         WHERE table_id = $1
         AND data->'_chain'->>'chain_id' = $2
         ORDER BY (data->'_chain'->>'step')::int ASC`
      : `SELECT id, data, created_at, updated_at FROM table_rows
         WHERE table_id = ?
         AND json_extract(data, '$._chain.chain_id') = ?
         ORDER BY CAST(json_extract(data, '$._chain.step') AS INTEGER) ASC`,
    [TICKETS_TABLE_ID, chain_id]
  );

  return rows.map(row => {
    const data = safeJsonParse(row.data, {});
    return {
      ticket_id: row.id,
      chain_id: data._chain?.chain_id,
      step: data._chain?.step,
      what: data.what,
      why: data.why || '',
      state: data.state,
      assigned_to: data.assigned_to,
      chain_status: data._chain?.status,
      dispatched_at: data._chain?.dispatched_at,
      picked_up_at: data._chain?.picked_up_at,
      completed_at: data._chain?.completed_at,
      triggered_by: data._chain?.triggered_by ?? null,
      triggers_next: data._chain?.triggers_next ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

/**
 * Get chain status summary.
 *
 * @param {string} chain_id - Chain identifier
 * @returns {Promise<Object>} Chain status summary
 */
async function getChainStatus(chain_id) {
  const tasks = await getChainTasks(chain_id);

  if (tasks.length === 0) {
    return { chain_id, status: 'not_found', tasks: [] };
  }

  const total = tasks.length;
  const completed = tasks.filter(t => t.state === STATE.DONE).length;
  const inProgress = tasks.filter(t => t.state === STATE.IN_PROGRESS).length;
  const backlog = tasks.filter(t => t.state === STATE.BACKLOG).length;
  const review = tasks.filter(t => t.state === STATE.REVIEW).length;

  let overallStatus = 'in_progress';
  if (completed === total) overallStatus = 'completed';
  else if (backlog === total) overallStatus = 'pending';

  return {
    chain_id,
    status: overallStatus,
    progress: {
      total,
      completed,
      in_progress: inProgress,
      review,
      backlog,
      percent_complete: Math.round((completed / total) * 100),
    },
    tasks,
    current_step: tasks.find(t => t.state === STATE.IN_PROGRESS)?.step || null,
    next_step: tasks.find(t => t.state === STATE.BACKLOG)?.step || null,
  };
}

/**
 * Get pending tasks assigned to a specific agent.
 *
 * @param {number} agent_id - Agent user ID
 * @returns {Promise<Array>} Array of pending ticket objects
 */
async function getAgentPendingTasks(agent_id) {
  if (!agent_id) return [];

  const rows = await dbAll(
    isPostgres()
      ? `SELECT id, data, created_at, updated_at FROM table_rows
         WHERE table_id = $1
         AND (data->>'assigned_to')::int = $2
         AND (data->>'state')::int IN ($3, $4, $5, $6)
         ORDER BY created_at ASC`
      : `SELECT id, data, created_at, updated_at FROM table_rows
         WHERE table_id = ?
         AND CAST(json_extract(data, '$.assigned_to') AS INTEGER) = ?
         AND CAST(json_extract(data, '$.state') AS INTEGER) IN (?, ?, ?, ?)
         ORDER BY created_at ASC`,
    [TICKETS_TABLE_ID, agent_id, STATE.BACKLOG, STATE.ASSIGNED, STATE.IN_PROGRESS, STATE.REJECTED]
  );

  return rows.map(row => {
    const data = safeJsonParse(row.data, {});
    return {
      ticket_id: row.id,
      what: data.what,
      why: data.why,
      state: data.state,
      priority: data.priority,
      assigned_to: data.assigned_to,
      acceptance_criteria: data.acceptance_criteria,
      chain: data._chain || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

// ----- HANDOFF METADATA -----

/**
 * Build a handoff metadata object for passing context between agents.
 * This is the standard format for what gets communicated during a handoff.
 *
 * @param {Object} params
 * @param {number} params.from_agent - Dispatching agent user ID
 * @param {number} params.to_agent - Receiving agent user ID
 * @param {number} params.ticket_id - Ticket being handed off
 * @param {string} params.chain_id - Chain identifier
 * @param {number} params.step - Current step in the chain
 * @param {string} [params.context] - Free-form context/instructions
 * @param {Object} [params.artifacts] - Any artifacts from previous step (file paths, URLs, etc.)
 * @param {Array<string>} [params.dependencies] - Ticket IDs this task depends on
 * @returns {Object} Standardized handoff metadata
 */
function buildHandoffMetadata(params) {
  const {
    from_agent,
    to_agent,
    ticket_id,
    chain_id,
    step,
    context = '',
    artifacts = {},
    dependencies = [],
  } = params;

  return {
    handoff_version: '1.0',
    chain_id,
    step,
    ticket_id,
    from_agent,
    to_agent,
    timestamp: new Date().toISOString(),
    context,
    artifacts,
    dependencies,
    protocol: {
      pickup: 'Agent sets ticket state to in_progress (24276)',
      submit: 'Agent sets ticket state to review (24277)',
      approve: 'Supervisor (user_id=53) or human sets state to done (24278)',
      reject: 'Supervisor or human sets state to rejected (43438)',
      fail: 'Agent keeps state in_progress and adds error to why field',
      handoff: 'Agent dispatches next subtask with step+1',
      states: 'backlog(24275) → assigned(43436) → in_progress(24276) → review(24277) → control(43437) → done(24278) | rejected(43438)',
    },
  };
}

// ----- ACTIVITY LOGGING -----

/**
 * Log agent activity to the Agent Activity table.
 *
 * @param {Object} params
 * @param {string} params.action - Action type (e.g., 'dispatch_subtask', 'status_update')
 * @param {number} [params.agent_id] - Agent user ID
 * @param {number} [params.ticket_id] - Related ticket ID
 * @param {string} [params.chain_id] - Chain identifier
 * @param {Object} [params.details] - Additional details
 */
async function logActivity(params) {
  const {
    action,
    agent_id = null,
    ticket_id = null,
    chain_id = null,
    details = {},
  } = params;

  try {
    const activityData = {
      action,
      agent_id,
      ticket_id,
      chain_id,
      details: typeof details === 'string' ? details : JSON.stringify(details),
      timestamp: new Date().toISOString(),
      success: true,
    };

    const baseId = generateBaseId('activity');
    const dataJson = JSON.stringify(activityData);

    if (isPostgres()) {
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
        [AGENT_ACTIVITY_TABLE_ID, baseId, dataJson]
      );
    } else {
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        [AGENT_ACTIVITY_TABLE_ID, baseId, dataJson]
      );
    }
  } catch (err) {
    // Activity logging should never block the main flow
    apiLogger.error({ err, action, agent_id, ticket_id }, 'ChainHandoff: Failed to log activity');
  }
}

// ----- STATUS TRACKING -----

/**
 * Update ticket status (used by agents to pick up, complete, or fail tasks).
 *
 * @param {Object} params
 * @param {number} params.ticket_id - Ticket row ID
 * @param {number} params.new_state - New state ID (24275-24278)
 * @param {number} params.agent_id - Agent user ID making the update
 * @param {string} [params.notes] - Optional notes/reason for update
 * @returns {Promise<Object>} Updated ticket data
 */
async function updateTicketStatus(params) {
  const { ticket_id, new_state, agent_id, notes = '' } = params;

  if (!ticket_id || !new_state) {
    throw new Error('updateTicketStatus requires "ticket_id" and "new_state"');
  }

  // Validate state
  const validStates = Object.values(STATE);
  if (!validStates.includes(new_state)) {
    throw new Error(`Invalid state ${new_state}. Valid: ${validStates.join(', ')}`);
  }

  // === ADR-109: Validate transition using same map as API route ===
  // Unified state machine — service layer uses identical transition rules
  const SERVICE_TRANSITIONS = {
    [STATE.BACKLOG]:     [STATE.ASSIGNED, STATE.IN_PROGRESS],
    [STATE.ASSIGNED]:    [STATE.IN_PROGRESS, STATE.BACKLOG],
    [STATE.IN_PROGRESS]: [STATE.REVIEW, STATE.BACKLOG],
    [STATE.REVIEW]:      [STATE.CONTROL, STATE.IN_PROGRESS],
    [STATE.CONTROL]:     [STATE.DONE, STATE.REJECTED],
    [STATE.REJECTED]:    [STATE.IN_PROGRESS],
    [STATE.DONE]:        [], // terminal
  };

  // Fetch current ticket
  const row = await dbGet(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
    [ticket_id, TICKETS_TABLE_ID]
  );

  if (!row) {
    throw new Error(`Ticket ${ticket_id} not found in table ${TICKETS_TABLE_ID}`);
  }

  const existingData = safeJsonParse(row.data, {});
  const oldState = existingData.state;

  // === ADR-109: Validate transition before executing ===
  if (oldState != null) {
    const allowed = SERVICE_TRANSITIONS[oldState] || [];
    if (allowed.length > 0 && !allowed.includes(new_state)) {
      const stateNames = { [STATE.BACKLOG]: 'backlog', [STATE.ASSIGNED]: 'assigned', [STATE.IN_PROGRESS]: 'in_progress', [STATE.REVIEW]: 'review', [STATE.CONTROL]: 'control', [STATE.REJECTED]: 'rejected', [STATE.DONE]: 'done' };
      const fromName = stateNames[oldState] || String(oldState);
      const toName = stateNames[new_state] || String(new_state);
      const allowedNames = allowed.map(s => stateNames[s] || String(s)).join(', ');
      apiLogger.warn({ ticket_id, oldState, new_state, allowed }, `Service: Invalid transition ${fromName} → ${toName}`);
      throw new Error(`Invalid transition: ${fromName} → ${toName}. Allowed: [${allowedNames}]`);
    }
  }

  // === ADR-0002 §8 Phase 3 (G4) — completion gate (service-layer enforcement) ===
  // The HTTP layer (PATCH /tickets/:id/status, PUT /tables/1708/rows/:id)
  // already runs this gate. Repeating it here closes the agent path:
  // ChainHandoffService.updateTicketStatus is also called from the
  // chat→delegation fast-path and agent-tools, neither of which goes through
  // the HTTP gate. The Error is caught by callers and surfaced as 409.
  if (new_state === STATE.DONE && oldState !== STATE.DONE) {
    try {
      const gate = await checkCompletionGate(ticket_id);
      if (!gate.ok) {
        apiLogger.info(
          { ticket_id, must_total: gate.must_total, must_verified: gate.must_verified, blocker_count: gate.blockers.length },
          'ADR-0002 G4: completion gate blocked done transition (service path)'
        );
        const blockerCodes = gate.blockers
          .map(b => b.code || `#${b.id}`)
          .slice(0, 5)
          .join(', ');
        const err = new Error(
          `MUST_CRITERIA_INCOMPLETE: ${gate.blockers.length}/${gate.must_total} must-criteria not verified` +
          (blockerCodes ? ` (${blockerCodes})` : '')
        );
        err.code = 'MUST_CRITERIA_INCOMPLETE';
        err.statusCode = 409;
        err.gate = {
          must_total: gate.must_total,
          must_verified: gate.must_verified,
          failed: gate.blockers,
        };
        throw err;
      }
    } catch (gateErr) {
      // Re-throw gate rejections; only swallow query failures (no `gate` field).
      if (gateErr.code === 'MUST_CRITERIA_INCOMPLETE') throw gateErr;
      apiLogger.warn({ err: gateErr.message, ticket_id }, 'completion gate query failed (service path), allowing transition');
    }
  }

  // Update data with new state and chain status
  const updatedData = {
    ...existingData,
    state: new_state,
  };

  // Update chain metadata status (Phase 1 — 7 states)
  if (updatedData._chain) {
    if (new_state === STATE.ASSIGNED) {
      updatedData._chain.status = 'assigned';
      updatedData._chain.assigned_at = new Date().toISOString();
    } else if (new_state === STATE.IN_PROGRESS) {
      updatedData._chain.status = 'in_progress';
      updatedData._chain.picked_up_at = new Date().toISOString();
      updatedData._chain.picked_up_by = agent_id;
    } else if (new_state === STATE.REVIEW) {
      updatedData._chain.status = 'review';
    } else if (new_state === STATE.CONTROL) {
      updatedData._chain.status = 'control';
      updatedData._chain.control_at = new Date().toISOString();
    } else if (new_state === STATE.REJECTED) {
      updatedData._chain.status = 'rejected';
      updatedData._chain.rejected_at = new Date().toISOString();
      updatedData._chain.rejected_by = agent_id;
    } else if (new_state === STATE.DONE) {
      updatedData._chain.status = 'completed';
      updatedData._chain.completed_at = new Date().toISOString();
      updatedData._chain.completed_by = agent_id;
    }
  }

  // Add notes to why field if provided
  if (notes) {
    updatedData.why = existingData.why
      ? `${existingData.why}\n\n[Agent ${agent_id} @ ${new Date().toISOString()}]: ${notes}`
      : `[Agent ${agent_id} @ ${new Date().toISOString()}]: ${notes}`;
  }

  const updatedJson = JSON.stringify(updatedData);

  if (isPostgres()) {
    await dbRun(
      `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [updatedJson, ticket_id]
    );
  } else {
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
      [updatedJson, ticket_id]
    );
  }

  // Log activity
  await logActivity({
    action: 'status_update',
    agent_id,
    ticket_id,
    chain_id: updatedData._chain?.chain_id,
    details: {
      old_state: oldState,
      new_state,
      notes,
    },
  });

  apiLogger.info({
    ticket_id,
    oldState,
    new_state,
    agent_id,
    chain_id: updatedData._chain?.chain_id,
  }, 'ChainHandoff: Ticket status updated');

  return {
    ticket_id,
    old_state: oldState,
    new_state,
    chain_id: updatedData._chain?.chain_id,
    data: updatedData,
  };
}

export {
  resolveAgentId,
  getAgentName,
  getStateName,
  getTicket,
  getChainTasks,
  getChainStatus,
  getAgentPendingTasks,
  buildHandoffMetadata,
  logActivity,
  updateTicketStatus,
};
