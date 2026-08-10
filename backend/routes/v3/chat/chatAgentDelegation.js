/**
 * Chat agent delegation, ticket status directives, auto-summary trigger, and callAgentAI.
 * Extracted from chatAgentExecution.js to keep files under 400 lines.
 */

import {
  dbGet, isPostgres, apiLogger,
  sharedResolveAgentProvider,
  parseInvocationMentions, parseInvocationCommands,
  triggerAutoSummaryIfNeeded, parseAutoSummarySettings, resolveAutoSummaryModel,
  generateSummaryPrompt, executeSimpleAI,
  ChainHandoffService, conversationLock,
  parseStatusDirective, TICKET_STATE_MAP, TICKET_TRANSITIONS,
  TICKETS_TABLE_ID_CHAT, BASE_URL_FOR_ATTACHMENTS,
} from './chatShared.js';
import { resolveMentionedUser, resolveAgentUser, autoJoinAgentToConversation } from './chatAgentHelpers.js';

// ── ADR-077 Task 3: Delegation loop prevention constants ──
const MAX_DELEGATION_DEPTH = 5;
const MAX_MENTIONS_PER_RESPONSE = 3;

// In-memory tracker for active delegation chains per conversation.
const _activeDelegationChains = new Map();

function getDelegationChain(conversationId) {
  if (!_activeDelegationChains.has(conversationId)) {
    const chain = { depth: 0, agentIds: new Set() };
    const timer = setTimeout(() => {
      _activeDelegationChains.delete(conversationId);
    }, 10 * 60 * 1000);
    if (timer.unref) timer.unref();
    _activeDelegationChains.set(conversationId, { ...chain, _timer: timer });
  }
  return _activeDelegationChains.get(conversationId);
}

function clearDelegationChain(conversationId) {
  const entry = _activeDelegationChains.get(conversationId);
  if (entry?._timer) clearTimeout(entry._timer);
  _activeDelegationChains.delete(conversationId);
}

// Helper: trigger auto-summary (fire-and-forget)
function _triggerAutoSummary(conversationId, agentConfig, convForSpace) {
  triggerAutoSummaryIfNeeded(
    conversationId, agentConfig,
    async (messages) => {
      const prompt = generateSummaryPrompt(messages);
      const summarySettings = parseAutoSummarySettings(agentConfig);
      const model = await resolveAutoSummaryModel(summarySettings);
      const result = await executeSimpleAI({
        input: prompt,
        systemPrompt: 'You are a concise summarizer. Produce a brief 2-3 sentence summary.',
        model, temperature: 0.3, maxTokens: 500,
      });
      return result?.content || result?.text || 'Summary unavailable';
    },
    convForSpace?.space_id || null
  ).catch(err => {
    apiLogger.warn({ err: err.message, conversationId }, 'ADR-110: Auto-summary fire-and-forget failed');
  });
}

