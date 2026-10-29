/**
 * AgentJobService — Create Module
 *
 * createAndDispatchJob and processJobLocally (the core job execution loop).
 */

import { dbGet, dbRun, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { saveStepMessage, updateAgentStatus, finalizeAgentStatus } from '../AgentLoopService.js';
import { setContextUsage, clearContextUsage } from './liveContextUsage.js';
import {
  resolveAgentProvider,
  detectProvider,
  buildAgentSystemPrompt,
  loadConversationHistory,
  fetchBoundRowContext,
  fetchAgentSkills,
  setConversationProcessing,
  handleManagePlan,
} from '../chat/agent-execution-shared.js';
import { logAgentActivity } from '../AgentActivityLogger.js';
import { isShuttingDown } from './lifecycle.js';
import { updateJobStatus, failJob, updateJobAttempts, safeParse, mapTodoStatus, JOB_STATUS, JOB_TIMEOUT_MS, MAX_ATTEMPTS, TICKET_STATE } from './shared.js';
import { reserveAgentJob, finishOrContinueJob } from './single-active.js';
import { getJob } from './query.js';
import { isAuthError, isAuthErrorBlock, extractRequestId } from './auth-error.js';
import { resolveRunTimeoutMs } from '../agent-loop/run-timeout.js';

// ADR-117: dynamic import of invocation-dispatcher to avoid circular load
// (create.js -> dispatcher -> chatAgentExecution -> chatShared -> agent-execution-shared -> create.js).
async function _maybeDispatchFromAgentText(content, dispatchCtx) {
  if (!content) return;
  try {
    const { hasInvocationTokens, dispatchInvocationsFromContent } = await import('../chat/invocation-dispatcher.js');
    if (!hasInvocationTokens(content)) return;
    await dispatchInvocationsFromContent({
      content,
      ...dispatchCtx,
    });
  } catch (err) {
    apiLogger.error({ err: err.message, ...dispatchCtx }, 'AgentJobService: invocation dispatch failed');
  }
}

/**
 * Create a new agent job and dispatch it.
 *
 * @param {Object} params
 * @param {number} params.conversationId - The conversation where the agent was triggered
 * @param {Object} params.agent - Agent user object (with _agentConfig, managed_by_agent_row_id, etc.)
 * @param {number} params.triggeredByUserId - User who triggered the agent
 * @param {string} params.messageContent - The message that triggered the agent
 * @param {Object} params.options - Additional options (agent_mode, thinking_enabled, attachments, etc.)
 * @param {number|null} params.triggerMessageId - ID of the message that triggered this job
 * @returns {Promise<{jobId: string, id: number}>} Created job info
 */
export async function createAndDispatchJob({
  conversationId,
  agent,
  triggeredByUserId,
  messageContent,
  options = {},
  triggerMessageId = null,
  ticketId = null,
  statusMessageId = null,
  createStatusPlaceholder = null,
  invocationType = null,
  // ADR-0057 WP-A: idempotent redispatch lineage. When set, the new job is
  // linked to the original via `recovered_from_job_id`, and the unique partial
  // index (recovered_from_job_id, restart_attempt) blocks duplicate recovery
  // INSERTs cleanly. Defaults preserve legacy (non-recovery) behavior.
  recoveredFromJobId = null,
  restartAttempt = 0,
}) {
  const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
  const agentUserId = agent.id || null;
  const agentName = agent.name || agent._agentConfig?.name || 'Unknown Agent';

  // 1. Create the job row
  const timeoutAt = new Date(Date.now() + JOB_TIMEOUT_MS).toISOString();
  const contextData = JSON.stringify({
    agent_mode: options.agent_mode || 'agent',
    thinking_enabled: options.thinking_enabled || false,
    attachments: options.attachments || [],
    attachmentBaseUrl: options.attachmentBaseUrl || '',
    message_content: messageContent,
    invocation_type: invocationType || null,
  });

  // ADR-0057 WP-A: persist lineage columns when supplied. On the unique-index
  // collision (idx_agent_jobs_recovery_chain) the DB throws 23505 and the
  // caller in lifecycle.js logs+aborts — exactly the idempotent behavior we want.
  const jobRow = await reserveAgentJob({
    conversationId, agentRowId, agentUserId,
    message: recoveredFromJobId != null ? null : { content: messageContent, attachments: options.attachments || [],
      attachmentBaseUrl: options.attachmentBaseUrl || '', userId: triggeredByUserId,
      triggerMessageId, invocationType },
  }, async tx => {
    let result;
    try {
      result = await tx.run(
        isPostgres()
          ? `INSERT INTO agent_jobs
             (conversation_id, agent_row_id, agent_user_id, agent_name, status,
              trigger_message_id, trigger_user_id, context, max_attempts, timeout_at,
              recovered_from_job_id, restart_attempt, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12, NOW())
             RETURNING id, job_id`
          : `INSERT INTO agent_jobs
             (conversation_id, agent_row_id, agent_user_id, agent_name, status,
              trigger_message_id, trigger_user_id, context, max_attempts, timeout_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        isPostgres()
          ? [conversationId, agentRowId, agentUserId, agentName, JOB_STATUS.PENDING,
             triggerMessageId, triggeredByUserId, contextData, MAX_ATTEMPTS, timeoutAt,
             recoveredFromJobId, restartAttempt]
          : [conversationId, agentRowId, agentUserId, agentName, JOB_STATUS.PENDING,
             triggerMessageId, triggeredByUserId, contextData, MAX_ATTEMPTS, timeoutAt]
      );
    } catch (insertErr) {
      if (insertErr.code === '23505' && recoveredFromJobId != null) {
        apiLogger.info(
          { conversationId, agentName, recoveredFromJobId, restartAttempt },
          'AgentJobService: redispatch lost the race (unique chain collision) — peer is in flight, skipping'
        );
        return { jobId: null, id: null, skipped: true, reason: 'idempotent_recovery' };
      }
      throw insertErr;
    }

    // dbRun returns { changes, lastInsertRowid } — use lastInsertRowid to fetch the full row
    const insertedId = result?.lastInsertRowid;
    return tx.get(
      isPostgres()
        ? `SELECT id, job_id FROM agent_jobs WHERE id = $1`
        : `SELECT id, job_id FROM agent_jobs WHERE id = ?`,
      [insertedId]
    );

  });
  if (jobRow.skipped) return jobRow;
  if (createStatusPlaceholder) statusMessageId = await createStatusPlaceholder();

  const jobId = jobRow?.job_id;
  const jobDbId = jobRow?.id;

  apiLogger.info({
    jobId, jobDbId, conversationId, agentName, agentRowId, triggeredByUserId
  }, 'AgentJobService: Job created');

  // 2. Set conversation processing state
  await setConversationProcessing(conversationId, true, agentName, agentRowId);

  // 3. Log activity
  logAgentActivity({
    agent_id: agentName,
    action: 'task_started',
    details: `Async job ${jobId} created for conversation ${conversationId}`,
    success: true,
    conversation_id: conversationId,
  });

  // 4. Dispatch the local worker (fire-and-forget). invocation_type rides along
  // so the worker can pick the D4 timeout for /command runs (Bug 1552/228714).
  processJobLocally(jobDbId, agent, conversationId, messageContent, { ...options, invocation_type: invocationType || null }, ticketId, statusMessageId, triggeredByUserId).catch(err => {
    apiLogger.error({ err, jobId, jobDbId }, 'AgentJobService: Local worker failed');
  });

  return { jobId, id: jobDbId };
}

/**
 * Process a job locally using Claude Code CLI (child_process.spawn).
 * This reuses the existing executeClaudeCode() from ai-execution-service.js.
 *
 * @param {number} jobDbId - Database row ID of the job
 * @param {Object} agent - Agent user object
 * @param {number} conversationId - Conversation ID
 * @param {string} messageContent - User message
 * @param {Object} options - Execution options
 */
async function processJobLocally(jobDbId, agent, conversationId, messageContent, options = {}, ticketId = null, statusMessageId = null, triggeredByUserId = null) {
  const { agent_mode = 'agent', thinking_enabled = false, attachments = [], attachmentBaseUrl = '', invocation_type = null } = options;
  const _startTime = Date.now();

  try {
    // Mark job as processing
    await updateJobStatus(jobDbId, JOB_STATUS.PROCESSING);
    // A failed attempt clears processing; every retry must restore the live state.
    await setConversationProcessing(
      conversationId, true,
      agent.name || agent._agentConfig?.name || 'AI Agent',
      agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null,
    );

    // Update agent status placeholder if available
    if (statusMessageId) {
      updateAgentStatus(statusMessageId, 'thinking', 'Loading agent config...', { job_db_id: jobDbId })
        .catch(err => apiLogger.error({ err }, 'AgentJobService: Failed to update status placeholder'));
    }

    // Load agent config
    let agentConfig = {};
    if (agent._agentConfig) {
      agentConfig = agent._agentConfig;
    } else if (agent.managed_by_agent_row_id) {
      const agentRow = await dbGet(
        isPostgres()
          ? `SELECT data FROM table_rows WHERE id = $1`
          : `SELECT data FROM table_rows WHERE id = ?`,
        [agent.managed_by_agent_row_id]
      );
      if (agentRow) {
        agentConfig = safeParse(agentRow.data, {});
      }
    }

    // Resolve provider
    const resolved = await resolveAgentProvider(agentConfig);
    const { isClaudeCode, isCodex, isKimi, isCliAgent } = detectProvider(resolved.provider, resolved.model);

    if (!isCliAgent) {
      throw new Error(`AgentJobService: Expected a CLI provider (claude-code|codex|kimi-code) but got ${resolved.provider}`);
    }

    // Load conversation history
    const formattedHistory = await loadConversationHistory(conversationId, agentConfig, agent.id);

    // Enrich user message with attachments (URL + local path for CLI agents)
    let enrichedMessage = messageContent;
    if (attachments && attachments.length > 0) {
      const baseUrl = attachmentBaseUrl || process.env.BASE_URL_FOR_ATTACHMENTS || 'https://crm.hltrn.cc';
      const uploadsRoot = process.env.UPLOADS_DIR || '/var/lib/business-crm-data/uploads';
      const attachmentDescs = attachments.map(a => {
        const url = a.url?.startsWith('http') ? a.url : `${baseUrl}${a.url || ''}`;
        // Provide local filesystem path so CLI agent can read/convert images directly
        const relPath = (a.url || '').replace(/^\/uploads\//, '');
        const localPath = relPath ? `${uploadsRoot}/${relPath}` : '';
        return `- ${a.name || a.original_name || 'file'} (${a.mime_type || a.type || 'unknown'}): ${url}${localPath ? `\n  Local: ${localPath}` : ''}`;
      }).join('\n');
      enrichedMessage = `${messageContent}\n\n[Attached files]\n${attachmentDescs}`;
    }

    // Build system prompt
    const boundRowContext = await fetchBoundRowContext(conversationId);
    const convForSpace = await dbGet(
      isPostgres()
        ? `SELECT space_id, created_by FROM conversations WHERE id = $1`
        : `SELECT space_id, created_by FROM conversations WHERE id = ?`,
      [conversationId]
    );

    // Bug #137199: never fall back to senderId (the agent's own user id) for invocation
    // dispatch — that leaks one agent's execution context onto the next. Prefer the real
    // human trigger; otherwise the conversation owner; otherwise null.
    const invokerUserId = triggeredByUserId || convForSpace?.created_by || null;

    // ADR-0056: hydrate workflow-skill bodies (table 1790, slugs in tools[])
    // + S05 skills_registry sources, then inject into system prompt.
    const skillAgentRowId = agentConfig.row_id || agentConfig.id || null;
    const injectedSkills = await fetchAgentSkills(
      skillAgentRowId,
      convForSpace?.space_id || null,
      agentConfig.tools || agentConfig.allowed_tools || null,
    );
    if (injectedSkills.length > 0) {
      apiLogger.info(
        { agentRowId: skillAgentRowId, skillCount: injectedSkills.length, skillNames: injectedSkills.map(s => s.name) },
        'ADR-0056: Injecting bound skills into claude-code agent system prompt'
      );
    }

    const systemPrompt = await buildAgentSystemPrompt(agentConfig, {
      spaceId: convForSpace?.space_id || null,
      conversationId,
      boundRow: boundRowContext,
      agentMode: agent_mode,
      skills: injectedSkills,
      // ADR-113 follow-up (#81861): builder names the planning tool that exists in
      // this host — claude-code → TodoWrite, native loop → manage_plan.
      // Since the codex provider landed this path is CLI-but-not-always-claude-code,
      // so the real flag has to be passed through: Codex uses the runtime-bound
      // CRM MCP manage_plan tool; Claude retains the TodoWrite bridge.
      isClaudeCode,
      planRunId: `job:${jobDbId}`,
      planAgentId: agent.managed_by_agent_row_id || agentConfig.row_id,
    }, 'account');

    // Build messages array for the CLI executor
    const messages = [
      ...formattedHistory,
      { role: 'user', content: enrichedMessage }
    ];

    // Resolve sender info
    const agentRowId = agent.managed_by_agent_row_id || agent._agentConfig?.row_id || null;
    const senderId = agent.id || null;
    const agentName = agent.name || agent._agentConfig?.name || 'AI Agent';

    // Import the CLI executor set directly from the default export
    // (executeClaudeCode / executeCodexCli / executeKimiCli)
    const aiExecutionService = (await import('../labs/ai-execution-service.js')).default;

    // Save step messages as they come in (real-time streaming)
    // Bug fix: Save ALL step types — tool_call, tool_result, AND thinking
    // ADR-104: Include metadata in ALL step messages for proper agent name display
    const stepMetadata = JSON.stringify({
      agent_name: agentName,
      agent_icon: agent._agentConfig?.icon || agent._agentConfig?.emoji || null,
      agent_color: agent._agentConfig?.color || null,
      agent_row_id: agentRowId,
      job_id: jobDbId,
    });

    // Event counters for diagnostics
    let _eventCounts = { assistant: 0, user: 0, result: 0, tool_call: 0, tool_result: 0, thinking: 0, text: 0, unknown: 0, system: 0, rate_limit_event: 0 };

    // Track tool counts for status placeholder updates
    let _toolsUsed = 0;
    let _toolsCompleted = 0;
    let planWrites = Promise.resolve();

    const onEvent = (event) => {
      // Count all events for diagnostics
      _eventCounts[event.type] = (_eventCounts[event.type] || 0) + 1;

      if (event.type === 'assistant' && event.message) {
        _eventCounts.assistant++;
        // Save tool_use and thinking steps in real-time
        const contentBlocks = event.message?.content || [];
        for (const block of contentBlocks) {
          if (block.type === 'tool_use') {
            _eventCounts.tool_call++;
            _toolsUsed++;
            // Update status placeholder with current tool
            if (statusMessageId) {
              updateAgentStatus(statusMessageId, 'tool_call', `Using ${block.name}...`, {
                tools_used: _toolsUsed,
                tools_completed: _toolsCompleted,
              }).catch(() => {});
            }
            saveStepMessage(conversationId, {
              content: JSON.stringify({ tool: block.name, input: block.input }),
              contentType: 'tool_call',
              role: 'assistant',
              senderType: 'agent',
              agentId: agentRowId,
              senderId,
              metadata: stepMetadata,
            }).catch(err => apiLogger.error({ err, jobDbId, block: 'tool_call' }, 'AgentJobService: Failed to save tool_call step'));

            // Ticket #81861: Bridge TodoWrite → plan messages
            // Claude Code agents call TodoWrite instead of manage_plan.
            // Intercept and create plan messages via handleManagePlan().
            apiLogger.info({ toolName: block.name, jobDbId, conversationId }, 'AgentJobService: DEBUG tool_use block received');
            if (block.name === 'TodoWrite') {
              const todoArgs = block.input || {};
              const todos = todoArgs.todos || [];
              apiLogger.info({ todoCount: todos.length, jobDbId, conversationId }, 'AgentJobService: DEBUG TodoWrite intercepted');
              const tasks = todos.map((t, i) => ({
                id: i + 1,
                title: t.content || t.title || `Task ${i + 1}`,
                status: mapTodoStatus(t.status),
                ...(t.note ? { note: t.note } : {}),
              }));
              if (tasks.length > 0) {
                apiLogger.info({ taskCount: tasks.length, conversationId, agentName }, 'AgentJobService: DEBUG calling handleManagePlan');
                planWrites = planWrites.then(() => handleManagePlan({ tasks }, conversationId, agentName, { agentId: agentRowId, senderId, jobId: jobDbId, runId: `job:${jobDbId}` }))
                  .then(result => apiLogger.info({ result, conversationId }, 'AgentJobService: DEBUG handleManagePlan succeeded'))
                  .catch(err => apiLogger.error({ err, jobDbId, block: 'TodoWrite_plan_bridge' }, 'AgentJobService: Failed to bridge TodoWrite to plan'));
              }
            }
          } else if (block.type === 'thinking' && block.thinking) {
            // ADR-0057 WP-B (step-level): the CLI leaks Anthropic 401s as a
            // thinking block during OAuth-token rotation. Suppress it — don't
            // persist as a chat bubble, don't count it as step output (else the
            // empty-result safety net is skipped → no final text), don't dispatch.
            if (isAuthErrorBlock(block)) {
              apiLogger.warn(
                { jobDbId, conversationId, agentName, requestId: extractRequestId(block.thinking) },
                'ADR-0057 WP-B: CLI auth error in thinking step — suppressed from chat'
              );
              continue;
            }
            _eventCounts.thinking++;
            saveStepMessage(conversationId, {
              content: block.thinking,
              contentType: 'thinking',
              role: 'assistant',
              senderType: 'agent',
              agentId: agentRowId,
              senderId,
              metadata: stepMetadata,
            }).then(msgId => {
              // ADR-117: dispatch invocations from real thinking blocks
              _maybeDispatchFromAgentText(block.thinking, {
                conversationId,
                userId: invokerUserId,
                spaceId: convForSpace?.space_id || null,
                sourceAgentId: senderId || null,
                sourceLabel: 'thinking',
                sourceMessageId: msgId,
              });
            }).catch(err => apiLogger.error({ err, jobDbId, block: 'thinking' }, 'AgentJobService: Failed to save thinking step'));
          } else if (block.type === 'text' && block.text) {
            // ADR-0057 WP-B (step-level): same 401 leak, surfaced as a text block.
            if (isAuthErrorBlock(block)) {
              apiLogger.warn(
                { jobDbId, conversationId, agentName, requestId: extractRequestId(block.text) },
                'ADR-0057 WP-B: CLI auth error in text step — suppressed from chat'
              );
              continue;
            }
            _eventCounts.text++;
            saveStepMessage(conversationId, {
              content: block.text,
              contentType: 'thinking',
              role: 'assistant',
              senderType: 'agent',
              agentId: agentRowId,
              senderId,
              metadata: stepMetadata,
            }).then(msgId => {
              // ADR-117: dispatch invocations from streamed text blocks (pre-final)
              _maybeDispatchFromAgentText(block.text, {
                conversationId,
                userId: invokerUserId,
                spaceId: convForSpace?.space_id || null,
                sourceAgentId: senderId || null,
                sourceLabel: 'stream_text',
                sourceMessageId: msgId,
              });
            }).catch(err => apiLogger.error({ err, jobDbId, block: 'text_as_thinking' }, 'AgentJobService: Failed to save text step'));
          }
        }
      } else if (event.type === 'user' && event.message?.content) {
        _eventCounts.user++;
        // Save tool_result steps — these are responses to tool_use calls
        const contentBlocks = Array.isArray(event.message.content)
          ? event.message.content : [event.message.content];
        for (const block of contentBlocks) {
          if (block.type === 'tool_result') {
            _eventCounts.tool_result++;
            _toolsCompleted++;
            // Update status placeholder with completed tool
            if (statusMessageId) {
              updateAgentStatus(statusMessageId, 'thinking', 'Processing...', {
                tools_used: _toolsUsed,
                tools_completed: _toolsCompleted,
              }).catch(() => {});
            }
            const resultContent = typeof block.content === 'string'
              ? block.content : JSON.stringify(block.content);
            const truncated = resultContent.length > 2000
              ? resultContent.substring(0, 2000) + '...' : resultContent;
            saveStepMessage(conversationId, {
              content: truncated,
              contentType: 'tool_result',
              role: 'tool',
              senderType: 'agent',
              agentId: agentRowId,
              senderId,
              metadata: stepMetadata,
              toolResults: { tool_use_id: block.tool_use_id, content: truncated },
            }).catch(err => apiLogger.error({ err, jobDbId, block: 'tool_result' }, 'AgentJobService: Failed to save tool_result step'));
          }
        }
      } else if (event.type === 'result') {
        _eventCounts.result++;
        apiLogger.info({ jobDbId, conversationId, eventCounts: _eventCounts }, 'AgentJobService: Received result event — final event counts');
      } else {
        _eventCounts.unknown++;
        apiLogger.debug({ jobDbId, eventType: event.type, hasMessage: !!event.message }, 'AgentJobService: Unknown event type');
      }
    };

    // Call the CLI executor directly — it spawns the agent CLI process.
    // executeCodexCli translates codex's JSONL into the same stream-json event
    // shape onEvent above already parses, so only the function differs.
    // Pass maxTurns from agent config (maxSteps / max_iterations / max_turns)
    const agentMaxTurns = Number(agentConfig.maxSteps) || Number(agentConfig.max_steps) || Number(agentConfig.max_turns) || Number(agentConfig.max_iterations) || 0;

    // FIX-B: onSpawn callback writes the CLI child PID to the agent_jobs row.
    // This enables orphan process detection and monitoring.
    const onSpawn = (pid) => {
      dbRun(
        isPostgres()
          ? `UPDATE agent_jobs SET worker_pid = $1 WHERE id = $2`
          : `UPDATE agent_jobs SET worker_pid = ? WHERE id = ?`,
        [pid, jobDbId]
      ).catch(err => apiLogger.error({ err, jobDbId, pid }, 'AgentJobService: Failed to write worker_pid'));

      // Update agent status placeholder with worker PID
      if (statusMessageId) {
        updateAgentStatus(statusMessageId, 'thinking', 'Agent processing...', { job_db_id: jobDbId })
          .catch(err => apiLogger.error({ err }, 'AgentJobService: Failed to update status with PID'));
      }
    };

    const runCli = isCodex
      ? aiExecutionService.executeCodexCli
      : isKimi
        ? aiExecutionService.executeKimiCli
        : aiExecutionService.executeClaudeCode;

    const result = await runCli({
      model: resolved.model,
      messages,
      systemPrompt,
      maxTokens: 8192,
      maxTurns: agentMaxTurns || undefined,
      onEvent,
      onSpawn,
      jobId: jobDbId,
      // ADR-0053 Phase C3: hook context for _command_policies resolver.
      agentId: agentRowId,
      spaceId: convForSpace?.space_id || null,
      // Bug 1552/228714: agent row `run_timeout_min`, else 10 min for /command, 30 otherwise.
      runTimeoutMs: resolveRunTimeoutMs(agentConfig, invocation_type),
    });

    await planWrites;

    // Save the final response
    const responseContent = result?.content || '';
    const messageMetadata = JSON.stringify({
      agent_name: agentName,
      agent_icon: agent._agentConfig?.icon || agent._agentConfig?.emoji || null,
      agent_color: agent._agentConfig?.color || null,
      agent_row_id: agentRowId,
      job_id: jobDbId,
      cost_usd: result?.costUsd || 0,
      tokens_used: result?.usage?.totalTokens || 0,
    });

    // Determine if the agent already produced visible output via onEvent step messages.
    // Claude Code CLI agents often end on a tool_call turn without a final text response,
    // leaving result.result empty. In that case, all the real work (tool_calls, tool_results,
    // thinking) was already saved to chat by onEvent — no safety-net message needed.
    const hasStepOutput = (_eventCounts.tool_call > 0 || _eventCounts.text > 0 || _eventCounts.thinking > 0);

    // ADR-0057 WP-B: short-circuit Anthropic auth-error responses before they
    // land as chat text. These leak when the OAuth token rotates mid-run during
    // parallel CLI processes (see jobs 11022/11023/11024 incident 2026-05-12).
    if (responseContent && isAuthError(responseContent)) {
      const requestId = extractRequestId(responseContent);
      apiLogger.warn(
        { conversationId, jobDbId, agentName, requestId, snippet: responseContent.slice(0, 200) },
        'ADR-0057 WP-B: CLI auth error caught — routing to agent_status, not chat text'
      );

      const authMetadata = JSON.stringify({
        agent_name: agentName,
        agent_icon: agent._agentConfig?.icon || agent._agentConfig?.emoji || null,
        agent_color: agent._agentConfig?.color || null,
        agent_row_id: agentRowId,
        job_id: jobDbId,
        agent_status: 'auth_failure',
        agent_action: 'Auth error — Anthropic token rotated, recovery will retry',
        placeholder: false,
        action_kind: 'auth_failure',
        error_detail: responseContent.slice(0, 1000),
        request_id: requestId,
      });

      if (statusMessageId) {
        await updateAgentStatus(statusMessageId, 'auth_failure', 'Auth error — token rotated, retrying', {
          job_db_id: jobDbId,
        }).catch((err) => apiLogger.error({ err }, 'ADR-0057: failed to update status placeholder to auth_failure'));
        // Layer the auth-error detail onto the placeholder so the UI/analytics see it.
        await dbRun(
          isPostgres()
            ? `UPDATE messages
                 SET metadata = jsonb_set(jsonb_set(metadata, '{action_kind}', '"auth_failure"'::jsonb), '{error_detail}', $1::jsonb),
                     updated_at = NOW()
               WHERE id = $2`
            : `UPDATE messages SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
          isPostgres()
            ? [JSON.stringify(responseContent.slice(0, 1000)), statusMessageId]
            : [authMetadata, statusMessageId]
        ).catch((err) => apiLogger.error({ err }, 'ADR-0057: failed to layer auth-error detail on placeholder'));
      } else {
        // No placeholder — write a fresh agent_status row so the user sees the pill.
        await saveStepMessage(conversationId, {
          content: 'Auth error — Anthropic token rotated, recovery will retry',
          contentType: 'agent_status',
          role: 'assistant',
          senderType: 'agent',
          agentId: agentRowId,
          senderId,
          metadata: authMetadata,
        }).catch((err) => apiLogger.error({ err }, 'ADR-0057: failed to save fresh auth-error agent_status'));
      }

      await failJob(jobDbId, 'CLI auth error — OAuth token rotated mid-run; safe to retry');
      await dbRun(
        isPostgres()
          ? `UPDATE agent_jobs SET result_metadata = COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object('auth_error', true, 'request_id', $1::text) WHERE id = $2`
          : `UPDATE agent_jobs SET result_metadata = ? WHERE id = ?`,
        isPostgres()
          ? [requestId, jobDbId]
          : [JSON.stringify({ auth_error: true, request_id: requestId }), jobDbId]
      ).catch((err) => apiLogger.error({ err, jobDbId }, 'ADR-0057: failed to flag job.result_metadata.auth_error'));

      // Clear conversation processing state so the chat unblocks immediately.
      await setConversationProcessing(conversationId, false);

      logAgentActivity({
        agent_id: agentName,
        action: 'auth_error',
        details: `Anthropic 401 (request_id=${requestId || 'unknown'})`,
        success: false,
        duration_ms: Date.now() - _startTime,
        conversation_id: conversationId,
      });
      return;
    }

    // The model the run ACTUALLY used, not the one we asked for. CLAUDE_FLEET_MODEL
    // overrides the agent's stored id at spawn, so `resolved.model` is the request
    // and can differ from what the CLI resolved (it reported the whole fleet as the
    // agent-row model regardless of the pin). executeClaudeCode now returns the
    // model from the CLI's own `system/init` event plus `modelSource` saying whether
    // that is a fact (`cli_init`/`cli_result`) or a fallback guess (`requested`).
    const _actualModel = result?.model || resolved.model;
    const _modelSource = result?.modelSource || 'requested';

    if (responseContent) {
      const _finalMsgId = await saveStepMessage(conversationId, {
        content: responseContent,
        contentType: 'text',
        role: 'assistant',
        senderType: 'agent',
        agentId: agentRowId,
        senderId,
        modelUsed: _actualModel,
        tokensIn: result?.usage?.promptTokens || null,
        tokensOut: result?.usage?.completionTokens || null,
        metadata: messageMetadata,
      });
      // ADR-117: dispatch <<@slug>>/<</slug>> invocations embedded in the final text
      _maybeDispatchFromAgentText(responseContent, {
        conversationId,
        userId: invokerUserId,
        spaceId: convForSpace?.space_id || null,
        sourceAgentId: senderId || null,
        sourceLabel: 'final_text',
        sourceMessageId: _finalMsgId,
      });
    } else if (hasStepOutput) {
      // Agent did real work (tool calls, text, thinking) that was already saved
      // by the onEvent handler — skip the generic safety-net message.
      apiLogger.info({
        conversationId, jobDbId, eventCounts: _eventCounts,
      }, 'AgentJobService: CLI result empty but step messages already saved — skipping safety net');
    } else {
      // Truly empty response — no steps at all. Save safety net.
      const safetyText = 'Task completed. Tool execution finished.';
      apiLogger.warn({
        context: 'AgentJobService Safety Net', conversationId, jobDbId, model: resolved.model,
        eventCounts: _eventCounts,
      }, 'Claude CLI returned empty content with no step output — saving safety net message');

      await saveStepMessage(conversationId, {
        content: safetyText,
        contentType: 'text',
        role: 'assistant',
        senderType: 'agent',
        agentId: agentRowId,
        senderId,
        modelUsed: _actualModel,
        metadata: messageMetadata,
      });
    }

    // Mark job completed
    const pending = await finishOrContinueJob(jobDbId, responseContent, {
      tokens: result?.usage || {},
      cost_usd: result?.costUsd || 0,
      model: _actualModel,
      model_source: _modelSource,
      requested_model: resolved.model || null,
      duration_ms: Date.now() - _startTime,
    });

    if (pending.length) {
      // The prior CLI has exited. Continue this job sequentially with updated
      // chat history; never create a parallel worker or a second job row.
      return processJobLocally(jobDbId, agent, conversationId,
        pending.map(message => message.content).join('\n\n'),
        { ...options, attachments: pending.flatMap(message => message.attachments || []) },
        ticketId, statusMessageId, triggeredByUserId);
    }

    // Finalize agent status placeholder
    if (statusMessageId) {
      finalizeAgentStatus(statusMessageId, null)
        .catch(err => apiLogger.error({ err }, 'AgentJobService: Failed to finalize status placeholder'));
    }

    // Update bound ticket status → REVIEW (if dispatched from AgentWorkerService)
    if (ticketId) {
      try {
        const { default: ChainHandoffService } = await import('../ChainHandoffService.js');
        await ChainHandoffService.updateTicketStatus({
          ticket_id: ticketId,
          new_state: TICKET_STATE.REVIEW,
          agent_id: agent.id || null,
          notes: `Job ${jobDbId} completed. Response: ${(responseContent || '').substring(0, 200)}`,
        });
        apiLogger.info({ jobDbId, ticketId }, 'AgentJobService: Ticket transitioned to REVIEW on job completion');
      } catch (ticketErr) {
        apiLogger.error({ err: ticketErr, jobDbId, ticketId }, 'AgentJobService: Failed to update ticket status on completion');
      }
    }

    // Clear processing state
    await setConversationProcessing(conversationId, false);

    // Reset restart count after successful completion so future restarts can also auto-recover
    try {
      const convRow = await dbGet(
        isPostgres()
          ? `SELECT settings FROM conversations WHERE id = $1`
          : `SELECT settings FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (convRow) {
        const settings = safeParse(convRow.settings, {});
        if (settings._job_restart_count) {
          delete settings._job_restart_count;
          delete settings._last_restart;
          await dbRun(
            isPostgres()
              ? `UPDATE conversations SET settings = $1 WHERE id = $2`
              : `UPDATE conversations SET settings = ? WHERE id = ?`,
            [JSON.stringify(settings), conversationId]
          );
        }
      }
    } catch (resetErr) {
      apiLogger.debug({ resetErr, conversationId }, 'AgentJobService: Failed to reset restart count (non-critical)');
    }

    // Log success
    logAgentActivity({
      agent_id: agentName,
      action: 'task_completed',
      details: `Job ${jobDbId} completed (${responseContent.length} chars, ${Date.now() - _startTime}ms)`,
      success: true,
      duration_ms: Date.now() - _startTime,
      tokens_used: result?.usage?.totalTokens || 0,
      cost_usd: result?.costUsd || 0,
      conversation_id: conversationId,
    });

    apiLogger.info({
      jobDbId, conversationId, agentName,
      responseLength: responseContent.length,
      durationMs: Date.now() - _startTime,
      eventCounts: _eventCounts,
    }, 'AgentJobService: Job completed successfully');

  } catch (err) {
    apiLogger.error({ err, jobDbId, conversationId, isShuttingDown: isShuttingDown() }, 'AgentJobService: Job failed');

    // FIX-A: During graceful shutdown, server.js has already marked this job
    // as failed with the recovery marker ("Graceful shutdown — will auto-recover
    // on restart") + result_metadata.shutdown_recovery=true. Do NOT overwrite
    // that marker with the real error — it would prevent Phase 0 recovery.
    if (isShuttingDown()) {
      apiLogger.info({ jobDbId, conversationId }, 'AgentJobService: Shutdown in progress — skipping failJob() to preserve recovery marker');
      // Still clear processing state so the UI unblocks
      await setConversationProcessing(conversationId, false);
      // Clean up agent_status placeholder so it doesn't show forever
      if (statusMessageId) {
        finalizeAgentStatus(statusMessageId, null).catch(() => {});
      }
      return; // Exit early — no retry, no error message during shutdown
    }

    // Mark job as failed
    await failJob(jobDbId, err.message);

    // Mark agent status placeholder as error
    if (statusMessageId) {
      updateAgentStatus(statusMessageId, 'error', `Error: ${(err.message || 'Unknown error').substring(0, 100)}`)
        .catch(statusErr => apiLogger.error({ err: statusErr }, 'AgentJobService: Failed to update status to error'));
    }

    // Reset bound ticket to BACKLOG for retry (if dispatched from AgentWorkerService)
    if (ticketId) {
      try {
        const { default: ChainHandoffService } = await import('../ChainHandoffService.js');
        await ChainHandoffService.updateTicketStatus({
          ticket_id: ticketId,
          new_state: TICKET_STATE.BACKLOG,
          agent_id: agent.id || null,
          notes: `Job ${jobDbId} failed: ${err.message}. Ticket reset for retry.`,
        });
        apiLogger.info({ jobDbId, ticketId }, 'AgentJobService: Ticket reset to BACKLOG on job failure');
      } catch (ticketErr) {
        apiLogger.error({ err: ticketErr, jobDbId, ticketId }, 'AgentJobService: Failed to reset ticket on job failure');
      }
    }

    // Clear processing state
    await setConversationProcessing(conversationId, false);

    // Save error message in conversation
    const agentName = agent.name || agent._agentConfig?.name || 'AI Agent';
    try {
      await saveStepMessage(conversationId, {
        content: `Agent "${agentName}" job failed: ${err.message}. Please try again.`,
        contentType: 'system',
        role: 'system',
        senderType: 'system',
      });
    } catch (msgErr) {
      apiLogger.error({ err: msgErr }, 'AgentJobService: Failed to save error message');
    }

    // Log failure
    logAgentActivity({
      agent_id: agentName,
      action: 'task_failed',
      details: `Job ${jobDbId} failed: ${err.message}`,
      success: false,
      duration_ms: Date.now() - _startTime,
      error_message: err.message,
      conversation_id: conversationId,
    });

    // Check if we should retry
    const job = await getJob(jobDbId);
    if (job && job.attempts < job.max_attempts) {
      apiLogger.info({ jobDbId, attempt: job.attempts + 1 }, 'AgentJobService: Scheduling retry');
      await updateJobAttempts(jobDbId, job.attempts + 1);
      // Retry after a brief delay
      setTimeout(() => {
        processJobLocally(jobDbId, agent, conversationId, messageContent, options, ticketId, statusMessageId, triggeredByUserId).catch(retryErr => {
          apiLogger.error({ retryErr, jobDbId }, 'AgentJobService: Retry also failed');
        });
      }, 5000); // 5 second delay before retry
    }
  }
}
