/**
 * ChainHandoffService — Lifecycle Module
 *
 * Knowledge stack, supervisor engine, cycle management, and auto-escalation.
 * ADR-101 Stages 2 & 3.
 */

import { dbRun, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { generateBaseId } from '../../utils/baseId.js';
import {
  STATE,
  AGENT_USERS,
  TICKETS_TABLE_ID,
  SUPERVISOR_CONFIG,
  generateChainId,
} from './constants.js';
import { getAgentName } from './routing.js';

// T6 fix: In-memory mutex to prevent concurrent supervisor triggers for the same chain
const _supervisorLocks = new Set();

// ----- ADR-101 STAGE 2: KNOWLEDGE STACK -----

/**
 * Build a structured knowledge summary from chain tasks.
 * Parses task `why` fields to extract decisions, resolved/unresolved issues,
 * and artifacts (files, test results).
 *
 * ADR-101 Stage 2: Data collection only — no cycle restart.
 *
 * @param {Array} chainTasks - Array of tasks from getChainTasks()
 * @returns {Object} Structured knowledge summary
 */
function buildKnowledgeSummary(chainTasks) {
  if (!chainTasks || chainTasks.length === 0) {
    return {
      summary: 'No tasks in chain.',
      tasks: [],
      decisions: [],
      resolved: [],
      unresolved: [],
      artifacts: { files_created: [], files_modified: [], tests_passed: 0, tests_failed: 0 },
    };
  }

  const decisions = new Set();
  const resolved = new Set();
  const unresolved = new Set();
  const filesCreated = new Set();
  const filesModified = new Set();
  let testsPassed = 0;
  let testsFailed = 0;

  const taskSummaries = [];

  for (const task of chainTasks) {
    const why = task.why || '';

    // Extract structured markers from why field
    const decisionMatches = why.match(/DECISION:\s*([^\n]+)/gi) || [];
    for (const m of decisionMatches) {
      decisions.add(m.replace(/^DECISION:\s*/i, '').trim());
    }

    const resolvedMatches = why.match(/(?:RESOLVED|FIXED):\s*([^\n]+)/gi) || [];
    for (const m of resolvedMatches) {
      resolved.add(m.replace(/^(?:RESOLVED|FIXED):\s*/i, '').trim());
    }

    const unresolvedMatches = why.match(/(?:BLOCKER|UNRESOLVED|FAILED):\s*([^\n]+)/gi) || [];
    for (const m of unresolvedMatches) {
      unresolved.add(m.replace(/^(?:BLOCKER|UNRESOLVED|FAILED):\s*/i, '').trim());
    }

    // Extract file paths
    const createdFiles = why.match(/(?:created|wrote|generated):\s*([^\n]+)/gi) || [];
    for (const m of createdFiles) {
      const path = m.replace(/^(?:created|wrote|generated):\s*/i, '').trim();
      if (path && path.length < 200) filesCreated.add(path);
    }

    const modifiedFiles = why.match(/(?:modified|updated|changed):\s*([^\n]+)/gi) || [];
    for (const m of modifiedFiles) {
      const path = m.replace(/^(?:modified|updated|changed):\s*/i, '').trim();
      if (path && path.length < 200) filesModified.add(path);
    }

    // Extract test counts
    const passMatch = why.match(/(\d+)\s*(?:tests?\s*)?pass(?:ed|ing)?/i);
    if (passMatch) testsPassed += parseInt(passMatch[1], 10);

    const failMatch = why.match(/(\d+)\s*(?:tests?\s*)?fail(?:ed|ing)?/i);
    if (failMatch) testsFailed += parseInt(failMatch[1], 10);

    // Task summary
    taskSummaries.push({
      step: task.step,
      what: task.what,
      state: task.chain_status || 'unknown',
      assigned_to: getAgentName(task.assigned_to),
    });
  }

  // Build condensed summary text
  const completedCount = chainTasks.filter(
    t => t.state === STATE.DONE || t.chain_status === 'completed'
  ).length;

  const summaryParts = [
    `${completedCount}/${chainTasks.length} tasks completed.`,
  ];
  if (decisions.size > 0) summaryParts.push(`Decisions: ${[...decisions].join('; ')}.`);
  if (resolved.size > 0) summaryParts.push(`Resolved: ${[...resolved].join('; ')}.`);
  if (unresolved.size > 0) summaryParts.push(`Unresolved: ${[...unresolved].join('; ')}.`);
  if (testsPassed > 0 || testsFailed > 0) {
    summaryParts.push(`Tests: ${testsPassed} passed, ${testsFailed} failed.`);
  }

  return {
    summary: summaryParts.join(' '),
    tasks: taskSummaries,
    decisions: [...decisions],
    resolved: [...resolved],
    unresolved: [...unresolved],
    artifacts: {
      files_created: [...filesCreated],
      files_modified: [...filesModified],
      tests_passed: testsPassed,
      tests_failed: testsFailed,
    },
  };
}

/**
 * Build a knowledge stack entry for a completed cycle.
 * Standardized format stored in knowledge_stack[] across cycles.
 *
 * ADR-101 Stage 2: Builder ready, used by triggerSupervisor() in Stage 3.
 *
 * @param {Object} params
 * @param {number} params.cycle - Cycle number (1-based)
 * @param {string} params.chainId - Chain ID for this cycle
 * @param {string} params.startedAt - ISO timestamp when cycle started
 * @param {Object} params.knowledgeSummary - Result from buildKnowledgeSummary()
 * @returns {Object} Knowledge stack entry
 */
function buildCycleKnowledgeEntry(params) {
  const { cycle, chainId, startedAt, knowledgeSummary } = params;

  return {
    cycle,
    chain_id: chainId,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    tasks_completed: knowledgeSummary.tasks.filter(t => t.state === 'completed').length,
    tasks_total: knowledgeSummary.tasks.length,
    summary: knowledgeSummary.summary,
    key_decisions: knowledgeSummary.decisions,
    blockers_resolved: knowledgeSummary.resolved,
    unresolved_issues: knowledgeSummary.unresolved,
    artifacts: knowledgeSummary.artifacts,
  };
}

/**
 * Format accumulated knowledge stack into a readable supervisor context string.
 * Used by triggerSupervisor() (Stage 3) to build the prompt for Nikich.
 *
 * ADR-101 Stage 2: Method ready, not yet called in production.
 *
 * @param {Object} params
 * @param {Array} params.knowledgeStack - Previous cycle knowledge entries
 * @param {Object} params.currentCycleKnowledge - Current cycle's buildKnowledgeSummary result
 * @param {string} params.originalGoal - Original task goal (never changes across cycles)
 * @param {number} params.cycleNumber - Current cycle number (1-based)
 * @param {string} params.chainId - Current chain ID
 * @returns {string} Formatted supervisor context
 */
function formatSupervisorContext(params) {
  const {
    knowledgeStack = [],
    currentCycleKnowledge = {},
    originalGoal = 'Unknown goal',
    cycleNumber = 1,
    chainId = '',
  } = params;

  const lines = [];
  const maxCycles = SUPERVISOR_CONFIG.max_cycles;

  lines.push(`[SUPERVISOR MODE — Cycle ${cycleNumber}/${maxCycles}]`);
  lines.push(`Goal: ${originalGoal}`);
  lines.push(`Current chain: ${chainId}`);
  lines.push('');

  // Previous cycles
  if (knowledgeStack.length > 0) {
    lines.push('=== PREVIOUS CYCLES ===');
    for (const entry of knowledgeStack) {
      lines.push(`--- Cycle ${entry.cycle} (${entry.chain_id}) ---`);
      lines.push(`Tasks: ${entry.tasks_completed}/${entry.tasks_total} completed`);
      if (entry.started_at && entry.completed_at) {
        lines.push(`Time: ${entry.started_at} → ${entry.completed_at}`);
      }
      lines.push(`Summary: ${entry.summary}`);
      if (entry.key_decisions?.length > 0) {
        lines.push(`Decisions: ${entry.key_decisions.join('; ')}`);
      }
      if (entry.blockers_resolved?.length > 0) {
        lines.push(`Resolved: ${entry.blockers_resolved.join('; ')}`);
      }
      if (entry.unresolved_issues?.length > 0) {
        lines.push(`⚠ Unresolved: ${entry.unresolved_issues.join('; ')}`);
      }
      if (entry.artifacts) {
        if (entry.artifacts.files_created?.length > 0) {
          lines.push(`Files created: ${entry.artifacts.files_created.join(', ')}`);
        }
        if (entry.artifacts.files_modified?.length > 0) {
          lines.push(`Files modified: ${entry.artifacts.files_modified.join(', ')}`);
        }
        lines.push(`Tests: ${entry.artifacts.tests_passed || 0} passed, ${entry.artifacts.tests_failed || 0} failed`);
      }
      lines.push('');
    }
  }

  // Current cycle
  lines.push('=== CURRENT CYCLE ===');
  lines.push(`Summary: ${currentCycleKnowledge.summary || 'No data'}`);
  if (currentCycleKnowledge.decisions?.length > 0) {
    lines.push(`Decisions: ${currentCycleKnowledge.decisions.join('; ')}`);
  }
  if (currentCycleKnowledge.resolved?.length > 0) {
    lines.push(`Resolved: ${currentCycleKnowledge.resolved.join('; ')}`);
  }
  if (currentCycleKnowledge.unresolved?.length > 0) {
    lines.push(`⚠ Unresolved: ${currentCycleKnowledge.unresolved.join('; ')}`);
  }
  if (currentCycleKnowledge.artifacts) {
    const a = currentCycleKnowledge.artifacts;
    if (a.files_created?.length > 0) lines.push(`Files created: ${a.files_created.join(', ')}`);
    if (a.files_modified?.length > 0) lines.push(`Files modified: ${a.files_modified.join(', ')}`);
    lines.push(`Tests: ${a.tests_passed || 0} passed, ${a.tests_failed || 0} failed`);
  }
  lines.push('');

  // Task details
  if (currentCycleKnowledge.tasks?.length > 0) {
    lines.push('Tasks in this cycle:');
    for (const t of currentCycleKnowledge.tasks) {
      lines.push(`  Step ${t.step}: [${t.state}] ${t.what} → ${t.assigned_to}`);
    }
    lines.push('');
  }

  // Decision instructions
  lines.push('=== YOUR DECISION ===');
  lines.push('Use the supervisor_decide tool with ONE of:');
  lines.push('  CONTINUE — unresolved tasks or failing tests. Provide next_cycle_plan.');
  lines.push('  COMPLETE — all acceptance criteria met. Provide final summary.');
  lines.push('  ESCALATE — blocker that agents cannot resolve. Provide blocker description.');

  return lines.join('\n');
}

// ----- ADR-101 STAGE 3: SUPERVISOR ENGINE -----

/**
 * T7 fix: Ensure the why field contains knowledge-parseable markers.
 * If no markers are present, appends a reminder template so agents
 * produce structured output that buildKnowledgeSummary() can parse.
 */
function _enforceKnowledgeMarkers(why) {
  if (!why || typeof why !== 'string') return why || '';
  const hasMarkers = /(?:DECISION|RESOLVED|FIXED|BLOCKER|UNRESOLVED|FAILED):/i.test(why);
  if (hasMarkers) return why;
  return why + '\n\n[When completing this task, include structured markers in your response: DECISION: <what you decided>, RESOLVED: <what you fixed>, BLOCKER: <unresolved issues>]';
}

/**
 * Trigger the Chain Supervisor (Nikich) at the configured step.
 * Collects all chain data, builds knowledge summary, and dispatches
 * a supervisor task with full memory.
 *
 * ADR-101 Stage 3: Core supervisor trigger.
 *
 * @param {Object} params
 * @param {string} params.chain_id - Current chain ID
 * @param {number} params.cycle_number - Current cycle number (1-based)
 * @param {string} params.cycle_group_id - Group ID shared across all cycles
 * @param {string} params.original_goal - Original task goal (never changes)
 * @param {Array} params.knowledge_stack - Previous cycle summaries
 * @returns {Promise<Object>} Supervisor ticket
 */
async function triggerSupervisor({ chain_id, cycle_number, cycle_group_id, original_goal, knowledge_stack, space_id }) {
  // T6 fix: Prevent concurrent supervisor triggers for the same chain
  if (_supervisorLocks.has(chain_id)) {
    apiLogger.warn({ chain_id, cycle_number }, 'ChainHandoff: Supervisor trigger already in progress for this chain — skipping duplicate');
    return { _supervisor: true, _duplicate: true, chain_id, cycle_number };
  }
  _supervisorLocks.add(chain_id);

  try {
  // 1. Gather all tasks in this chain
  const chainTasks = await this.getChainTasks(chain_id);
  const chainStatus = await this.getChainStatus(chain_id);

  // 2. Build knowledge summary for current cycle
  const currentSummary = buildKnowledgeSummary(chainTasks);

  // 3. Build cycle knowledge entry and append to stack
  const cycleEntry = buildCycleKnowledgeEntry({
    cycle: cycle_number,
    chainId: chain_id,
    startedAt: chainTasks[0]?.dispatched_at || new Date().toISOString(),
    knowledgeSummary: currentSummary,
  });

  const updatedStack = [...knowledge_stack, cycleEntry];

  // 4. Format context for supervisor prompt
  const supervisorContext = formatSupervisorContext({
    knowledgeStack: knowledge_stack,
    currentCycleKnowledge: currentSummary,
    originalGoal: original_goal,
    cycleNumber: cycle_number,
    chainId: chain_id,
  });

  // 5. Log cycle transition
  await this.logActivity({
    action: 'supervisor_triggered',
    agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
    chain_id,
    details: {
      cycle_number,
      cycle_group_id,
      tasks_in_cycle: chainTasks.length,
      completed: chainStatus.progress?.completed || 0,
      summary: currentSummary.summary.substring(0, 500),
    },
  });

  // 6. Dispatch supervisor task to Nikich (bypass normal dispatch to avoid re-trigger)
  const baseId = generateBaseId('ticket');
  const ticketData = {
    what: `[SUPERVISOR] Cycle ${cycle_number} analysis: ${original_goal.substring(0, 100)}`,
    why: supervisorContext,
    assigned_to: SUPERVISOR_CONFIG.supervisor_agent_id,
    priority: 24274, // high
    type: 24269,     // task
    state: STATE.BACKLOG,
    acceptance_criteria: 'Analyze cycle results and decide: CONTINUE / COMPLETE / ESCALATE',
    _chain: {
      chain_id,
      step: SUPERVISOR_CONFIG.trigger_at_step,
      dispatched_by: AGENT_USERS.ORCHESTRATOR,
      dispatched_at: new Date().toISOString(),
      status: 'dispatched',
    },
    _chain_memory: {
      cycle_number,
      cycle_group_id,
      parent_chain_id: chain_id,
      knowledge_stack: updatedStack,
      original_goal,
    },
  };

  const dataJson = JSON.stringify(ticketData);
  let result;
  if (isPostgres()) {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW()) RETURNING id`,
      [TICKETS_TABLE_ID, baseId, dataJson]
    );
  } else {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [TICKETS_TABLE_ID, baseId, dataJson]
    );
  }

  const ticketId = result?.lastInsertRowid || result?.rows?.[0]?.id;

  apiLogger.info({
    ticketId,
    chain_id,
    cycle_number,
    cycle_group_id,
  }, 'ChainHandoff: Supervisor triggered (ADR-101)');

  // === T4 fix: Schedule timeout fallback if Nikich doesn't pick up ===
  const supervisorTimeoutMs = SUPERVISOR_CONFIG.supervisor_timeout_ms || 10 * 60 * 1000; // 10 min default
  setTimeout(async () => {
    try {
      // Check if supervisor ticket is still in BACKLOG (not picked up)
      const ticket = await this.getTicket(ticketId);
      const tData = typeof ticket?.data === 'string' ? JSON.parse(ticket.data) : (ticket?.data || {});
      if (tData.state === STATE.BACKLOG) {
        apiLogger.warn({ ticketId, chain_id, cycle_number },
          'ChainHandoff: Supervisor timeout — Nikich offline, auto-escalating');
        await this.autoEscalate(chain_id, ticketData._chain_memory, 'SUPERVISOR_TIMEOUT', space_id);
      }
    } catch (timeoutErr) {
      apiLogger.error({ err: timeoutErr, ticketId },
        'ChainHandoff: Supervisor timeout check failed');
    }
  }, supervisorTimeoutMs);

  return {
    ticket_id: ticketId,
    chain_id,
    step: SUPERVISOR_CONFIG.trigger_at_step,
    cycle_number,
    cycle_group_id,
    state: STATE.BACKLOG,
    assigned_to: SUPERVISOR_CONFIG.supervisor_agent_id,
    what: ticketData.what,
    data: ticketData,
    _supervisor: true, // flag for callers to know this is a supervisor ticket
  };

  } finally {
    // T6 fix: Release lock after supervisor trigger completes (or fails)
    _supervisorLocks.delete(chain_id);
  }
}

/**
 * Start a new chain cycle with accumulated knowledge.
 * Creates a new chain_id, resets step to 1, carries forward full memory.
 *
 * ADR-101 Stage 3: Cycle restart with memory propagation.
 *
 * @param {Object} params
 * @param {string} params.cycle_group_id - Shared group ID across all cycles
 * @param {number} params.cycle_number - New cycle number (1-based)
 * @param {Array} params.knowledge_stack - All previous cycle summaries
 * @param {string} params.original_goal - Original task goal (constant)
 * @param {string} params.next_cycle_plan - Plan text from supervisor's decision
 * @param {Array<Object>} params.tasks - Task list [{what, assigned_to, why?, priority?}]
 * @returns {Promise<Object>} New chain with all dispatched tasks
 */
async function startNewCycle({ cycle_group_id, cycle_number, knowledge_stack, original_goal, next_cycle_plan, tasks }) {
  const newChainId = generateChainId();

  // Log new cycle start
  await this.logActivity({
    action: 'cycle_started',
    agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
    chain_id: newChainId,
    details: {
      cycle_number,
      cycle_group_id,
      parent_chain_id: knowledge_stack[knowledge_stack.length - 1]?.chain_id,
      plan: next_cycle_plan?.substring(0, 500),
      tasks_count: tasks.length,
    },
  });

  // ADR-109 Part D: FYI notification at cycle 3+ (non-blocking audit trail)
  if (cycle_number >= 3) {
    try {
      await this.logActivity({
        action: 'cycle_fyi_notification',
        agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
        chain_id: newChainId,
        details: {
          cycle: cycle_number,
          cycle_group_id,
          original_goal: original_goal?.substring(0, 200),
          message: `Cycle ${cycle_number} started, human may want to review`,
        },
      });
      apiLogger.info({ cycle_number, cycle_group_id, newChainId },
        'ChainHandoff: Cycle 3+ FYI notification logged (ADR-109)');
    } catch (err) {
      // Non-blocking — FYI logging should never break the cycle
      apiLogger.warn({ err, cycle_number }, 'ChainHandoff: Failed to log cycle FYI notification');
    }
  }

  // Dispatch tasks with memory propagation (max trigger_at_step - 1 tasks)
  const maxTasks = SUPERVISOR_CONFIG.trigger_at_step - 1; // 8 tasks max
  const results = [];
  for (let i = 0; i < tasks.length && i < maxTasks; i++) {
    const task = tasks[i];
    const result = await this.dispatchSubtask({
      what: task.what,
      why: _enforceKnowledgeMarkers(task.why || `[Cycle ${cycle_number}] ${next_cycle_plan || ''}`.substring(0, 500)),
      assigned_to: task.assigned_to,
      priority: task.priority || 24274,
      chain_id: newChainId,
      step: i + 1,
      dispatched_by: SUPERVISOR_CONFIG.supervisor_agent_id,
      _chain_memory: {
        cycle_number,
        cycle_group_id,
        parent_chain_id: knowledge_stack[knowledge_stack.length - 1]?.chain_id,
        knowledge_stack,
        original_goal,
      },
    });
    results.push(result);
  }

  apiLogger.info({
    newChainId,
    cycle_number,
    cycle_group_id,
    tasksDispatched: results.length,
  }, 'ChainHandoff: New cycle started (ADR-101)');

  return {
    chain_id: newChainId,
    cycle_number,
    cycle_group_id,
    original_goal,
    tasks: results,
  };
}

/**
 * Auto-escalate when safety limits are breached.
 * Creates an escalation ticket with full cycle history.
 *
 * ADR-101 Stage 3: Safety guard escalation.
 *
 * @param {string} chain_id - Current chain ID
 * @param {Object} memory - Chain memory object (_chain_memory)
 * @param {string} reason - Escalation reason code
 * @returns {Promise<Object>} Escalation ticket
 */
async function autoEscalate(chain_id, memory, reason) {
  const reasonMessages = {
    MAX_CYCLES_REACHED: `Maximum cycles reached (${SUPERVISOR_CONFIG.max_cycles})`,
    MAX_DURATION_REACHED: `Maximum duration reached (${SUPERVISOR_CONFIG.max_duration_ms / 3600000}h)`,
    MAX_TASKS_REACHED: `Maximum total tasks reached (${SUPERVISOR_CONFIG.max_total_tasks})`,
    SUPERVISOR_TIMEOUT: `Supervisor (Nikich) did not pick up within timeout (${(SUPERVISOR_CONFIG.supervisor_timeout_ms || 600000) / 60000} min)`,
  };

  const report = [
    `AUTO-ESCALATION: ${reasonMessages[reason] || reason}`,
    '',
    `Goal: ${memory.original_goal || 'unknown'}`,
    `Cycles completed: ${memory.cycle_number || 0}`,
    `Cycle group: ${memory.cycle_group_id || 'unknown'}`,
    '',
    '--- Knowledge from all cycles ---',
    ...(memory.knowledge_stack || []).map(k =>
      `Cycle ${k.cycle}: ${k.summary || 'no summary'}`
    ),
  ].join('\n');

  await this.logActivity({
    action: 'supervisor_auto_escalate',
    agent_id: SUPERVISOR_CONFIG.supervisor_agent_id,
    chain_id,
    details: {
      reason,
      cycle_number: memory.cycle_number,
      cycle_group_id: memory.cycle_group_id,
      original_goal: memory.original_goal,
    },
  });

  apiLogger.warn({
    chain_id,
    reason,
    cycle_number: memory.cycle_number,
  }, 'ChainHandoff: Auto-escalation triggered (ADR-101)');

  // Create escalation ticket assigned to orchestrator for human review
  const baseId = generateBaseId('ticket');
  const ticketData = {
    what: `[ESCALATION] ${reasonMessages[reason] || reason}: ${(memory.original_goal || '').substring(0, 80)}`,
    why: report,
    assigned_to: AGENT_USERS.ORCHESTRATOR,
    priority: 24274,
    type: 24269,
    state: STATE.BACKLOG,
    _chain: {
      chain_id,
      step: SUPERVISOR_CONFIG.trigger_at_step,
      dispatched_by: SUPERVISOR_CONFIG.supervisor_agent_id,
      dispatched_at: new Date().toISOString(),
      status: 'escalated',
    },
    _chain_memory: memory,
    _escalation: {
      reason,
      escalated_at: new Date().toISOString(),
      auto: true,
    },
  };

  const dataJson = JSON.stringify(ticketData);
  let result;
  if (isPostgres()) {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW()) RETURNING id`,
      [TICKETS_TABLE_ID, baseId, dataJson]
    );
  } else {
    result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [TICKETS_TABLE_ID, baseId, dataJson]
    );
  }

  const ticketId = result?.lastInsertRowid || result?.rows?.[0]?.id;

  return {
    ticket_id: ticketId,
    chain_id,
    step: SUPERVISOR_CONFIG.trigger_at_step,
    state: STATE.BACKLOG,
    assigned_to: AGENT_USERS.ORCHESTRATOR,
    what: ticketData.what,
    data: ticketData,
    _escalation: true,
  };
}

export {
  buildKnowledgeSummary,
  buildCycleKnowledgeEntry,
  formatSupervisorContext,
  triggerSupervisor,
  startNewCycle,
  autoEscalate,
};
