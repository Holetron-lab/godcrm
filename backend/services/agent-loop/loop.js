/**
 * agent-loop/loop.js — Main agent execution loop (ADR-094)
 *
 * Extracted from AgentLoopService.js.
 * Supports 4 provider branches:
 *   1. Copilot CLI
 *   2. Claude Code CLI (stream-json)
 *   3. Anthropic (native tool_use format)
 *   4. OpenAI / OpenRouter (function calling)
 *
 * Each iteration: AI call -> detect tool_use -> execute tools -> feed results back.
 */

import { apiLogger } from '../../utils/logger.js';
import { detectProvider, handleManagePlan, loadNewMessagesSince } from '../chat/agent-execution-shared.js';
import aiExecutionService from '../labs/ai-execution-service.js';
import { executeTool } from '../AgentToolsService.js';
import { logToolUsed } from '../AgentActivityLogger.js';
import { requiresApproval, createApprovalRequest, waitForDecision, getTimeoutForTool } from '../ToolApprovalService.js';

import { saveStepMessage, getAnthropicText, getMaxOutputTokens, sanitizeToolResult } from './messages.js';
import { toAnthropicTools, resolveAllowedTools, injectToolContext } from './tools.js';
import { updateAgentStatus, finalizeAgentStatus } from './status.js';
import { isConversationCancelled } from '../agent-job/query.js';
import {
  mergeBudget, budgetTripped, TERMINATION_REASONS,
  startRunRow, finalizeRunRow, postTerminationChip,
} from './budgets.js';
import { getModelPriceUsd, deriveCostUsd } from './pricing.js';

// ADR-117: dynamic import of invocation-dispatcher to avoid circular load
// (loop.js -> dispatcher -> chatAgentExecution -> chatShared -> AgentLoopService -> loop.js).
async function _maybeDispatchFromThinking(content, dispatchCtx) {
  if (!content) return;
  try {
    const { hasInvocationTokens, dispatchInvocationsFromContent } = await import('../chat/invocation-dispatcher.js');
    if (!hasInvocationTokens(content)) return;
    await dispatchInvocationsFromContent({
      content,
      sourceLabel: 'thinking',
      ...dispatchCtx,
    });
  } catch (err) {
    apiLogger.error({ err: err.message, ...dispatchCtx }, 'AgentLoopService: thinking-block dispatch failed');
  }
}

/**
 * Execute agent in full tool-loop mode (ADR-094 shared engine).
 *
 * Runs the AI agent with iterative tool calls.
 * Supports: Copilot CLI, Claude Code CLI, Anthropic (native), OpenAI/OpenRouter.
 * Saves step messages (tool_call, tool_result, thinking) as the agent works.
 *
 * @param {Object} params
 * @param {number} params.conversationId - Conversation to save messages to
 * @param {string} params.systemPrompt - Full system prompt
 * @param {Array} params.history - Formatted conversation history
 * @param {string} params.userMessage - The user's message
 * @param {Object} params.agentConfig - Agent configuration object
 * @param {Object} params.resolved - Result of sharedResolveAgentProvider (apiKey, model, provider, isLocal)
 * @param {number|null} params.agentRowId - Agent row ID for step messages
 * @param {number|null} params.senderId - Resolved agent sender_id
 * @param {number|null} params.spaceId - Space ID for tool context injection
 * @param {number|null} params.userId - Triggering user ID for tool context
 * @param {number|null} [params.statusMessageId] - Pre-created placeholder message ID for status updates
 * @returns {Promise<string|null>} Final text response or null
 */
