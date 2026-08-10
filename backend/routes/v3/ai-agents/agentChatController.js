/** Agent Chat Controller — POST /chat (ADR-093 Phase 2, Account mode) */
import { Router } from 'express';
import { dbGet, dbRun, isPostgres } from '../../../database/connection.js';
import { executeTool } from '../../../services/AgentToolsService.js';
import { apiLogger } from '../../../utils/logger.js';
import aiExecutionService from '../../../services/labs/ai-execution-service.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import {
  resolveAgentProvider as sharedResolveAgentProvider,
  buildAgentSystemPrompt as sharedBuildAgentSystemPrompt,
  detectProvider as sharedDetectProvider,
  getHistoryLimit as sharedGetHistoryLimit,
  fetchBoundRowContext,
  loadConversationHistory as sharedLoadConversationHistory,
  markSyncActive,
  markSyncInactive,
} from '../../../services/chat/agent-execution-shared.js';
import { logToolUsed } from '../../../services/AgentActivityLogger.js';
import {
  safeParseJSON, resolveAgentRelations, saveStepMessage,
  setConversationProcessing, getMaxOutputTokens, fetchWithRateRetry,
} from './shared.js';
import {
  getAllowedTools, toAnthropicTools, getAnthropicText,
  sanitizeToolResult, injectToolContext,
} from './sharedTools.js';
import { logInteraction } from './sharedInteractionLog.js';

const router = Router();

