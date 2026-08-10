/**
 * ChainHandoffService — Dispatch Module
 *
 * Subtask dispatch and batch chain dispatch logic.
 */

import { dbRun, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { generateBaseId } from '../../utils/baseId.js';
import { getPipelineConfig } from '../pipeline-config.js';
import {
  AGENT_USERS,
  MAX_CHAIN_DEPTH,
  MAX_CHAIN_TASKS,
  generateChainId,
  generateCycleGroupId,
  normalizeAssignedTo,
} from './constants.js';

/**
 * Dispatch a subtask to a specialist agent by creating a ticket in the CRM.
 *
 * @param {Object} params
 * @param {string} params.what - Task title/description
 * @param {string} params.why - Reason/context for the task
 * @param {number} params.assigned_to - User ID of the specialist agent
 * @param {number} [params.priority] - Priority select option ID (default: 24274 = high)
 * @param {number} [params.type] - Type select option ID (default: 24269 = task)
 * @param {string} [params.acceptance_criteria] - What constitutes done
 * @param {string} [params.chain_id] - Chain ID for linking related tasks (auto-generated if omitted)
 * @param {number} [params.parent_ticket_id] - Parent ticket ID in the chain
 * @param {number} [params.step] - Step number in the chain (1-based)
 * @param {number} [params.dispatched_by] - User ID of the dispatcher (orchestrator)
 * @param {number} [params.project_id] - Project ID for the ticket
 * @param {number} [params.parent_document_id] - Document this ticket belongs to (ADR-0012 / ADR-154 doc-scoped resolver)
 * @returns {Promise<Object>} Created ticket row with chain metadata
 */
async function dispatchSubtask(params) {
  const {
    what,
    why,
    assigned_to,
    priority,
    type,
    acceptance_criteria = '',
    chain_id = generateChainId(),
    parent_ticket_id = null,
    step = 1,
    dispatched_by,
    project_id = null,
    parent_document_id = null,
    _chain_memory = null,
    triggered_by = null,
    triggers_next = null,
    space_id,
  } = params;

  // Resolve per-space config
  const cfg = getPipelineConfig(space_id);
  const effectivePriority = priority != null ? priority : cfg.DEFAULTS.PRIORITY;
  const effectiveType = type != null ? type : cfg.DEFAULTS.TYPE;
  const effectiveDispatchedBy = dispatched_by != null ? dispatched_by : cfg.AGENT_USERS.ARCHITECT;
  const svCfg = cfg.SUPERVISOR_CONFIG;

  if (!what || !assigned_to) {
    throw new Error('dispatchSubtask requires "what" and "assigned_to"');
  }

  // Normalize assigned_to to a valid integer user ID
  // Handles three formats: integer user_id, Users-table row_id, or string slug
  const normalizedAssignedTo = normalizeAssignedTo(assigned_to, space_id);
  if (normalizedAssignedTo !== assigned_to) {
    apiLogger.info({
      raw: assigned_to,
      normalized: normalizedAssignedTo,
    }, 'ChainHandoff: Normalized assigned_to');
  }

  // === ADR-101 Stage 3: Supervisor trigger at configured step ===
  // T2 fix: flag for triggering supervisor AFTER creating the original task
  let _shouldTriggerSupervisor = false;
  let _supervisorParams = null;

  if (svCfg.enabled && step >= svCfg.trigger_at_step && chain_id) {
    const memory = _chain_memory || {};
    const cycleNumber = (memory.cycle_number || 0) + 1;

    // Safety: max cycles check
    if (cycleNumber > svCfg.max_cycles) {
      return this.autoEscalate(chain_id, memory, 'MAX_CYCLES_REACHED', space_id);
    }

    // Safety: total duration check
    if (memory.knowledge_stack?.length > 0) {
      const firstCycleStart = new Date(memory.knowledge_stack[0].started_at).getTime();
      if (Date.now() - firstCycleStart > svCfg.max_duration_ms) {
        return this.autoEscalate(chain_id, memory, 'MAX_DURATION_REACHED', space_id);
      }
    }

    // Safety: total tasks check
    const totalPreviousTasks = (memory.knowledge_stack || [])
      .reduce((sum, k) => sum + (k.tasks_total || 0), 0);
    if (totalPreviousTasks + step > svCfg.max_total_tasks) {
      return this.autoEscalate(chain_id, memory, 'MAX_TASKS_REACHED', space_id);
    }

    // T5 fix: Validate supervisor params before triggering
    const originalGoal = memory.original_goal || what;
    if (!originalGoal || typeof originalGoal !== 'string' || originalGoal.trim().length === 0) {
      apiLogger.warn({ chain_id, step }, 'ChainHandoff: Skipping supervisor — no valid original_goal');
    } else {
      // T2 fix: Don't return here — flag for post-creation trigger so the step-9 task is NOT lost
      _shouldTriggerSupervisor = true;
      _supervisorParams = {
        chain_id,
        cycle_number: cycleNumber,
        cycle_group_id: memory.cycle_group_id || generateCycleGroupId(),
        original_goal: originalGoal,
        knowledge_stack: memory.knowledge_stack || [],
        space_id,
      };
    }
  }

  // Safety: check chain depth (fallback for non-supervisor paths)
  if (step > MAX_CHAIN_DEPTH) {
    throw new Error(`Chain depth limit reached (max ${MAX_CHAIN_DEPTH}). Refusing to dispatch step ${step}.`);
  }

  // Safety: check total tasks in this chain
  if (chain_id && chain_id !== generateChainId()) {
    const existingTasks = await this.getChainTasks(chain_id, space_id);
    if (existingTasks.length >= MAX_CHAIN_TASKS) {
      throw new Error(`Chain task limit reached (max ${MAX_CHAIN_TASKS}). Chain ${chain_id} has ${existingTasks.length} tasks.`);
    }
  }

  // Build ticket data with chain metadata
  const ticketData = {
    what,
    why: why || '',
    assigned_to: normalizedAssignedTo,
    priority: effectivePriority,
    type: effectiveType,
    state: cfg.STATE.BACKLOG,
    acceptance_criteria: acceptance_criteria || '',
    // Chain handoff metadata (stored as part of row data)
    _chain: {
      chain_id,
      parent_ticket_id,
      step,
      dispatched_by: effectiveDispatchedBy,
      dispatched_at: new Date().toISOString(),
      status: 'dispatched',
      triggered_by,
      triggers_next,
    },
  };

  if (project_id) {
    ticketData.project_id = project_id;
  }

  // ADR-0012 / ADR-154: persist parent_document_id when caller knows it, so
  // the doc-scoped widget tickets resolver finds this ticket.
  if (parent_document_id != null) {
    ticketData.parent_document_id = parent_document_id;
  }

  // Create the ticket row
  const baseId = generateBaseId('ticket');
  const dataJson = JSON.stringify(ticketData);

  let result;
  if (isPostgres()) {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       RETURNING id`,
      [cfg.TICKETS_TABLE_ID, baseId, dataJson]
    );
  } else {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [cfg.TICKETS_TABLE_ID, baseId, dataJson]
    );
  }

  const ticketId = result?.lastInsertRowid || result?.rows?.[0]?.id;

  // Log activity
  await this.logActivity({
    action: 'dispatch_subtask',
    agent_id: effectiveDispatchedBy,
    ticket_id: ticketId,
    chain_id,
    details: {
      what,
      assigned_to: normalizedAssignedTo,
      step,
      parent_ticket_id,
    },
    space_id,
  });

  apiLogger.info({
    ticketId,
    chain_id,
    step,
    assigned_to: normalizedAssignedTo,
    what: what.substring(0, 80),
    space_id: cfg.spaceId,
  }, 'ChainHandoff: Subtask dispatched');

  const taskResult = {
    ticket_id: ticketId,
    chain_id,
    step,
    state: cfg.STATE.BACKLOG,
    assigned_to: normalizedAssignedTo,
    what,
    data: ticketData,
  };

  // === ADR-101 T2+T3 fix: Trigger supervisor AFTER step-9 task is safely created ===
  if (_shouldTriggerSupervisor && _supervisorParams) {
    try {
      const supervisorResult = await this.triggerSupervisor(_supervisorParams);
      taskResult._supervisor = supervisorResult;
    } catch (supervisorErr) {
      // T3 fix: Supervisor failure must not lose the original task
      apiLogger.error({ err: supervisorErr, chain_id, step },
        'ChainHandoff: triggerSupervisor failed — original task preserved, falling back to normal dispatch');
      taskResult._supervisor_error = supervisorErr.message;
    }
  }

  return taskResult;
}

/**
 * Dispatch multiple subtasks at once (batch dispatch).
 * Used by orchestrator to create a full chain plan.
 *
 * @param {Object} params
 * @param {string} [params.chain_id] - Shared chain ID (auto-generated if omitted)
 * @param {number} [params.parent_ticket_id] - Parent ticket for all subtasks
 * @param {number} [params.dispatched_by] - Orchestrator user ID
 * @param {Array<Object>} params.tasks - Array of task definitions
 * @returns {Promise<Object>} Chain summary with all created tickets
 */
async function dispatchChain(params) {
  const {
    chain_id = generateChainId(),
    parent_ticket_id = null,
    dispatched_by = AGENT_USERS.ARCHITECT,
    tasks = [],
  } = params;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('dispatchChain requires at least one task');
  }

  if (tasks.length > MAX_CHAIN_TASKS) {
    throw new Error(`Cannot dispatch more than ${MAX_CHAIN_TASKS} tasks in a single chain`);
  }

  const results = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    // Auto-link sequential tasks: first task triggered_by parent, others by previous task
    const autoTriggeredBy = i === 0
      ? (parent_ticket_id || null)
      : results[i - 1].ticket_id;
    const result = await this.dispatchSubtask({
      ...task,
      chain_id,
      parent_ticket_id,
      step: task.step || (i + 1),
      dispatched_by,
      triggered_by: task.triggered_by ?? autoTriggeredBy,
    });
    results.push(result);
  }

  apiLogger.info({
    chain_id,
    taskCount: results.length,
    parent_ticket_id,
  }, 'ChainHandoff: Chain dispatched');

  return {
    chain_id,
    parent_ticket_id,
    dispatched_by,
    task_count: results.length,
    tasks: results,
  };
}

export {
  dispatchSubtask,
  dispatchChain,
};
