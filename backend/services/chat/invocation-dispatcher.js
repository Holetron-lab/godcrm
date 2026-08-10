/**
 * ADR-117 / ADR-116: Centralized invocation dispatcher.
 *
 * Single entry point for parsing <<@slug>>/<</slug>> tokens from any source
 * and triggering the corresponding agent executions.
 *
 * Sources:
 *   - HTTP user message (messageController.js)
 *   - MCP `send_chat_message` tool (services/agent-tools/chat-tools.js)
 *   - Agent thinking/reasoning blocks (services/agent-loop/loop.js)
 *
 * Loop guards:
 *   - Self-trigger: skip if resolved agent.id === sourceAgentId.
 *   - Dedup window (30s): same (conversation, slug, sourceKey) won't fire twice.
 *   - Per-conversation delegation chain depth still enforced inside
 *     chatAgentDelegation._handleDelegation for final-text dispatch.
 *
 * NOTE: executeAgentResponse is loaded via dynamic import to break the
 * circular chain (loop.js -> dispatcher -> chatAgentExecution -> chatShared
 * -> AgentLoopService -> loop.js).
 */

import { dbGet, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { parseInvocationMentions, parseInvocationCommands } from './mention-parsers.js';
import conversationLock from '../ConversationLockService.js';

// All routes/v3/chat imports are LAZY to avoid a circular module chain:
// chat-tools.js -> dispatcher -> chatAgentHelpers -> chatShared -> AgentLoopService
// -> loop.js -> AgentToolsService -> executor.js -> chat-tools.js (TDZ).
let _lazyExecuteAgentResponse = null;
let _lazyHelpers = null;

async function _getExecutor() {
  if (_lazyExecuteAgentResponse) return _lazyExecuteAgentResponse;
  const mod = await import('../../routes/v3/chat/chatAgentExecution.js');
  _lazyExecuteAgentResponse = mod.executeAgentResponse;
  return _lazyExecuteAgentResponse;
}

async function _getHelpers() {
  if (_lazyHelpers) return _lazyHelpers;
  const mod = await import('../../routes/v3/chat/chatAgentHelpers.js');
  _lazyHelpers = {
    resolveMentionedUser: mod.resolveMentionedUser,
    resolveAgentUser: mod.resolveAgentUser,
    findAiAgentByCommand: mod.findAiAgentByCommand,
    autoJoinAgentToConversation: mod.autoJoinAgentToConversation,
  };
  return _lazyHelpers;
}

const _dedupCache = new Map();
const DEDUP_WINDOW_MS = 30 * 1000;

function _isDuplicate(conversationId, slug, sourceKey) {
  const key = `${conversationId}::${slug}::${sourceKey}`;
  const now = Date.now();
  const last = _dedupCache.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  _dedupCache.set(key, now);
  if (_dedupCache.size > 5000) {
    for (const [k, ts] of _dedupCache.entries()) {
      if (now - ts > DEDUP_WINDOW_MS) _dedupCache.delete(k);
    }
  }
  return false;
}

function _resolveCommandContent(content, agent, commandIndex) {
  const agentConfig = agent._agentConfig || {};
  const mainInstruction = agentConfig.main_instruction || agentConfig.main_instructions || null;
  if (!mainInstruction) return content;

  if (commandIndex == null) {
    return typeof mainInstruction === 'string' ? mainInstruction : JSON.stringify(mainInstruction);
  }

  try {
    const commands = typeof mainInstruction === 'string' ? JSON.parse(mainInstruction) : mainInstruction;
    if (Array.isArray(commands) && commands[commandIndex] != null) {
      const picked = commands[commandIndex];
      return typeof picked === 'string'
        ? picked
        : (picked.content || picked.text || picked.instruction || JSON.stringify(picked));
    }
    return typeof mainInstruction === 'string' ? mainInstruction : JSON.stringify(mainInstruction);
  } catch {
    return typeof mainInstruction === 'string' ? mainInstruction : String(mainInstruction);
  }
}

/**
 * Parse content for <<@slug>> / <</slug>> invocation tokens and trigger
 * agent executions. Returns counts; per-agent failures are logged but do
 * not throw.
 *
 * @param {object} args
 * @param {number} args.conversationId
 * @param {string} args.content
 * @param {number|null} args.userId — triggering user (or agent senderId)
 * @param {number|null} [args.spaceId]
 * @param {object} [args.agentOptions] — forwarded to executeAgentResponse
 * @param {string} [args.sourceLabel] — 'http' | 'mcp_tool' | 'thinking' | 'final_text'
 * @param {number|null} [args.sourceMessageId] — for dedup keying & logs
 * @param {number|null} [args.sourceAgentId] — originating agent id (skip self)
 * @returns {Promise<{triggered:number, skipped:number}>}
 */
export async function dispatchInvocationsFromContent({
  conversationId, content, userId,
  spaceId = null, agentOptions = {}, sourceLabel = 'unknown',
  sourceMessageId = null, sourceAgentId = null,
}) {
  if (!content || typeof content !== 'string') return { triggered: 0, skipped: 0 };

  const agentMentions = [...new Set(parseInvocationMentions(content))];
  const rawCommands = parseInvocationCommands(content);
  const seenCommandSlugs = new Set();
  const agentCommands = [];
  for (const cmd of rawCommands) {
    if (!seenCommandSlugs.has(cmd.slug)) {
      seenCommandSlugs.add(cmd.slug);
      agentCommands.push(cmd);
    }
  }
  const commandSlugs = new Set(agentCommands.map(c => c.slug));
  const mentionsFiltered = agentMentions.filter(slug => !commandSlugs.has(slug));

  if (agentCommands.length === 0 && mentionsFiltered.length === 0) {
    return { triggered: 0, skipped: 0 };
  }

  let _spaceId = spaceId;
  if (_spaceId == null) {
    const conv = await dbGet(
      isPostgres() ? `SELECT space_id FROM conversations WHERE id = $1`
                   : `SELECT space_id FROM conversations WHERE id = ?`,
      [conversationId]
    );
    _spaceId = conv?.space_id || null;
  }

  const sourceKey = sourceMessageId != null ? `msg:${sourceMessageId}` : `${sourceLabel}`;
  const executeAgentResponse = await _getExecutor();
  const { resolveMentionedUser, resolveAgentUser, findAiAgentByCommand, autoJoinAgentToConversation } = await _getHelpers();

  apiLogger.info({
    conversationId, sourceLabel, sourceMessageId, sourceAgentId,
    agentCommands: agentCommands.map(c => c.slug), agentMentions: mentionsFiltered,
  }, 'ADR-117 dispatcher: invocations detected');

  let triggered = 0;
  let skipped = 0;

  for (const cmd of agentCommands) {
    const { slug, commandIndex } = cmd;
    if (_isDuplicate(conversationId, slug, sourceKey)) {
      apiLogger.debug({ conversationId, slug, sourceKey }, 'ADR-117 dispatcher: dedup skip /command');
      skipped++; continue;
    }
    let agent = await resolveAgentUser(slug, _spaceId);
    if (!agent) agent = await findAiAgentByCommand(slug, _spaceId);
    if (!agent) {
      apiLogger.warn({ conversationId, slug, sourceLabel }, 'ADR-117 dispatcher: /command agent not found');
      skipped++; continue;
    }
    if (sourceAgentId != null && agent.id === sourceAgentId) {
      apiLogger.debug({ conversationId, slug, sourceAgentId }, 'ADR-117 dispatcher: skip self-invocation /command');
      skipped++; continue;
    }
    if (agent.id) await autoJoinAgentToConversation(Number(conversationId), agent.id, { source: 'command' });
    const commandContent = _resolveCommandContent(content, agent, commandIndex);

    apiLogger.info({ conversationId, slug, agentName: agent.name, sourceLabel }, 'ADR-117 dispatcher: triggering /command');
    triggered++;
    conversationLock.withLock(Number(conversationId), () =>
      executeAgentResponse(Number(conversationId), agent, userId, {
        ...agentOptions, message_content: commandContent, invocation_type: 'command',
      })
    ).catch(err => {
      apiLogger.error({ err: err.message, conversationId, slug, sourceLabel }, 'ADR-117 dispatcher: /command execution failed');
    });
  }

  for (const slug of mentionsFiltered) {
    if (_isDuplicate(conversationId, slug, sourceKey)) {
      apiLogger.debug({ conversationId, slug, sourceKey }, 'ADR-117 dispatcher: dedup skip @mention');
      skipped++; continue;
    }
    let agent = null;
    let isAgent = false;
    const resolved = await resolveMentionedUser(slug);
    if (resolved) {
      agent = resolved.user;
      isAgent = resolved.isAgent;
    } else {
      const fallback = await resolveAgentUser(slug, _spaceId);
      if (fallback) { agent = fallback; isAgent = true; }
    }
    if (!agent) {
      apiLogger.warn({ conversationId, slug, sourceLabel }, 'ADR-117 dispatcher: @mention user/agent not found');
      skipped++; continue;
    }
    if (!isAgent) {
      apiLogger.debug({ conversationId, slug, userName: agent.name }, 'ADR-117 dispatcher: @mention is human — no execution');
      if (agent.id) await autoJoinAgentToConversation(Number(conversationId), agent.id, { source: 'mention' });
      skipped++; continue;
    }
    if (sourceAgentId != null && agent.id === sourceAgentId) {
      apiLogger.debug({ conversationId, slug, sourceAgentId }, 'ADR-117 dispatcher: skip self-invocation @mention');
      skipped++; continue;
    }
    if (agent.id) await autoJoinAgentToConversation(Number(conversationId), agent.id, { source: 'mention' });
    apiLogger.info({ conversationId, slug, agentName: agent.name, sourceLabel }, 'ADR-117 dispatcher: triggering @mention');
    triggered++;
    conversationLock.withLock(Number(conversationId), () =>
      executeAgentResponse(Number(conversationId), agent, userId, {
        ...agentOptions, message_content: content, invocation_type: 'mention',
      })
    ).catch(err => {
      apiLogger.error({ err: err.message, conversationId, slug, sourceLabel }, 'ADR-117 dispatcher: @mention execution failed');
    });
  }

  return { triggered, skipped };
}

/**
 * Returns true if the content contains any invocation tokens.
 * Used by callers to skip the dispatcher entirely for non-invocation content.
 */
export function hasInvocationTokens(content) {
  if (!content || typeof content !== 'string') return false;
  return /<<@[a-z0-9_-]+>>|<<\/[a-z][a-z0-9_-]*(?:\/\d+)?>>/i.test(content);
}