// Helper: handle @mention delegation from agent response
// NOTE: executeAgentResponse is passed as a parameter to avoid circular dependency
function _handleDelegation(conversationId, responseText, agent, userId, options, convForSpace, executeAgentResponse) {
  const responseMentions = parseInvocationMentions(responseText);
  const responseCommands = parseInvocationCommands(responseText).map(c => c.slug);
  const allDelegations = [...new Set([...responseMentions, ...responseCommands])];
  if (allDelegations.length === 0) return;

  const respondingAgentName = agent.name || 'unknown';
  const respondingAgentId = agent.id || agent.managed_by_agent_row_id || respondingAgentName;
  const chain = getDelegationChain(conversationId);
  chain.depth += 1;
  chain.agentIds.add(respondingAgentId);

  if (chain.depth > MAX_DELEGATION_DEPTH) {
    apiLogger.warn({ conversationId, respondingAgent: respondingAgentName, depth: chain.depth, maxDepth: MAX_DELEGATION_DEPTH, chainAgents: [...chain.agentIds] },
      'ADR-117: Delegation depth limit reached — refusing further <<@slug>> delegation');
    clearDelegationChain(conversationId);
    return;
  }

  apiLogger.info({ conversationId, respondingAgent: respondingAgentName, mentions: responseMentions, commands: responseCommands, allDelegations, delegationDepth: chain.depth },
    'ADR-116: Agent response contains <<@slug>>/<</slug>> delegations — resolving');

  const cappedMentions = allDelegations.slice(0, MAX_MENTIONS_PER_RESPONSE);
  if (allDelegations.length > MAX_MENTIONS_PER_RESPONSE) {
    apiLogger.warn({ conversationId, respondingAgent: respondingAgentName, totalMentions: allDelegations.length, cap: MAX_MENTIONS_PER_RESPONSE },
      'ADR-077: Agent response mentions too many agents — capping to MAX_MENTIONS_PER_RESPONSE');
  }

  for (const mentionSlug of cappedMentions) {
    (async () => {
      try {
        const resolved = await resolveMentionedUser(mentionSlug);
        if (resolved) {
          const { user: mentionedUser, isAgent } = resolved;
          if (isAgent) {
            const mentionedAgentId = mentionedUser.id || mentionedUser.managed_by_agent_row_id || mentionedUser.name;
            if (mentionedUser.id === agent.id) return;
            if (chain.agentIds.has(mentionedAgentId)) {
              apiLogger.warn({ conversationId, fromAgent: respondingAgentName, toAgent: mentionedUser.name, toAgentId: mentionedAgentId, chainAgents: [...chain.agentIds] },
                'ADR-077: Circular delegation detected — agent already in chain, skipping');
              return;
            }
            if (mentionedUser.id) await autoJoinAgentToConversation(Number(conversationId), mentionedUser.id, { source: 'agent_delegation' });
            apiLogger.info({ conversationId, fromAgent: respondingAgentName, toAgent: mentionedUser.name, toUserId: mentionedUser.id, delegationDepth: chain.depth },
              'Ticket #43777: Delegating to @mentioned agent from agent response');
            chain.agentIds.add(mentionedAgentId);
            conversationLock.withLock(Number(conversationId), () =>
              executeAgentResponse(Number(conversationId), mentionedUser, userId, { ...options, message_content: responseText })
            ).catch(delegateErr => {
              apiLogger.error({ err: delegateErr.message, conversationId, fromAgent: respondingAgentName, toAgent: mentionedUser.name },
                'Ticket #43777: Agent @mention delegation failed');
            });
          } else {
            apiLogger.debug({ conversationId, slug: mentionSlug, userName: mentionedUser.name },
              'Ticket #43777: Agent mentioned a human user — no delegation (human only)');
          }
        } else {
          const fallbackAgent = await resolveAgentUser(mentionSlug, convForSpace?.space_id || null);
          if (fallbackAgent) {
            const fallbackAgentId = fallbackAgent.id || fallbackAgent.managed_by_agent_row_id || fallbackAgent.name;
            if (fallbackAgent.id === agent.id) return;
            if (chain.agentIds.has(fallbackAgentId)) {
              apiLogger.warn({ conversationId, fromAgent: respondingAgentName, toAgent: fallbackAgent.name, toAgentId: fallbackAgentId, chainAgents: [...chain.agentIds] },
                'ADR-077: Circular delegation detected (fallback) — agent already in chain, skipping');
              return;
            }
            if (fallbackAgent.id) await autoJoinAgentToConversation(Number(conversationId), fallbackAgent.id, { source: 'agent_delegation' });
            apiLogger.info({ conversationId, fromAgent: respondingAgentName, toAgent: fallbackAgent.name, delegationDepth: chain.depth },
              'Ticket #43777: Delegating to @mentioned agent (fallback resolution)');
            chain.agentIds.add(fallbackAgentId);
            conversationLock.withLock(Number(conversationId), () =>
              executeAgentResponse(Number(conversationId), fallbackAgent, userId, { ...options, message_content: responseText })
            ).catch(delegateErr => {
              apiLogger.error({ err: delegateErr.message, conversationId, fromAgent: respondingAgentName, toAgent: fallbackAgent.name },
                'Ticket #43777: Agent @mention delegation (fallback) failed');
            });
          } else {
            apiLogger.debug({ conversationId, slug: mentionSlug }, 'Ticket #43777: No agent found for @mention in response');
          }
        }
      } catch (mentionErr) {
        apiLogger.error({ err: mentionErr.message, conversationId, slug: mentionSlug }, 'Ticket #43777: Error processing @mention delegation');
      }
    })();
  }
}