router.post('/chat', async (req, res) => {
  if (req.socket) req.socket.setTimeout(1800 * 1000); // BUG-504: 30 min timeout
  try {
    const { agentId, message, history = [], spaceId, modelId: modelIdOverride, conversationId } = req.body;
    const userId = req.user?.id;
    if (!message) return badRequest(res, 'Message is required');
    if (!agentId) return badRequest(res, 'Agent ID is required');

    const agentRow = await dbGet(`
      SELECT tr.data, tr.table_id, ut.project_id, p.space_id
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      JOIN projects p ON ut.project_id = p.id
      WHERE tr.id = ? AND (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%')
    `, [agentId]);

    if (!agentRow) return notFound(res, 'Agent');

    const agentConfig = safeParseJSON(agentRow.data, {});
    await resolveAgentRelations(agentConfig, agentRow.table_id);
    const agentSpaceId = agentRow.space_id;

    apiLogger.debug({ context: 'AI Chat', data: [agentConfig.name, agentConfig.operator_id], agentSpaceId, requestedSpaceId: spaceId }, 'Agent config');

    const resolved = await sharedResolveAgentProvider(agentConfig, {
      spaceId: agentSpaceId, modelIdOverride,
    });
    let { operatorData, apiKey } = resolved;
    const { model, provider: providerName, isLocal } = resolved;

    if (!isLocal && !apiKey) return badRequest(res, 'No API key configured for this agent');

    const { isClaudeCode, isCopilot, isAnthropic } = sharedDetectProvider(providerName, model);

    apiLogger.debug({ context: 'AI Chat', model, providerName, isAnthropic, isClaudeCode, isCopilot }, 'Final config');

    const boundRowContext = conversationId ? await fetchBoundRowContext(conversationId) : null;
    const systemPrompt = await sharedBuildAgentSystemPrompt(agentConfig, {
      spaceId: agentSpaceId, conversationId, boundRow: boundRowContext,
      // ADR-113 follow-up (#81861): builder names the planning tool that exists in this
      // host — claude-code → TodoWrite, native loop → manage_plan.
      isClaudeCode,
    }, 'account');

    const messages = [{ role: 'system', content: systemPrompt }];

    if (conversationId) {
      const dbHistory = await sharedLoadConversationHistory(conversationId, agentConfig);
      messages.push(...dbHistory);
    } else if (history && Array.isArray(history)) {
      const historyLimit = sharedGetHistoryLimit(agentConfig);
      if (historyLimit > 0) messages.push(...history.slice(-historyLimit));
    }

    messages.push({ role: 'user', content: message });

    const toolResults = [];
    let responseText = '';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let iterations = 1;
    const agentLoopStartTime = Date.now();
    const allowedTools = await getAllowedTools(agentConfig, agentSpaceId);

    if (conversationId) {
      await setConversationProcessing(conversationId, true, { agentId, agentName: agentConfig.name || null });
      markSyncActive(conversationId); // shield from watchdog orphan-reaper while alive
    }

    try {
    const resolvedMaxTokens = getMaxOutputTokens(model, agentConfig);
    apiLogger.info({ context: 'AI Chat', model, resolvedMaxTokens, isAnthropic, isClaudeCode, isCopilot }, 'Agent loop starting');

    if (isCopilot) {
      const cliResult = await aiExecutionService.executeCopilotCli({
        model, messages, systemPrompt, maxTokens: resolvedMaxTokens
      });
      responseText = cliResult.content;
      if (conversationId && responseText) {
        await saveStepMessage(conversationId, {
          content: responseText, contentType: 'text', role: 'assistant',
          senderType: 'agent', agentId, modelUsed: model
        });
      }
    } else if (isClaudeCode) {
      const onEvent = conversationId ? (event) => {
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_use') {
              saveStepMessage(conversationId, {
                content: block.name, contentType: 'tool_call', role: 'assistant',
                senderType: 'agent', agentId, modelUsed: model,
                toolResults: { tool: block.name, args: block.input }
              }).catch(() => {});
            } else if (block.type === 'text' && block.text) {
              saveStepMessage(conversationId, {
                content: block.text, contentType: 'thinking', role: 'assistant',
                senderType: 'agent', agentId, modelUsed: model
              }).catch(() => {});
            }
          }
        } else if (event.type === 'user' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_result') {
              const resultContent = typeof block.content === 'string'
                ? block.content : JSON.stringify(block.content);
              const truncated = resultContent.length > 2000 ? resultContent.substring(0, 2000) + '...' : resultContent;
              saveStepMessage(conversationId, {
                content: truncated, contentType: 'tool_result', role: 'tool',
                senderType: 'agent', agentId,
                toolResults: { tool_use_id: block.tool_use_id, content: truncated }
              }).catch(() => {});
            }
          }
        }
      } : undefined;

      const cliResult = await aiExecutionService.executeClaudeCode({
        model, messages, systemPrompt, maxTokens: resolvedMaxTokens, onEvent
      });
      responseText = cliResult.content;
      usage = {
        prompt_tokens: cliResult.usage?.promptTokens || 0,
        completion_tokens: cliResult.usage?.completionTokens || 0,
        total_tokens: cliResult.usage?.totalTokens || 0
      };
      if (conversationId && responseText) {
        await saveStepMessage(conversationId, {
          content: responseText, contentType: 'text', role: 'assistant',
          senderType: 'agent', agentId, modelUsed: model,
          tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens
        });
      }
    } else if (isAnthropic) {
      const anthropicTools = allowedTools.length ? toAnthropicTools(allowedTools) : [];
      const maxIterations = Number(agentConfig.max_iterations) > 0 ? Number(agentConfig.max_iterations) : 10;
      const loopMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content
      }));

      for (let i = 0; i < maxIterations; i++) {
        iterations = i + 1;
        const anthropicResponse = await fetchWithRateRetry('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model, max_tokens: resolvedMaxTokens, system: systemPrompt,
            messages: loopMessages, ...(anthropicTools.length ? { tools: anthropicTools } : {})
          })
        });

        if (!anthropicResponse.ok) {
          const errorText = await anthropicResponse.text();
          apiLogger.error({ err: errorText, context: 'AI Chat' }, 'Anthropic error');
          return error(res, 'ANTHROPIC_API_ERROR', 'Anthropic API error: ' + errorText, 500);
        }

        const anthropicData = await anthropicResponse.json();
        const stopReason = anthropicData.stop_reason;
        usage = {
          prompt_tokens: anthropicData.usage?.input_tokens || usage.prompt_tokens,
          completion_tokens: anthropicData.usage?.output_tokens || usage.completion_tokens,
          total_tokens: (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0)
        };

        apiLogger.info({ context: 'AI Chat', iteration: i + 1, maxIterations, stopReason }, 'Agent loop iteration');

        const contentBlocks = anthropicData.content || [];
        const textContent = getAnthropicText(contentBlocks);
        if (textContent) responseText = textContent;

        const toolUses = Array.isArray(contentBlocks)
          ? contentBlocks.filter((item) => item?.type === 'tool_use') : [];

        if (stopReason === 'max_tokens' && !toolUses.length) {
          apiLogger.warn({ context: 'AI Chat', iteration: i + 1 }, 'Model hit max_tokens, nudging to continue');
          if (contentBlocks.length) {
            loopMessages.push({ role: 'assistant', content: contentBlocks });
            loopMessages.push({ role: 'user', content: 'Your previous response was cut off due to output token limit. Please continue where you left off. Be more concise.' });
          }
          continue;
        }

        if (!toolUses.length) {
          apiLogger.info({ context: 'AI Chat', iteration: i + 1, stopReason, responseLength: responseText.length }, 'Agent loop finished');
          if (conversationId && textContent) {
            await saveStepMessage(conversationId, {
              content: textContent, contentType: 'text', role: 'assistant',
              senderType: 'agent', agentId, modelUsed: model,
              tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens
            });
          }
          break;
        }

        if (conversationId && textContent) {
          await saveStepMessage(conversationId, {
            content: textContent, contentType: 'thinking', role: 'assistant',
            senderType: 'agent', agentId, modelUsed: model
          });
        }

        loopMessages.push({ role: 'assistant', content: contentBlocks });

        const toolResultBlocks = [];
        for (const toolUse of toolUses) {
          const toolName = toolUse?.name;
          if (!toolName) continue;
          const args = injectToolContext(toolName, toolUse?.input || {}, { spaceId: agentSpaceId, userId });

          if (conversationId) {
            await saveStepMessage(conversationId, {
              content: toolName, contentType: 'tool_call', role: 'assistant',
              senderType: 'agent', agentId, modelUsed: model,
              toolResults: { tool: toolName, args }
            });
          }

          apiLogger.info({ toolName, args, spaceId: agentSpaceId }, 'Executing tool (AI Chat)');
          const _aiToolStart = Date.now();
          const result = sanitizeToolResult(await executeTool(toolName, args, userId, {
            // ADR-165 WP-1: thread the resolved allowlist so executeTool() can
            // gate the invoked tool against the agent's capability scope.
            allowedTools, agentId, agentName: agentConfig.name,
          }));
          toolResults.push({ tool: toolName, args, result });

          logToolUsed(agentConfig.name || 'unknown', toolName, conversationId, { duration_ms: Date.now() - _aiToolStart });

          if (conversationId) {
            const resultStr = JSON.stringify(result);
            await saveStepMessage(conversationId, {
              content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...' : resultStr,
              contentType: 'tool_result', role: 'tool', senderType: 'agent', agentId,
              toolResults: { tool: toolName, args, result }
            });
          }

          toolResultBlocks.push({
            type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result)
          });
        }

        if (!toolResultBlocks.length) break;
        loopMessages.push({ role: 'user', content: toolResultBlocks });
      }
      if (iterations >= maxIterations) {
        apiLogger.warn({ context: 'AI Chat', iterations, maxIterations }, 'Agent loop exhausted max iterations (Anthropic)');
      }
    } else {
      // OpenAI path
      const toolChoice = allowedTools.length ? 'auto' : undefined;
      const maxIterations = Number(agentConfig.max_iterations) > 0 ? Number(agentConfig.max_iterations) : 10;
      const loopMessages = [...messages];

      for (let i = 0; i < maxIterations; i++) {
        iterations = i + 1;
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model, messages: loopMessages, temperature: agentConfig.temperature || 0.7,
            max_tokens: resolvedMaxTokens,
            ...(allowedTools.length ? { tools: allowedTools, tool_choice: toolChoice } : {})
          })
        });

        if (!openaiResponse.ok) {
          const errorText = await openaiResponse.text();
          apiLogger.error({ err: errorText, context: 'AI Chat' }, 'OpenAI error');
          return error(res, 'OPENAI_API_ERROR', 'OpenAI API error: ' + errorText, 500);
        }

        const openaiData = await openaiResponse.json();
        usage = openaiData.usage || usage;
        const choice = openaiData.choices?.[0]?.message;
        const finishReason = openaiData.choices?.[0]?.finish_reason;

        apiLogger.info({ context: 'AI Chat', iteration: i + 1, maxIterations, finishReason }, 'Agent loop iteration (OpenAI)');

        if (!choice) { responseText = ''; break; }

        if (finishReason === 'length' && (!choice.tool_calls || choice.tool_calls.length === 0)) {
          if (choice.content) {
            loopMessages.push({ role: 'assistant', content: choice.content });
            loopMessages.push({ role: 'user', content: 'Your previous response was cut off due to output token limit. Please continue where you left off. Be more concise.' });
          }
          continue;
        }

        if (!choice.tool_calls || choice.tool_calls.length === 0) {
          responseText = choice.content || '';
          apiLogger.info({ context: 'AI Chat', iteration: i + 1, finishReason, responseLength: responseText.length }, 'Agent loop finished (OpenAI)');
          if (conversationId && responseText) {
            await saveStepMessage(conversationId, {
              content: responseText, contentType: 'text', role: 'assistant',
              senderType: 'agent', agentId, modelUsed: model,
              tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens
            });
          }
          break;
        }

        if (conversationId && choice.content) {
          await saveStepMessage(conversationId, {
            content: choice.content, contentType: 'thinking', role: 'assistant',
            senderType: 'agent', agentId, modelUsed: model
          });
        }

        loopMessages.push({
          role: 'assistant', content: choice.content || '', tool_calls: choice.tool_calls
        });

        for (const toolCall of choice.tool_calls) {
          const toolName = toolCall.function?.name;
          if (!toolName) continue;
          let args = {};
          try { args = toolCall.function?.arguments ? safeParseJSON(toolCall.function.arguments, {}) : {}; } catch { args = {}; }
          args = injectToolContext(toolName, args, { spaceId: agentSpaceId, userId });

          if (conversationId) {
            await saveStepMessage(conversationId, {
              content: toolName, contentType: 'tool_call', role: 'assistant',
              senderType: 'agent', agentId, modelUsed: model,
              toolResults: { tool: toolName, args }
            });
          }

          const result = sanitizeToolResult(await executeTool(toolName, args, userId, {
            // ADR-165 WP-1: thread the resolved allowlist so executeTool() can
            // gate the invoked tool against the agent's capability scope.
            allowedTools, agentId, agentName: agentConfig.name,
          }));
          toolResults.push({ tool: toolName, args, result });

          if (conversationId) {
            const resultStr = JSON.stringify(result);
            await saveStepMessage(conversationId, {
              content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...' : resultStr,
              contentType: 'tool_result', role: 'tool', senderType: 'agent', agentId,
              toolResults: { tool: toolName, args, result }
            });
          }

          loopMessages.push({
            role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result)
          });
        }
      }
      if (iterations >= maxIterations) {
        apiLogger.warn({ context: 'AI Chat', iterations, maxIterations }, 'Agent loop exhausted max iterations (OpenAI)');
      }
    }

    } finally {
      if (conversationId) {
        markSyncInactive(conversationId);
        await setConversationProcessing(conversationId, false);
      }
    }

    await logInteraction({
      spaceId: agentSpaceId, agentId, agentName: agentConfig.name,
      userId, model, providerName, message, responseText, usage,
      iterations, toolResults, agentLoopStartTime
    });

    return success(res, {
      data: {
        response: responseText, toolResults, iterations,
        usage: { tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, totalTokens: usage.total_tokens },
        model, agent: { id: agentId, name: agentConfig.name }
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error in AI chat');
    if (req.body?.conversationId) {
      try { await setConversationProcessing(req.body.conversationId, false); } catch { /* ignore */ }
    }
    return error(res, 'AI_CHAT_ERROR', 'Failed to process chat request: ' + err.message, 500);
  }
});

export default router;