export async function agentLoop(params) {
  const {
    conversationId, systemPrompt, history, userMessage, agentConfig,
    resolved, agentRowId, senderId, spaceId, userId, statusMessageId,
    ticketData,
    budget: budgetOverride,
  } = params;

  const { apiKey, model, provider: providerName, isLocal } = resolved;
  const { isClaudeCode, isCopilot, isAnthropic } = detectProvider(providerName, model);

  // ── ADR-0061 P0 — runtime budgets + termination_reason ──────────────
  // Merge order: harness defaults ← agent.default_budget_json ← dispatch override.
  // `budgetOverride` is per-dispatch (currently unused by callers; reserved for P1+).
  const budget = mergeBudget(agentConfig?.default_budget_json, budgetOverride);
  const _runStartMs = Date.now();
  const counters = { steps: 0, tool_calls: 0, tokens: 0, cost_usd: 0 };
  let terminationReason = null;
  const _ticketIdForRun = ticketData?.id ?? ticketData?.ticket_id ?? null;
  const _runRowIdPromise = startRunRow({
    conversationId, agentId: agentRowId, ticketId: _ticketIdForRun,
    budget, provider: providerName,
  });
  // ── ADR-165 WP-2b — cost cap SOAKS warn-only (WP-1 warn-then-enforce pattern).
  // budgetTripped() detects the cost overage symmetrically with token_limit, but
  // the HALT is gated behind AGENT_COST_LIMIT_ENFORCE so the cap can soak: during
  // soak the overage is logged once (telemetry to size the cap) and the run
  // continues; only the enforce flip turns it into a real terminal halt. Hard
  // limits (step/time/tool/token) keep their existing halt behaviour unchanged.
  const _costEnforce = process.env.AGENT_COST_LIMIT_ENFORCE === 'true';
  let _costWarned = false;
  const _budgetCheck = () => {
    const trip = budgetTripped(counters, budget, _runStartMs);
    if (trip === 'out_of_budget:cost_limit_usd' && !_costEnforce) {
      if (!_costWarned) {
        _costWarned = true;
        apiLogger.warn({
          event: 'cost_limit_exceeded', agentId: agentRowId, agentName: agentConfig?.name,
          provider: providerName, model, cost_usd: counters.cost_usd,
          cost_limit_usd: budget.cost_limit_usd,
        }, 'ADR-165 WP-2b cost cap tripped (warn-only soak — not halting)');
      }
      return null; // do not halt during soak; enforce flip makes this terminal
    }
    return trip;
  };
  // ────────────────────────────────────────────────────────────────────

  // Build the messages array (system + history + user message)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const resolvedMaxTokens = getMaxOutputTokens(model, agentConfig);
  const allowedTools = await resolveAllowedTools(agentConfig, spaceId);

  // ── ADR-165 WP-2b — resolve per-model price ONCE for derived cost_usd.
  // A run uses one model, so a single lookup covers every step. null (unknown
  // or unpriced model) → derived cost stays 0 → cost_limit_usd never trips.
  const _modelPrice = await getModelPriceUsd(model);
  if (budget.cost_limit_usd && !_modelPrice) {
    // Fail-open (hard invariant): cap requested but model has no usable price →
    // this run is UNCAPPED. Logged so soak can measure cost-cap coverage.
    apiLogger.warn(
      { event: 'cost_budget_unpriced', model, provider: providerName, conversationId, agentId: agentRowId, cost_limit_usd: budget.cost_limit_usd },
      'ADR-165 WP-2b: cost_limit_usd set but model is unpriced — cost cap fails open (no enforcement) for this run',
    );
  }

  // ── Reasoning Preamble: inject explain_reasoning tool (Perplexica pattern) ──
  if (agentConfig.reasoning_visible) {
    allowedTools.unshift({
      type: 'function',
      function: {
        name: 'explain_reasoning',
        description: 'Explain your reasoning before taking any action. You MUST call this tool before every other tool call to make your thinking visible to the user.',
        parameters: {
          type: 'object',
          properties: {
            thinking: {
              type: 'string',
              description: 'Your step-by-step reasoning about what to do next and why'
            }
          },
          required: ['thinking']
        }
      }
    });
  }

  // ── ADR-113: Inject manage_plan tool when planning is enabled ──
  const planningConfig = typeof agentConfig.planning === 'object' && agentConfig.planning !== null
    ? agentConfig.planning
    : {};
  if (planningConfig.enabled) {
    const maxTasks = Number(planningConfig.max_tasks) > 0 ? Number(planningConfig.max_tasks) : 20;
    const threshold = Number(planningConfig.auto_plan_threshold) > 0
      ? Number(planningConfig.auto_plan_threshold)
      : 3;
    allowedTools.push({
      type: 'function',
      function: {
        name: 'manage_plan',
        description: `Create or update a plan for the current conversation. Use this when a task requires ${threshold}+ steps. Maximum ${maxTasks} tasks per plan.`,
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'update_task', 'add_task', 'remove_task'],
              description: 'Action to perform on the plan'
            },
            tasks: {
              type: 'array',
              description: 'Array of tasks (for create action). Each task: { id, title, status }',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number', description: 'Task ID (sequential integer)' },
                  title: { type: 'string', description: 'Short task title' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'], description: 'Task status' },
                  note: { type: 'string', description: 'Optional note (brief completion note or blocker reason)' }
                },
                required: ['id', 'title', 'status']
              }
            },
            task_id: {
              type: 'number',
              description: 'Task ID to update or remove (for update_task/remove_task actions)'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'blocked'],
              description: 'New status (for update_task action)'
            },
            note: {
              type: 'string',
              description: 'Optional note to attach to the task (for update_task action)'
            },
            title: {
              type: 'string',
              description: 'Task title (for add_task action)'
            }
          },
          required: ['action']
        }
      }
    });
  }

  let responseText = '';
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // ADR-117: shared context for dispatching <<@slug>>/<</slug>> from thinking blocks
  const _dispatchCtx = {
    conversationId,
    userId: userId || senderId || null,
    spaceId: spaceId || null,
    sourceAgentId: senderId || null,
  };

  // ── T-148527 (WP-A) — lost-during-run mitigation ──
  // Anchor a cursor at the moment the agent's prompt was assembled. Between
  // turns of the tool loop (and once more before declaring a final answer)
  // we re-fetch any user-role messages that arrived after this cursor and
  // inject them as a `[system note]` user-turn so the next iteration sees
  // the fresh context. Cursor advances to the newest message's created_at
  // after each successful injection — never rewinds, never duplicates.
  let _t148527Cursor = new Date().toISOString();
  const _t148527FetchFresh = async () => {
    const fresh = await loadNewMessagesSince(conversationId, _t148527Cursor, senderId);
    if (!Array.isArray(fresh) || fresh.length === 0) return null;
    // Advance cursor to the latest message we saw. Use ISO string to keep
    // comparisons consistent with how Postgres formats timestamps.
    const last = fresh[fresh.length - 1];
    if (last?.created_at) _t148527Cursor = new Date(last.created_at).toISOString();
    return fresh;
  };
  const _t148527FormatNote = (msgs) => {
    const lines = msgs.map(m => {
      const author = m.sender_name || (m.sender_id ? `user:${m.sender_id}` : 'user');
      const body = (m.content || '').toString().replace(/\s+/g, ' ').trim().slice(0, 4000);
      return `- [${author}]: ${body}`;
    }).join('\n');
    const lead = msgs.length === 1
      ? 'a participant added a new message'
      : `${msgs.length} participants added new messages`;
    return `[system note — T-148527] While you were thinking, ${lead}. Incorporate this into your next reply before finishing:\n${lines}`;
  };

  // ADR-104: Build agent metadata for all step messages so frontend resolves correct agent name
  const agentDisplayName = agentConfig.name || 'AI Agent';
  const agentIcon = agentConfig.icon || agentConfig.emoji || null;
  const agentColor = agentConfig.color || null;
  // ADR-0057: invocation_mode drives the role-badge icon (⚡ for `command`, 🤖 otherwise).
  // Whitelist values so a stale DB row can't smuggle anything else into metadata.
  const _rawInvocationMode = agentConfig.invocation_mode;
  const agentInvocationMode = (_rawInvocationMode === 'mention' || _rawInvocationMode === 'command' || _rawInvocationMode === 'both')
    ? _rawInvocationMode
    : null;
  const stepMetadata = JSON.stringify({
    agent_name: agentDisplayName,
    agent_icon: agentIcon,
    agent_color: agentColor,
    agent_invocation_mode: agentInvocationMode,
    agent_row_id: agentRowId,
  });

  // Helper: update status placeholder (fire-and-forget, no-op if no statusMessageId)
  const _updateStatus = (status, action, extra) => {
    if (!statusMessageId) return;
    updateAgentStatus(statusMessageId, status, action, extra)
      .catch(err => apiLogger.error({ err, statusMessageId }, 'AgentLoopService: Failed to update agent status'));
  };

  apiLogger.info({
    context: 'AgentLoopService',
    conversationId, model, provider: providerName,
    isClaudeCode, isCopilot, isAnthropic,
    toolCount: allowedTools.length,
    maxTokens: resolvedMaxTokens,
    statusMessageId,
  }, 'Starting agent tool loop execution');

  // Update status: thinking
  _updateStatus('thinking', 'Analyzing conversation...');

  // ADR-0061 P0: wrap branch dispatch + summary call so uncaught exceptions
  // classify as error_unrecoverable AND a chip is always posted. Re-throws.
  try {
  if (isCopilot) {
    // ── Copilot CLI ──
    // ADR-165 WP-2b DOCUMENTED GAP (warn-only): this branch feeds neither
    // counters.tokens nor counters.cost_usd, so cost_limit_usd is NOT enforced
    // here — the same pre-existing boundary token_limit already has. Wiring
    // Copilot's usage/cost is WP-2c fast-follow (a precondition for flipping cost
    // enforce true); do not fold it in here.
    // NOTE (Ticket #74074): Tool approval checkpoints are NOT applied here because
    // Copilot CLI does not support tool-use loops — it returns a single text response.
    _updateStatus('generating', 'Generating response...');
    const cliResult = await aiExecutionService.executeCopilotCli({
      model, messages, systemPrompt, maxTokens: resolvedMaxTokens
    });
    responseText = cliResult.content;
    if (responseText) {
      // Model the CLI reported running (usage JSON), not the requested id.
      // Counters (tokens/cost_usd) are still NOT fed here — that is WP-2c.
      const _finalMsgIdCopilot = await saveStepMessage(conversationId, {
        content: responseText, contentType: 'text', role: 'assistant',
        senderType: 'agent', agentId: agentRowId, senderId,
        modelUsed: cliResult.model || model,
        metadata: stepMetadata
      });
      _maybeDispatchFromThinking(responseText, { ..._dispatchCtx, sourceLabel: 'final_text', sourceMessageId: _finalMsgIdCopilot });
    }

  } else if (isClaudeCode) {
    // ── Claude Code CLI with stream-json ──
    // ADR-165 WP-2b DOCUMENTED GAP (warn-only): the loop drops the CLI's native
    // total_cost_usd and does not feed counters.cost_usd, so cost_limit_usd is NOT
    // enforced here — the same pre-existing boundary token_limit already has.
    // WP-2c should capture that native total_cost_usd directly (cache-pricing
    // aware, more accurate than token-derivation) — a precondition for flipping
    // cost enforce true; deliberately NOT folded into 2b to keep the WP atomic
    // and consistent with the locked ADR-165 coverage table.
    // NOTE (Ticket #74074): Tool approval checkpoints are NOT applied here because
    // Claude Code CLI manages its own tool execution internally. The onEvent callback
    // only observes tool calls/results after they have already been executed.
    // Approval flow applies to Anthropic and OpenAI branches where we control execution.
    let _ccToolCount = 0;
    let _ccToolCompleted = 0;
    const onEvent = (event) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            _ccToolCount++;
            _updateStatus('tool_call', `Using tool: ${block.name}`, { tools_used: _ccToolCount, tools_completed: _ccToolCompleted });
            saveStepMessage(conversationId, {
              content: block.name, contentType: 'tool_call', role: 'assistant',
              senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
              toolResults: { tool: block.name, args: block.input },
              metadata: stepMetadata
            }).catch(err => apiLogger.error({ err, conversationId, block: 'tool_call' }, 'AgentLoopService: Failed to save tool_call step'));
          } else if (block.type === 'text' && block.text) {
            saveStepMessage(conversationId, {
              content: block.text, contentType: 'thinking', role: 'assistant',
              senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
              metadata: stepMetadata
            }).catch(err => apiLogger.error({ err, conversationId, block: 'thinking' }, 'AgentLoopService: Failed to save thinking step'));
          }
        }
      } else if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            _ccToolCompleted++;
            _updateStatus('tool_call', `Tool completed (${_ccToolCompleted}/${_ccToolCount})`, { tools_used: _ccToolCount, tools_completed: _ccToolCompleted });
            const resultContent = typeof block.content === 'string'
              ? block.content : JSON.stringify(block.content);
            const truncated = resultContent.length > 2000
              ? resultContent.substring(0, 2000) + '...' : resultContent;
            saveStepMessage(conversationId, {
              content: truncated, contentType: 'tool_result', role: 'tool',
              senderType: 'agent', agentId: agentRowId, senderId,
              toolResults: { tool_use_id: block.tool_use_id, content: truncated },
              metadata: stepMetadata
            }).catch(err => apiLogger.error({ err, conversationId, block: 'tool_result' }, 'AgentLoopService: Failed to save tool_result step'));
          }
        }
      }
    };

    const cliResult = await aiExecutionService.executeClaudeCode({
      model, messages, systemPrompt, maxTokens: resolvedMaxTokens, onEvent,
      // ADR-0053 Phase C3: hook context for _command_policies resolver.
      agentId: agentRowId, spaceId,
    });
    responseText = cliResult.content;
    usage = {
      prompt_tokens: cliResult.usage?.promptTokens || 0,
      completion_tokens: cliResult.usage?.completionTokens || 0,
      total_tokens: cliResult.usage?.totalTokens || 0
    };
    if (responseText) {
      const _finalMsgIdCC = await saveStepMessage(conversationId, {
        content: responseText, contentType: 'text', role: 'assistant',
        senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
        tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens,
        metadata: stepMetadata
      });
      _maybeDispatchFromThinking(responseText, { ..._dispatchCtx, sourceLabel: 'final_text', sourceMessageId: _finalMsgIdCC });
    }

  } else if (isAnthropic) {
    // ── Anthropic tool loop ──
    const anthropicTools = allowedTools.length ? toAnthropicTools(allowedTools) : [];
    const maxIterations = Number(agentConfig.max_iterations) > 0 ? Number(agentConfig.max_iterations) : 25;
    const loopMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
    let _anthToolCount = 0;
    let _anthToolCompleted = 0;

    for (let i = 0; i < maxIterations; i++) {
      // ── ADR-0061 P0: step counter + budget check (BEFORE cancellation so
      // an over-budget run still terminates cleanly). `counters.steps` =
      // iterations COMPLETED before this one, so step_limit=N permits N steps.
      counters.steps = i;
      const _stepTrip = _budgetCheck();
      if (_stepTrip) { terminationReason = _stepTrip; break; }

      // ── Cancellation check: bail if user pressed Stop ──
      if (await isConversationCancelled(conversationId)) {
        apiLogger.info({ conversationId, iteration: i + 1, context: 'AgentLoopService' }, 'Conversation cancelled by user — stopping Anthropic loop');
        await saveStepMessage(conversationId, {
          content: '⛔ Агент остановлен пользователем.',
          contentType: 'text', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          metadata: stepMetadata
        });
        responseText = '⛔ Агент остановлен пользователем.';
        terminationReason = TERMINATION_REASONS.HUMAN_STOP;
        break;
      }

      // ── T-148527 (WP-A): re-fetch user messages added between turns ──
      if (i > 0) {
        const fresh = await _t148527FetchFresh();
        if (fresh) {
          loopMessages.push({ role: 'user', content: _t148527FormatNote(fresh) });
          apiLogger.info({ conversationId, count: fresh.length, iteration: i + 1, branch: 'anthropic' }, 'T-148527: injected fresh user messages between iterations');
        }
      }

      _updateStatus('thinking', `Iteration ${i + 1}...`, { tools_used: _anthToolCount, tools_completed: _anthToolCompleted });
      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: resolvedMaxTokens,
          system: systemPrompt,
          messages: loopMessages,
          ...(anthropicTools.length ? { tools: anthropicTools } : {})
        })
      });

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text();
        apiLogger.error({ status: anthropicResponse.status, error: errorText, context: 'AgentLoopService' }, 'Anthropic API error');
        terminationReason = TERMINATION_REASONS.ERROR_UNRECOVERABLE;
        break;
      }

      const anthropicData = await anthropicResponse.json();
      const stopReason = anthropicData.stop_reason;
      usage = {
        prompt_tokens: anthropicData.usage?.input_tokens || 0,
        completion_tokens: anthropicData.usage?.output_tokens || 0,
        total_tokens: (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0)
      };
      // ADR-0061 P0: track cumulative tokens for token_limit budget.
      counters.tokens += usage.total_tokens;
      // ADR-165 WP-2b: derive cumulative USD cost for cost_limit_usd budget.
      counters.cost_usd += deriveCostUsd(usage, _modelPrice);

      apiLogger.info({ context: 'AgentLoopService', iteration: i + 1, maxIterations, stopReason }, 'Anthropic agent loop iteration');

      const contentBlocks = anthropicData.content || [];
      const textContent = getAnthropicText(contentBlocks);
      if (textContent) responseText = textContent;

      const toolUses = Array.isArray(contentBlocks)
        ? contentBlocks.filter(item => item?.type === 'tool_use') : [];

      // Handle max_tokens mid-response
      if (stopReason === 'max_tokens' && !toolUses.length) {
        apiLogger.warn({ context: 'AgentLoopService', iteration: i + 1 }, 'Hit max_tokens, nudging to continue');
        if (contentBlocks.length) {
          loopMessages.push({ role: 'assistant', content: contentBlocks });
          loopMessages.push({ role: 'user', content: 'Your previous response was cut off due to output token limit. Please continue where you left off. Be more concise.' });
        }
        continue;
      }

      if (!toolUses.length) {
        // ── T-148527 (WP-A): one more turn if late messages arrived ──
        // The agent is about to declare its final answer. If user messages
        // landed in the meantime, prepend the assistant turn to history and
        // inject the note, then `continue` instead of `break` so the agent
        // gets exactly one extra round to address them. Capped by maxIterations.
        if (i < maxIterations - 1) {
          const lateFresh = await _t148527FetchFresh();
          if (lateFresh) {
            if (contentBlocks.length) {
              loopMessages.push({ role: 'assistant', content: contentBlocks });
            }
            loopMessages.push({ role: 'user', content: _t148527FormatNote(lateFresh) });
            apiLogger.info({ conversationId, count: lateFresh.length, iteration: i + 1, branch: 'anthropic' }, 'T-148527: late messages detected — performing one extra turn instead of finalising');
            continue;
          }
        }

        // Final text response
        if (textContent) {
          const _finalMsgIdAnth = await saveStepMessage(conversationId, {
            content: textContent, contentType: 'text', role: 'assistant',
            senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
            tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens,
            metadata: stepMetadata
          });
          _maybeDispatchFromThinking(textContent, { ..._dispatchCtx, sourceLabel: 'final_text', sourceMessageId: _finalMsgIdAnth });
        }
        // ADR-0061 P0: model produced a final assistant text → goal_reached.
        terminationReason = TERMINATION_REASONS.GOAL_REACHED;
        break;
      }

      // Save thinking text before tools
      if (textContent) {
        const _thinkMsgId = await saveStepMessage(conversationId, {
          content: textContent, contentType: 'thinking', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          metadata: stepMetadata
        });
        // ADR-117: dispatch <<@slug>> invocations found in thinking text
        _maybeDispatchFromThinking(textContent, { ..._dispatchCtx, sourceMessageId: _thinkMsgId });
      }

      loopMessages.push({ role: 'assistant', content: contentBlocks });

      const toolResultBlocks = [];
      for (const toolUse of toolUses) {
        const toolName = toolUse?.name;
        if (!toolName) continue;

        // ── Reasoning Preamble: save as thinking, skip execution ──
        if (toolName === 'explain_reasoning') {
          const reasoningText = toolUse?.input?.thinking || '';
          if (reasoningText) {
            const _rmId = await saveStepMessage(conversationId, {
              content: reasoningText, contentType: 'thinking', role: 'assistant',
              senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
              metadata: stepMetadata
            });
            // ADR-117: dispatch <<@slug>> invocations found in explain_reasoning text
            _maybeDispatchFromThinking(reasoningText, { ..._dispatchCtx, sourceMessageId: _rmId });
          }
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Reasoning noted. Proceed with your action.'
          });
          continue;
        }

        let args = toolUse?.input || {};

        // ── Reasoning Preamble handler: save as thinking, skip execution ──
        if (toolName === 'explain_reasoning') {
          const reasoningText = args?.thinking || args?.input?.thinking || '';
          await saveStepMessage(conversationId, {
            content: reasoningText,
            contentType: 'thinking',
            role: 'assistant',
            senderType: 'agent',
            agentId: agentRowId,
            senderId,
            modelUsed: model,
            metadata: stepMetadata
          });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Reasoning noted. Proceed with your action.'
          });
          apiLogger.info({ context: 'AgentLoopService', reasoning: reasoningText.substring(0, 200) }, 'Reasoning preamble captured');
          continue;
        }
        // ── End Reasoning Preamble handler ──

        // ── ADR-113: manage_plan handler — delegates to shared handleManagePlan() ──
        if (toolName === 'manage_plan') {
          const planResult = await handleManagePlan(args, conversationId, agentDisplayName || 'unknown', { agentId: agentRowId });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: typeof planResult === 'string' ? planResult : JSON.stringify(planResult)
          });
          continue;
        }
        // ── End ADR-113: manage_plan handler ──

        args = injectToolContext(toolName, args, { spaceId, userId });

        _anthToolCount++;
        _updateStatus('tool_call', `Using tool: ${toolName}`, { tools_used: _anthToolCount, tools_completed: _anthToolCompleted });

        // Save tool_call step
        const toolCallMsgId = await saveStepMessage(conversationId, {
          content: toolName, contentType: 'tool_call', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          toolResults: { tool: toolName, args },
          metadata: stepMetadata
        });

        // ===== APPROVAL CHECKPOINT (Ticket #74074) =====
        let approvalSkipped = false;
        try {
          const needsApprovalCheck = await requiresApproval(toolName, agentRowId);
          if (needsApprovalCheck && toolCallMsgId) {
            await createApprovalRequest(conversationId, toolCallMsgId, toolName, args, agentRowId);

            const timeoutSec = await getTimeoutForTool(toolName);

            // Save tool_approval message (triggers UI approval bubble)
            await saveStepMessage(conversationId, {
              content: `Tool "${toolName}" requires approval`,
              contentType: 'tool_approval', role: 'system', senderType: 'system',
              agentId: agentRowId, senderId,
              toolResults: { tool: toolName, args, messageId: toolCallMsgId },
              metadata: JSON.stringify({
                ...JSON.parse(stepMetadata),
                approval_status: 'pending',
                timeout_seconds: timeoutSec,
              })
            });

            apiLogger.info({ toolName, toolCallMsgId, context: 'AgentLoopService' }, 'Waiting for tool approval');
            const decision = await waitForDecision(toolCallMsgId, timeoutSec * 1000);

            if (decision === 'rejected' || decision === 'timeout') {
              const rejectionMsg = decision === 'timeout'
                ? `Tool "${toolName}" approval timed out (${timeoutSec}s)`
                : `Tool "${toolName}" was rejected by user`;

              await saveStepMessage(conversationId, {
                content: rejectionMsg,
                contentType: 'tool_result', role: 'tool',
                senderType: 'agent', agentId: agentRowId, senderId,
                toolResults: { tool: toolName, args, result: { error: `Tool ${decision}` } },
                metadata: stepMetadata
              });

              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: `Tool execution ${decision} by user` })
              });
              approvalSkipped = true;
              // ADR-0061 P0: explicit denial → tool_denied terminal. P0 takes
              // the conservative cut: first denied tool terminates the run.
              // P1+ may relax this to "only if no other tool in this iteration
              // produced a usable result" once we wire fallback semantics.
              terminationReason = TERMINATION_REASONS.TOOL_DENIED;
            }
            // If approved, fall through to execute
          }
        } catch (approvalErr) {
          apiLogger.error({ err: approvalErr.message, toolName, context: 'AgentLoopService' }, 'Approval check failed, proceeding with execution');
        }
        if (approvalSkipped) {
          if (terminationReason === TERMINATION_REASONS.TOOL_DENIED) break;
          continue;
        }
        // ===== END APPROVAL CHECKPOINT =====

        apiLogger.info({ toolName, args, context: 'AgentLoopService' }, 'Executing tool');
        const _toolStart = Date.now();
        const result = sanitizeToolResult(await executeTool(toolName, args, userId, {
          conversationId, agentName: agentConfig.name, agentId: agentRowId,
          ticketData,
          // ADR-165 WP-1: agent capability scope for the executeTool() gate.
          allowedTools,
        }));

        // ADR-0061 P0: tool_call counter ticks AFTER each successful execution.
        counters.tool_calls += 1;

        logToolUsed(agentConfig.name || 'unknown', toolName, conversationId, { duration_ms: Date.now() - _toolStart });

        _anthToolCompleted++;
        _updateStatus('tool_call', `Tool completed: ${toolName} (${_anthToolCompleted}/${_anthToolCount})`, { tools_used: _anthToolCount, tools_completed: _anthToolCompleted });

        // Save tool_result step
        const resultStr = JSON.stringify(result);
        await saveStepMessage(conversationId, {
          content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...' : resultStr,
          contentType: 'tool_result', role: 'tool',
          senderType: 'agent', agentId: agentRowId, senderId,
          toolResults: { tool: toolName, args, result },
          metadata: stepMetadata
        });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // ADR-0061 P0: post-tool budget + termination check; break outer loop.
      if (terminationReason) break;
      const _postToolTrip = _budgetCheck();
      if (_postToolTrip) { terminationReason = _postToolTrip; break; }

      if (!toolResultBlocks.length) break;
      loopMessages.push({ role: 'user', content: toolResultBlocks });
    }

  } else {
    // ── OpenAI / OpenRouter tool loop ──
    const maxIterations = Number(agentConfig.max_iterations) > 0 ? Number(agentConfig.max_iterations) : 25;
    const loopMessages = [...messages];
    let _oaiToolCount = 0;
    let _oaiToolCompleted = 0;

    for (let i = 0; i < maxIterations; i++) {
      // ── ADR-0061 P0: step counter + budget check ──
      counters.steps = i;
      const _stepTripOAI = _budgetCheck();
      if (_stepTripOAI) { terminationReason = _stepTripOAI; break; }

      // ── Cancellation check: bail if user pressed Stop ──
      if (await isConversationCancelled(conversationId)) {
        apiLogger.info({ conversationId, iteration: i + 1, context: 'AgentLoopService' }, 'Conversation cancelled by user — stopping OpenAI loop');
        await saveStepMessage(conversationId, {
          content: '⛔ Агент остановлен пользователем.',
          contentType: 'text', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          metadata: stepMetadata
        });
        responseText = '⛔ Агент остановлен пользователем.';
        terminationReason = TERMINATION_REASONS.HUMAN_STOP;
        break;
      }

      // ── T-148527 (WP-A): re-fetch user messages added between turns ──
      if (i > 0) {
        const fresh = await _t148527FetchFresh();
        if (fresh) {
          loopMessages.push({ role: 'user', content: _t148527FormatNote(fresh) });
          apiLogger.info({ conversationId, count: fresh.length, iteration: i + 1, branch: 'openai' }, 'T-148527: injected fresh user messages between iterations');
        }
      }

      _updateStatus('thinking', `Iteration ${i + 1}...`, { tools_used: _oaiToolCount, tools_completed: _oaiToolCompleted });
      const apiUrl = providerName === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

      const openaiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: loopMessages,
          temperature: agentConfig.temperature || 0.7,
          max_tokens: resolvedMaxTokens,
          ...(allowedTools.length ? { tools: allowedTools, tool_choice: 'auto' } : {})
        })
      });

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        apiLogger.error({ status: openaiResponse.status, error: errorText, context: 'AgentLoopService' }, 'OpenAI API error');
        terminationReason = TERMINATION_REASONS.ERROR_UNRECOVERABLE;
        break;
      }

      const openaiData = await openaiResponse.json();
      usage = openaiData.usage || usage;
      // ADR-0061 P0: track cumulative tokens.
      counters.tokens += Number(usage.total_tokens || 0) || 0;
      // ADR-165 WP-2b: derive cumulative USD cost for cost_limit_usd budget.
      counters.cost_usd += deriveCostUsd(usage, _modelPrice);
      const choice = openaiData.choices?.[0]?.message;
      const finishReason = openaiData.choices?.[0]?.finish_reason;

      apiLogger.info({ context: 'AgentLoopService', iteration: i + 1, finishReason }, 'OpenAI agent loop iteration');

      if (!choice) break;

      // Handle max_tokens
      if (finishReason === 'length' && (!choice.tool_calls || choice.tool_calls.length === 0)) {
        if (choice.content) {
          loopMessages.push({ role: 'assistant', content: choice.content });
          loopMessages.push({ role: 'user', content: 'Your previous response was cut off due to output token limit. Please continue where you left off. Be more concise.' });
        }
        continue;
      }

      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        // ── T-148527 (WP-A): one more turn if late messages arrived ──
        if (i < maxIterations - 1) {
          const lateFresh = await _t148527FetchFresh();
          if (lateFresh) {
            if (choice.content) {
              loopMessages.push({ role: 'assistant', content: choice.content });
            }
            loopMessages.push({ role: 'user', content: _t148527FormatNote(lateFresh) });
            apiLogger.info({ conversationId, count: lateFresh.length, iteration: i + 1, branch: 'openai' }, 'T-148527: late messages detected — performing one extra turn instead of finalising');
            continue;
          }
        }

        responseText = choice.content || '';
        if (responseText) {
          const _finalMsgIdOAI = await saveStepMessage(conversationId, {
            content: responseText, contentType: 'text', role: 'assistant',
            senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
            tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens,
            metadata: stepMetadata
          });
          _maybeDispatchFromThinking(responseText, { ..._dispatchCtx, sourceLabel: 'final_text', sourceMessageId: _finalMsgIdOAI });
        }
        // ADR-0061 P0: final assistant text reached → goal_reached.
        terminationReason = TERMINATION_REASONS.GOAL_REACHED;
        break;
      }

      // Save thinking text before tools
      if (choice.content) {
        const _thinkMsgIdOAI = await saveStepMessage(conversationId, {
          content: choice.content, contentType: 'thinking', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          metadata: stepMetadata
        });
        // ADR-117: dispatch <<@slug>> invocations found in thinking text
        _maybeDispatchFromThinking(choice.content, { ..._dispatchCtx, sourceMessageId: _thinkMsgIdOAI });
      }

      loopMessages.push({
        role: 'assistant', content: choice.content || '',
        tool_calls: choice.tool_calls
      });

      for (const toolCall of choice.tool_calls) {
        const toolName = toolCall.function?.name;
        if (!toolName) continue;

        // ── Reasoning Preamble: save as thinking, skip execution ──
        if (toolName === 'explain_reasoning') {
          let reasoningText = '';
          try {
            const parsed = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
            reasoningText = parsed.thinking || '';
          } catch { reasoningText = ''; }
          if (reasoningText) {
            const _rmIdOAI = await saveStepMessage(conversationId, {
              content: reasoningText, contentType: 'thinking', role: 'assistant',
              senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
              metadata: stepMetadata
            });
            // ADR-117: dispatch <<@slug>> invocations found in explain_reasoning text
            _maybeDispatchFromThinking(reasoningText, { ..._dispatchCtx, sourceMessageId: _rmIdOAI });
          }
          loopMessages.push({
            role: 'tool', tool_call_id: toolCall.id,
            content: 'Reasoning noted. Proceed with your action.'
          });
          continue;
        }

        let args = {};
        try {
          args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
        } catch { args = {}; }

        // ── Reasoning Preamble handler (OpenAI format) ──
        if (toolName === 'explain_reasoning') {
          const reasoningText = args?.thinking || '';
          await saveStepMessage(conversationId, {
            content: reasoningText,
            contentType: 'thinking',
            role: 'assistant',
            senderType: 'agent',
            agentId: agentRowId,
            senderId,
            modelUsed: model,
            metadata: stepMetadata
          });
          loopMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Reasoning noted. Proceed with your action.'
          });
          apiLogger.info({ context: 'AgentLoopService', reasoning: reasoningText.substring(0, 200) }, 'Reasoning preamble captured (OpenAI)');
          continue;
        }
        // ── End Reasoning Preamble handler ──

        // ── ADR-113: manage_plan handler (OpenAI format) — delegates to shared handleManagePlan() ──
        if (toolName === 'manage_plan') {
          const planResult = await handleManagePlan(args, conversationId, agentDisplayName || 'unknown', { agentId: agentRowId });
          loopMessages.push({
            role: 'tool', tool_call_id: toolCall.id,
            content: typeof planResult === 'string' ? planResult : JSON.stringify(planResult)
          });
          continue;
        }
        // ── End ADR-113: manage_plan handler (OpenAI) ──

        args = injectToolContext(toolName, args, { spaceId, userId });

        _oaiToolCount++;
        _updateStatus('tool_call', `Using tool: ${toolName}`, { tools_used: _oaiToolCount, tools_completed: _oaiToolCompleted });

        // Save tool_call step
        const toolCallMsgIdOAI = await saveStepMessage(conversationId, {
          content: toolName, contentType: 'tool_call', role: 'assistant',
          senderType: 'agent', agentId: agentRowId, senderId, modelUsed: model,
          toolResults: { tool: toolName, args },
          metadata: stepMetadata
        });

        // ===== APPROVAL CHECKPOINT (Ticket #74074) =====
        let approvalSkippedOAI = false;
        try {
          const needsApprovalCheckOAI = await requiresApproval(toolName, agentRowId);
          if (needsApprovalCheckOAI && toolCallMsgIdOAI) {
            await createApprovalRequest(conversationId, toolCallMsgIdOAI, toolName, args, agentRowId);

            const timeoutSecOAI = await getTimeoutForTool(toolName);

            await saveStepMessage(conversationId, {
              content: `Tool "${toolName}" requires approval`,
              contentType: 'tool_approval', role: 'system', senderType: 'system',
              agentId: agentRowId, senderId,
              toolResults: { tool: toolName, args, messageId: toolCallMsgIdOAI },
              metadata: JSON.stringify({
                ...JSON.parse(stepMetadata),
                approval_status: 'pending',
                timeout_seconds: timeoutSecOAI,
              })
            });

            apiLogger.info({ toolName, toolCallMsgIdOAI, context: 'AgentLoopService' }, 'Waiting for tool approval (OpenAI)');
            const decisionOAI = await waitForDecision(toolCallMsgIdOAI, timeoutSecOAI * 1000);

            if (decisionOAI === 'rejected' || decisionOAI === 'timeout') {
              const rejectionMsgOAI = decisionOAI === 'timeout'
                ? `Tool "${toolName}" approval timed out (${timeoutSecOAI}s)`
                : `Tool "${toolName}" was rejected by user`;

              await saveStepMessage(conversationId, {
                content: rejectionMsgOAI,
                contentType: 'tool_result', role: 'tool',
                senderType: 'agent', agentId: agentRowId, senderId,
                toolResults: { tool: toolName, args, result: { error: `Tool ${decisionOAI}` } },
                metadata: stepMetadata
              });

              loopMessages.push({
                role: 'tool', tool_call_id: toolCall.id,
                content: JSON.stringify({ error: `Tool execution ${decisionOAI} by user` })
              });
              approvalSkippedOAI = true;
              // ADR-0061 P0: explicit denial → tool_denied terminal.
              terminationReason = TERMINATION_REASONS.TOOL_DENIED;
            }
          }
        } catch (approvalErrOAI) {
          apiLogger.error({ err: approvalErrOAI.message, toolName, context: 'AgentLoopService' }, 'Approval check failed (OpenAI), proceeding with execution');
        }
        if (approvalSkippedOAI) {
          if (terminationReason === TERMINATION_REASONS.TOOL_DENIED) break;
          continue;
        }
        // ===== END APPROVAL CHECKPOINT =====

        const _toolStartOAI = Date.now();
        const result = sanitizeToolResult(await executeTool(toolName, args, userId, {
          conversationId, agentName: agentConfig.name, agentId: agentRowId,
          ticketData,
          // ADR-165 WP-1: agent capability scope for the executeTool() gate.
          allowedTools,
        }));

        // ADR-0061 P0: tool_call counter ticks AFTER each successful execution.
        counters.tool_calls += 1;

        logToolUsed(agentConfig.name || 'unknown', toolName, conversationId, { duration_ms: Date.now() - _toolStartOAI });

        _oaiToolCompleted++;
        _updateStatus('tool_call', `Tool completed: ${toolName} (${_oaiToolCompleted}/${_oaiToolCount})`, { tools_used: _oaiToolCount, tools_completed: _oaiToolCompleted });

        // Save tool_result step
        const resultStr = JSON.stringify(result);
        await saveStepMessage(conversationId, {
          content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...' : resultStr,
          contentType: 'tool_result', role: 'tool',
          senderType: 'agent', agentId: agentRowId, senderId,
          toolResults: { tool: toolName, args, result },
          metadata: stepMetadata
        });

        loopMessages.push({
          role: 'tool', tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // ADR-0061 P0: post-tool budget + termination check; break outer loop.
      if (terminationReason) break;
      const _postToolTripOAI = _budgetCheck();
      if (_postToolTripOAI) { terminationReason = _postToolTripOAI; break; }
    }
  }

  // ADR-095 Task 2: Summary call — if tool loop ended without final text,
  // make one more AI call asking for a summary instead of a generic "Task completed" message.
  // Enhanced: include iteration count so user knows if agent hit the limit.
  if (!responseText) {
    const hitLimit = true; // We only get here if loop ended without final text
    apiLogger.warn({
      context: 'AgentLoopService Summary Call', conversationId, model,
      maxIterations: Number(agentConfig.max_iterations) || 25
    }, 'Tool loop completed without final text response — requesting summary from AI');

    let summaryText = '';

    try {
      if (isAnthropic) {
        // Rebuild messages with tool results context, ask for summary
        const summaryMessages = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));
        summaryMessages.push({
          role: 'user',
          content: `Your tool execution loop has ended (iteration limit reached: ${Number(agentConfig.max_iterations) || 25}). Please provide:\n1. What you accomplished so far\n2. What remains UNFINISHED (if anything)\n3. Specific next steps the user should take\n4. If the task is incomplete, say so clearly — do NOT say "Task completed" if work remains.\nBe concise but actionable.`
        });

        const summaryResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: summaryMessages
          })
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          summaryText = getAnthropicText(summaryData.content || []) || '';
          // Track summary call tokens
          if (summaryData.usage) {
            usage.prompt_tokens = (usage.prompt_tokens || 0) + (summaryData.usage.input_tokens || 0);
            usage.completion_tokens = (usage.completion_tokens || 0) + (summaryData.usage.output_tokens || 0);
            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          }
        }
      } else if (!isCopilot && !isClaudeCode) {
        // OpenAI / OpenRouter summary call
        const apiUrl = providerName === 'openrouter'
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';

        const summaryMessages = [...messages, {
          role: 'user',
          content: 'Your tool execution is complete. Please provide a brief summary of what you accomplished, any results, and next steps if applicable. Be concise but informative.'
        }];

        const summaryResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: summaryMessages,
            temperature: agentConfig.temperature || 0.7,
            max_tokens: 1024
          })
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          const choice = summaryData.choices?.[0]?.message;
          summaryText = choice?.content || '';
          if (summaryData.usage) {
            usage.prompt_tokens = (usage.prompt_tokens || 0) + (summaryData.usage.prompt_tokens || 0);
            usage.completion_tokens = (usage.completion_tokens || 0) + (summaryData.usage.completion_tokens || 0);
            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          }
        }
      }
    } catch (summaryErr) {
      apiLogger.error({ err: summaryErr, context: 'AgentLoopService Summary Call' },
        'Failed to get summary from AI — falling back to generic message');
    }

    // Fallback to generic message only if summary call also failed
    const iterLimit = Number(agentConfig.max_iterations) || 25;
    const finalText = summaryText || `\u26a0\ufe0f Agent reached iteration limit (${iterLimit}). The task may be incomplete. Please retry or increase max_iterations in agent settings.`;

    const _finalMsgIdSummary = await saveStepMessage(conversationId, {
      content: finalText,
      contentType: 'text',
      role: 'assistant',
      senderType: 'agent',
      agentId: agentRowId,
      senderId,
      modelUsed: model,
      metadata: stepMetadata
    });
    _maybeDispatchFromThinking(finalText, { ..._dispatchCtx, sourceLabel: 'final_text', sourceMessageId: _finalMsgIdSummary });
    responseText = finalText;
    // ADR-0061 P0: fell through max_iterations → out_of_budget:step_limit.
    if (!terminationReason) terminationReason = 'out_of_budget:step_limit';
  }

  apiLogger.info({
    context: 'AgentLoopService', conversationId, model,
    responseLength: responseText.length, usage
  }, 'Agent tool loop completed');

  // Finalize the status placeholder
  if (statusMessageId) {
    await finalizeAgentStatus(statusMessageId, null).catch(err =>
      apiLogger.error({ err, statusMessageId }, 'AgentLoopService: Failed to finalize agent status')
    );
  }
  } catch (_err) {
    // ADR-0061 P0: classify uncaught as error_unrecoverable, persist, re-throw.
    terminationReason = TERMINATION_REASONS.ERROR_UNRECOVERABLE;
    apiLogger.error({ err: _err?.message || _err, conversationId, agentRowId, context: 'AgentLoopService' },
      'agentLoop unrecoverable error');
    throw _err;
  } finally {
    // ADR-0061 P0: always finalize run row + post termination chip.
    // Default to goal_reached if a text response was produced; otherwise leave
    // null (caller may see this if exception thrown without setting reason).
    if (!terminationReason && responseText) terminationReason = TERMINATION_REASONS.GOAL_REACHED;
    try {
      const runRowId = await _runRowIdPromise;
      const consumed = {
        steps: counters.steps,
        time_ms: Date.now() - _runStartMs,
        tool_calls: counters.tool_calls,
        tokens: counters.tokens,
        cost_usd: counters.cost_usd,
      };
      await finalizeRunRow(runRowId, { terminationReason, counters: consumed });
      if (terminationReason && conversationId) {
        await postTerminationChip({
          conversationId, runRowId, terminationReason,
          senderId, agentRowId, agentMetadata: stepMetadata,
        });
      }
    } catch (_finErr) {
      apiLogger.error({ err: _finErr?.message || _finErr, conversationId, agentRowId },
        'ADR-0061 finalize+chip failed (non-fatal)');
    }
  }

  return responseText || null;
}

// Legacy alias for backward compatibility
export const executeAgentToolLoop = agentLoop;