// Helper: handle ticket status directives
function _handleTicketStatusDirective(conversationId, responseText, agent) {
  const directive = parseStatusDirective(responseText);
  if (!directive) return;
  (async () => {
    try {
      const conv = await dbGet(
        isPostgres() ? `SELECT bound_table_id, bound_row_id FROM conversations WHERE id = $1` : `SELECT bound_table_id, bound_row_id FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (conv && conv.bound_table_id === TICKETS_TABLE_ID_CHAT && conv.bound_row_id) {
        const targetStateId = TICKET_STATE_MAP[directive.targetState];
        if (targetStateId) {
          const ticket = await ChainHandoffService.getTicket(conv.bound_row_id);
          if (ticket) {
            const allowed = TICKET_TRANSITIONS[ticket.state] || [];
            if (allowed.includes(targetStateId)) {
              await ChainHandoffService.updateTicketStatus({
                ticket_id: conv.bound_row_id, new_state: targetStateId, agent_id: agent.id || null,
                notes: `Auto-updated from agent message status directive: ${directive.rawStatus}`,
              });
              apiLogger.info({ conversationId, ticketId: conv.bound_row_id, directive, targetStateId, agentName: agent.name },
                'ADR-077 Task #7: Auto-status-update from agent message in bound conversation');
            } else {
              apiLogger.debug({ conversationId, ticketId: conv.bound_row_id, currentState: ticket.state, targetStateId, directive },
                'ADR-077 Task #7: Auto-status-update skipped — transition not allowed');
            }
          }
        }
      }
    } catch (autoStatusErr) {
      apiLogger.warn({ err: autoStatusErr, conversationId }, 'ADR-077 Task #7: Auto-status-update failed (non-fatal)');
    }
  })();
}

/**
 * Call AI API for agent response
 */
async function callAgentAI(agent, message, history, systemPrompt, agentConfig, options = {}) {
  const { agent_mode = 'agent', thinking_enabled = false } = options;
  try {
    apiLogger.debug({ agent_mode, thinking_enabled }, 'AI call options');

    const resolved = await sharedResolveAgentProvider(agentConfig);
    let { apiKey } = resolved;
    const { model, provider, isLocal } = resolved;

    if (provider === 'claude-code') {
      apiLogger.info({ agentName: agent.name, model }, 'Using Claude Code CLI (local)');
      const { executeSimpleAI } = await import('../../../services/labs/ai-execution-service.js');
      const result = await executeSimpleAI({ provider: 'claude-code', model: model || 'claude-sonnet-4', input: message, systemPrompt });
      if (!result.success) {
        return { success: false, error: 'claude_code_error', message: `Claude Code execution failed: ${result.error || 'unknown error'}` };
      }
      return { success: true, content: result.content };
    }

    if (!apiKey) {
      apiLogger.warn({ agentName: agent.name, provider }, 'No API key found for agent, even after fallback');
      return { success: false, error: 'no_api_key', message: `No API key configured for provider "${provider}". Go to AI Agents settings → select operator → add a valid API key.` };
    }

    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }];

    let apiUrl = 'https://api.openai.com/v1/chat/completions';
    if (provider === 'anthropic') apiUrl = 'https://api.anthropic.com/v1/messages';
    else if (provider === 'openrouter') apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let requestBody;
    if (provider === 'anthropic') {
      requestBody = { model, max_tokens: thinking_enabled ? 16000 : 4096, system: systemPrompt, messages: messages.filter(m => m.role !== 'system') };
      if (thinking_enabled) requestBody.thinking = { type: 'enabled', budget_tokens: 10000 };
    } else {
      requestBody = { model, messages, max_tokens: 4096 };
    }

    const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(requestBody) });

    if (!response.ok) {
      const errText = await response.text();
      apiLogger.error({ status: response.status, error: errText }, 'AI API error');
      return { success: false, error: 'api_error', message: `AI API returned ${response.status}: ${errText.substring(0, 200)}` };
    }

    const data = await response.json();

    if (provider === 'anthropic') {
      if (Array.isArray(data.content)) {
        const thinkingBlocks = data.content.filter(b => b?.type === 'thinking' && b?.thinking);
        const textBlocks = data.content.filter(b => b?.type === 'text' && b?.text);
        const thinkingText = thinkingBlocks.map(b => b.thinking).join('\n') || null;
        const responseText = textBlocks.length > 0
          ? textBlocks.map(b => b.text).join('\n')
          : (data.content.find(b => b?.text)?.text || null);
        if (thinkingText) return { text: responseText || thinkingText, thinking: thinkingText };
        return responseText;
      }
      return data.content?.text || (typeof data.content === 'string' ? data.content : null);
    }
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    apiLogger.error({ err }, 'Error calling AI API');
    return { success: false, error: 'exception', message: `AI call failed: ${err?.message || 'unknown error'}` };
  }
}

export {
  MAX_DELEGATION_DEPTH, MAX_MENTIONS_PER_RESPONSE,
  _activeDelegationChains, getDelegationChain, clearDelegationChain,
  _triggerAutoSummary, _handleDelegation, _handleTicketStatusDirective,
  callAgentAI,
};
