/**
 * Message routes: send message, get messages, update/delete messages.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound, forbidden,
  requireAuth, getAttachmentBaseUrl, conversationLock,
  parseInvocationMentions, parseInvocationCommands,
} from './chatShared.js';
import {
  resolveMentionedUser, resolveAgentUser, findAiAgentByCommand,
  autoJoinAgentToConversation, resolveAgentInfoForMessages,
} from './chatAgentHelpers.js';
import { executeAgentResponse } from './chatAgentExecution.js';
import { getAutoRespondAgents, shouldAutoRespondWithAI, getDefaultAgentForConversation } from './chatAgentAutoRespond.js';

export default function registerMessageRoutes(router) {

  // POST /conversations/:id/messages - Send message
  router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const { content, content_type = 'text', mentions = [], parent_id, attachments, agent_mode, thinking_enabled } = req.body;

      let participant = await dbGet(
        isPostgres() ? `SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2` : `SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!participant) {
        const conversation = await dbGet(isPostgres() ? `SELECT * FROM conversations WHERE id = $1` : `SELECT * FROM conversations WHERE id = ?`, [id]);
        if (!conversation) return notFound(res, 'Conversation not found');

        if (conversation.type === 'task' || conversation.type === 'row') {
          if (isPostgres()) await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW()) ON CONFLICT (conversation_id, user_id) DO NOTHING`, [id, userId]);
          else await dbRun(`INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', datetime('now'))`, [id, userId]);
          participant = { conversation_id: id, user_id: userId, role: 'member' };
          apiLogger.info({ conversationId: id, userId, type: conversation.type }, 'Ticket #41349: Auto-added user to conversation');
        } else {
          return notFound(res, 'Conversation not found');
        }
      }

      const mentionsJson = JSON.stringify(mentions);
      const attachmentsJson = attachments ? JSON.stringify(attachments) : '[]';
      const role = 'user';
      const metadata = {};
      if (agent_mode) metadata.agent_mode = agent_mode;
      if (thinking_enabled !== undefined && thinking_enabled !== null) metadata.thinking_enabled = !!thinking_enabled;
      const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '{}';

      let result;
      if (isPostgres()) {
        result = await dbRun(`INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, parent_id, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, NOW())`,
          [id, userId, role, content, content_type, mentionsJson, attachmentsJson, parent_id || null, metadataJson]);
      } else {
        result = await dbRun(`INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, parent_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [id, userId, role, content, content_type, mentionsJson, attachmentsJson, parent_id || null, metadataJson]);
      }

      const messageId = result.lastInsertRowid;
      if (isPostgres()) await dbRun(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [id]);
      else await dbRun(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`, [id]);

      const message = await dbGet(isPostgres() ? `SELECT * FROM messages WHERE id = $1` : `SELECT * FROM messages WHERE id = ?`, [messageId]);

      const agentMentions = [...new Set(parseInvocationMentions(content))];
      const rawCommands = parseInvocationCommands(content);
      // Deduplicate commands by slug (keep first occurrence with its commandIndex)
      const seenCommandSlugs = new Set();
      const agentCommands = [];
      for (const cmd of rawCommands) {
        if (!seenCommandSlugs.has(cmd.slug)) {
          seenCommandSlugs.add(cmd.slug);
          agentCommands.push(cmd);
        }
      }
      // Cross-deduplicate: if same slug is both @mentioned and /commanded, only trigger once (via command)
      const commandSlugs = new Set(agentCommands.map(c => c.slug));
      const mentionsFiltered = agentMentions.filter(slug => !commandSlugs.has(slug));
      const hasExplicitTriggers = agentCommands.length > 0 || mentionsFiltered.length > 0;

      apiLogger.info({ conversationId: id, messageId, content: content?.substring(0, 100), agentCommands, agentMentions, hasExplicitTriggers, agent_mode, thinking_enabled },
        'Ticket #41834: Single entry point — message saved, determining agents (@ and / separated)');

      const parsedAttachments = attachments ? (typeof attachments === 'string' ? JSON.parse(attachments) : attachments) : [];
      const attachmentBaseUrl = getAttachmentBaseUrl(req);
      const agentOptions = { agent_mode: agent_mode || 'agent', thinking_enabled: !!thinking_enabled, attachments: parsedAttachments, attachmentBaseUrl };

      const convForSpaceId = await dbGet(isPostgres() ? `SELECT space_id FROM conversations WHERE id = $1` : `SELECT space_id FROM conversations WHERE id = ?`, [id]);
      const _convSpaceId = convForSpaceId?.space_id || null;

      if (hasExplicitTriggers) {
        (async () => {
          let anyAgentResolved = false;

          for (const cmd of agentCommands) {
            const { slug, commandIndex } = cmd;
            apiLogger.info({ slug, commandIndex, trigger: '/' }, 'Ticket #41834: Resolving /command agent');
            let agent = await resolveAgentUser(slug, _convSpaceId);
            if (!agent) {
              agent = await findAiAgentByCommand(slug, _convSpaceId);
            }
            if (agent) {
              anyAgentResolved = true;
              if (agent.id) await autoJoinAgentToConversation(Number(id), agent.id, { source: 'command' });

              // Resolve message content: use main_instruction from agent config
              let commandContent = content;
              const agentConfig = agent._agentConfig || {};
              const mainInstruction = agentConfig.main_instruction || agentConfig.main_instructions || null;
              if (mainInstruction) {
                if (commandIndex != null) {
                  // <</slug/N>> — pick Nth quick command from JSON array
                  try {
                    const commands = typeof mainInstruction === 'string' ? JSON.parse(mainInstruction) : mainInstruction;
                    if (Array.isArray(commands) && commands[commandIndex] != null) {
                      const picked = commands[commandIndex];
                      commandContent = typeof picked === 'string' ? picked : (picked.content || picked.text || picked.instruction || JSON.stringify(picked));
                      apiLogger.info({ slug, commandIndex, picked: commandContent?.substring(0, 100) }, '/command: Using quick command from main_instruction array');
                    } else {
                      apiLogger.warn({ slug, commandIndex, isArray: Array.isArray(commands), length: Array.isArray(commands) ? commands.length : 0 }, '/command: Invalid commandIndex — falling back to full main_instruction');
                      commandContent = typeof mainInstruction === 'string' ? mainInstruction : JSON.stringify(mainInstruction);
                    }
                  } catch (parseErr) {
                    // Not JSON — use as plain string
                    commandContent = typeof mainInstruction === 'string' ? mainInstruction : String(mainInstruction);
                    apiLogger.info({ slug, commandIndex }, '/command: main_instruction is not JSON array — using as plain text');
                  }
                } else {
                  // <</slug>> — use entire main_instruction as message
                  commandContent = typeof mainInstruction === 'string' ? mainInstruction : JSON.stringify(mainInstruction);
                  apiLogger.info({ slug, contentPreview: commandContent?.substring(0, 100) }, '/command: Using main_instruction as message content');
                }
              }

              apiLogger.info({ conversationId: id, slug, agentName: agent.name, agentUserId: agent.id, hasMainInstruction: !!mainInstruction, commandIndex }, 'Ticket #41834: Triggering /command agent response');
              await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), agent, userId, {
                ...agentOptions, message_content: commandContent, invocation_type: 'command',
              }));
            } else {
              apiLogger.warn({ slug }, 'Ticket #41834: Agent not found for /command — will fallback to auto-respond if no other agents resolve');
            }
          }

          for (const slug of mentionsFiltered) {
            apiLogger.info({ slug, trigger: '@' }, 'Ticket #41834: Resolving @mention user');
            const resolved = await resolveMentionedUser(slug);
            if (resolved) {
              const { user: mentionedUser, isAgent } = resolved;
              anyAgentResolved = true;
              if (mentionedUser.id) await autoJoinAgentToConversation(Number(id), mentionedUser.id, { source: 'mention' });
              if (isAgent) {
                apiLogger.info({ conversationId: id, slug, userName: mentionedUser.name, userId: mentionedUser.id, isAgent: true }, 'Ticket #41834: @mentioned agent — triggering response');
                await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), mentionedUser, userId, { ...agentOptions, message_content: content, invocation_type: 'mention' }));
              } else {
                apiLogger.info({ conversationId: id, slug, userName: mentionedUser.name, userId: mentionedUser.id, isAgent: false }, 'Ticket #41834: @mentioned human user — added as participant');
              }
            } else {
              const agent = await resolveAgentUser(slug, _convSpaceId);
              if (agent) {
                anyAgentResolved = true;
                if (agent.id) await autoJoinAgentToConversation(Number(id), agent.id, { source: 'mention' });
                apiLogger.info({ conversationId: id, slug, agentName: agent.name }, 'Ticket #41834: @mention fallback to agent resolution');
                await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), agent, userId, { ...agentOptions, message_content: content, invocation_type: 'mention' }));
              } else {
                apiLogger.warn({ slug }, 'Ticket #41834: User not found for @mention');
                try {
                  await dbRun(
                    isPostgres() ? `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at) VALUES ($1, 'system', 'system', $2, 'system', NOW(), NOW())`
                    : `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at) VALUES (?, 'system', 'system', ?, 'system', datetime('now'), datetime('now'))`,
                    [Number(id), `User '@${slug}' not found. Check the username and try again.`]
                  );
                } catch (msgErr) { apiLogger.error({ err: msgErr }, 'Ticket #41834: Failed to save user-not-found message'); }
              }
            }
          }

          if (!anyAgentResolved) {
            apiLogger.info({ conversationId: id, agentCommands, agentMentions }, 'Bug fix: No agents resolved from explicit triggers — falling back to auto-respond');
            const autoRespondAgents = await getAutoRespondAgents(Number(id), userId, content);
            if (autoRespondAgents.length > 0) {
              for (const agent of autoRespondAgents) {
                await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), agent, userId, { ...agentOptions, message_content: content }));
              }
            } else {
              const autoRespond = await shouldAutoRespondWithAI(Number(id), userId);
              if (autoRespond) {
                const defaultAgent = await getDefaultAgentForConversation(Number(id));
                if (defaultAgent) await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), defaultAgent, userId, { ...agentOptions, message_content: content }));
              }
            }
          }
        })().catch(err => { apiLogger.error({ err, conversationId: id }, 'Ticket #41834: Error processing mentions/commands'); });
      } else {
        (async () => {
          const autoRespondAgents = await getAutoRespondAgents(Number(id), userId, content);
          if (autoRespondAgents.length > 0) {
            apiLogger.info({ conversationId: id, agentCount: autoRespondAgents.length, agentNames: autoRespondAgents.map(a => a.name) }, 'Ticket #41349: Auto-respond agents found via getAutoRespondAgents');
            for (const agent of autoRespondAgents) {
              await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), agent, userId, { ...agentOptions, message_content: content }));
            }
          } else {
            const autoRespond = await shouldAutoRespondWithAI(Number(id), userId);
            if (autoRespond) {
              const defaultAgent = await getDefaultAgentForConversation(Number(id));
              if (defaultAgent) {
                apiLogger.info({ conversationId: id, agentName: defaultAgent.name }, 'Ticket #41349: Solo mode — default agent auto-respond');
                await conversationLock.withLock(Number(id), () => executeAgentResponse(Number(id), defaultAgent, userId, { ...agentOptions, message_content: content }));
              } else { apiLogger.debug({ conversationId: id }, 'Ticket #41349: Solo mode but no default agent configured'); }
            }
          }
        })().catch(err => { apiLogger.error({ err, conversationId: id }, 'Ticket #41349: Error in auto-respond check'); });
      }

      return created(res, { ...message, mentions: safeJsonParse(message.mentions) || [], attachments: safeJsonParse(message.attachments) || [], metadata: safeJsonParse(message.metadata) || {} });
    } catch (err) {
      apiLogger.error('Error sending message:', err);
      return error(res, 'SEND_MESSAGE_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/messages - Get messages with pagination
  // Supports ?content_types=text,plan,tool_approval to exclude heavy tool/thinking messages (lazy loading)
  router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 2000);
      const before = req.query.before ? parseInt(req.query.before) : null;

      let afterId = null, afterTimestamp = null;
      if (req.query.after) {
        const parsed = parseInt(req.query.after, 10);
        if (!isNaN(parsed) && String(parsed) === req.query.after) { afterId = parsed; }
        else {
          const ts = new Date(req.query.after);
          if (!isNaN(ts.getTime())) { afterTimestamp = req.query.after; }
          else { return badRequest(res, 'Invalid `after` parameter: must be a message ID (integer) or ISO 8601 timestamp'); }
        }
      }

      // Content type filtering — whitelist specific content_types to reduce payload
      // e.g. ?content_types=text,plan,tool_approval  (excludes thinking, tool_call, tool_result)
      const VALID_CONTENT_TYPES = ['text', 'thinking', 'tool_call', 'tool_result', 'tool_approval', 'plan', 'markdown', 'code', 'image'];
      let contentTypeFilter = '';
      const contentTypesParam = req.query.content_types;
      let filteringToolSteps = false;
      if (contentTypesParam) {
        const types = contentTypesParam.split(',').map(t => t.trim()).filter(t => VALID_CONTENT_TYPES.includes(t));
        if (types.length > 0) {
          // Include NULL content_type when 'text' is in the filter (legacy messages have NULL)
          const includeNull = types.includes('text');
          contentTypeFilter = ` AND (m.content_type IN (${types.map(t => `'${t}'`).join(',')})${includeNull ? ' OR m.content_type IS NULL' : ''})`;
          filteringToolSteps = !types.includes('tool_call');
        }
      }

      let messagesQuery, messagesParams;
      const selectFields = isPostgres()
        ? `m.*, u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type`
        : `m.*, u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type`;
      const fromJoin = `FROM messages m LEFT JOIN users u ON m.sender_id = u.id`;

      if (afterId && before) {
        // Range query: messages between afterId and before (exclusive on both ends)
        // Used for lazy-loading tool steps between two known message IDs
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id > $2 AND m.id < $3${contentTypeFilter} ORDER BY m.id ASC LIMIT $4`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id > ? AND m.id < ?${contentTypeFilter} ORDER BY m.id ASC LIMIT ?`;
        messagesParams = [id, afterId, before, limit];
      } else if (afterId) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id > $2${contentTypeFilter} ORDER BY m.id ASC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id > ?${contentTypeFilter} ORDER BY m.id ASC LIMIT ?`;
        messagesParams = [id, afterId, limit];
      } else if (afterTimestamp) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.created_at > $2${contentTypeFilter} ORDER BY m.created_at ASC, m.id ASC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.created_at > ?${contentTypeFilter} ORDER BY m.created_at ASC, m.id ASC LIMIT ?`;
        messagesParams = [id, afterTimestamp, limit];
      } else if (before) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id < $2${contentTypeFilter} ORDER BY m.id DESC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id < ?${contentTypeFilter} ORDER BY m.id DESC LIMIT ?`;
        messagesParams = [id, before, limit + 1];
      } else {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1${contentTypeFilter} ORDER BY m.id DESC LIMIT $2`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ?${contentTypeFilter} ORDER BY m.id DESC LIMIT ?`;
        messagesParams = [id, limit + 1];
      }

      const [rawMessages, conversation] = await Promise.all([
        dbAll(messagesQuery, messagesParams),
        dbGet(isPostgres()
          ? `SELECT settings, bound_table_id, bound_row_id, is_processing, processing_started_at, processing_agent_id, processing_agent_name FROM conversations WHERE id = $1`
          : `SELECT settings, bound_table_id, bound_row_id, is_processing, processing_started_at, processing_agent_id, processing_agent_name FROM conversations WHERE id = ?`, [id])
      ]);

      let messages, hasMore, nextCursor;
      if (afterId || afterTimestamp) {
        messages = rawMessages; hasMore = false; nextCursor = null;
      } else {
        hasMore = rawMessages.length > limit;
        messages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
        messages.reverse();
        nextCursor = hasMore && messages.length > 0 ? messages[0].id : null;
      }

      const parsed = messages.map(m => ({
        ...m, mentions: safeJsonParse(m.mentions) || [], attachments: safeJsonParse(m.attachments) || [],
        contentType: m.content_type || 'text', senderType: m.sender_type || 'human',
        toolResults: m.tool_results ? safeJsonParse(m.tool_results) : null,
        parentId: m.parent_id || null, timestamp: m.created_at,
        sender_name: m.sender_name || null, sender_avatar: m.sender_avatar || null, sender_user_type: m.sender_user_type || null,
      }));

      // Annotate messages with hidden tool step counts when content_types filter is active
      if (filteringToolSteps && parsed.length > 0) {
        const minId = parsed[0].id;
        const maxId = parsed[parsed.length - 1].id;
        // Get IDs of hidden tool steps in the same ID range
        const hiddenStepsSql = isPostgres()
          ? `SELECT id FROM messages WHERE conversation_id = $1 AND content_type IN ('thinking', 'tool_call', 'tool_result') AND id >= $2 AND id <= $3 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY id`
          : `SELECT id FROM messages WHERE conversation_id = ? AND content_type IN ('thinking', 'tool_call', 'tool_result') AND id >= ? AND id <= ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY id`;
        const hiddenSteps = await dbAll(hiddenStepsSql, [id, minId, maxId]);
        const hiddenIds = hiddenSteps.map(r => r.id);

        if (hiddenIds.length > 0) {
          // For each message, count hidden steps between previous message and this one
          for (let i = 0; i < parsed.length; i++) {
            const currentId = parsed[i].id;
            const prevId = i > 0 ? parsed[i - 1].id : minId - 1;
            const count = hiddenIds.filter(hid => hid > prevId && hid < currentId).length;
            if (count > 0) {
              parsed[i]._tool_steps_before = count;
            }
          }
          // Also count steps after the last message (for processing indicator)
          const afterLast = hiddenIds.filter(hid => hid > parsed[parsed.length - 1].id).length;
          if (afterLast > 0 && parsed.length > 0) {
            parsed[parsed.length - 1]._tool_steps_after = afterLast;
          }
        }
      }

      const resolvedMessages = await resolveAgentInfoForMessages(parsed);

      // Context stats
      const contextStatsSql = isPostgres()
        ? `SELECT COALESCE(SUM(tokens_in),0)::int as total_tokens_in, COALESCE(SUM(tokens_out),0)::int as total_tokens_out, COUNT(*)::int as total_messages, COUNT(CASE WHEN content_type='text' OR content_type IS NULL THEN 1 END)::int as text_messages, COUNT(CASE WHEN content_type='tool_call' THEN 1 END)::int as tool_calls, COUNT(CASE WHEN content_type='thinking' THEN 1 END)::int as thinking_steps FROM messages WHERE conversation_id=$1`
        : `SELECT COALESCE(SUM(tokens_in),0) as total_tokens_in, COALESCE(SUM(tokens_out),0) as total_tokens_out, COUNT(*) as total_messages, COUNT(CASE WHEN content_type='text' OR content_type IS NULL THEN 1 END) as text_messages, COUNT(CASE WHEN content_type='tool_call' THEN 1 END) as tool_calls, COUNT(CASE WHEN content_type='thinking' THEN 1 END) as thinking_steps FROM messages WHERE conversation_id=?`;

      const lastAgentMsgSql = isPostgres()
        ? `SELECT tokens_in, model_used FROM messages WHERE conversation_id=$1 AND tokens_in>0 AND model_used IS NOT NULL ORDER BY id DESC LIMIT 1`
        : `SELECT tokens_in, model_used FROM messages WHERE conversation_id=? AND tokens_in>0 AND model_used IS NOT NULL ORDER BY id DESC LIMIT 1`;

      const [contextStatsRow, lastAgentMsg] = await Promise.all([dbGet(contextStatsSql, [id]), dbGet(lastAgentMsgSql, [id])]);

      const MODEL_CONTEXT_WINDOWS = { 'claude-3-5-sonnet': 200000, 'claude-3.5-sonnet': 200000, 'claude-sonnet-4': 200000, 'claude-4-sonnet': 200000, 'claude-opus-4': 200000, 'claude-4-opus': 200000, 'claude-3-opus': 200000, 'claude-3-haiku': 200000, 'claude-3.5-haiku': 200000, 'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192, 'o1': 200000, 'o3': 200000, 'o3-mini': 200000, 'o4-mini': 200000 };
      const modelUsed = lastAgentMsg?.model_used || null;
      let contextWindow = null;
      if (modelUsed) {
        const modelLower = modelUsed.toLowerCase();
        contextWindow = MODEL_CONTEXT_WINDOWS[modelLower] || null;
        if (!contextWindow) { for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) { if (modelLower.startsWith(key) || modelLower.includes(key)) { contextWindow = value; break; } } }
        if (!contextWindow) contextWindow = 200000;
      }
      const lastPromptTokens = lastAgentMsg?.tokens_in || 0;
      const contextUsagePercent = contextWindow && lastPromptTokens > 0 ? Math.round((lastPromptTokens / contextWindow) * 100) : null;

      const context_stats = {
        total_tokens_in: Number(contextStatsRow?.total_tokens_in) || 0, total_tokens_out: Number(contextStatsRow?.total_tokens_out) || 0,
        total_messages: Number(contextStatsRow?.total_messages) || 0, text_messages: Number(contextStatsRow?.text_messages) || 0,
        tool_calls: Number(contextStatsRow?.tool_calls) || 0, thinking_steps: Number(contextStatsRow?.thinking_steps) || 0,
        last_prompt_tokens: lastPromptTokens, model_used: modelUsed, context_window: contextWindow, context_usage_percent: contextUsagePercent,
      };

      return success(res, {
        messages: resolvedMessages, hasMore, nextCursor,
        settings: safeJsonParse(conversation?.settings) || {},
        bound_table_id: conversation?.bound_table_id || null, bound_row_id: conversation?.bound_row_id || null,
        is_processing: conversation?.is_processing ? true : false, processing_started_at: conversation?.processing_started_at || null,
        processing_agent_id: conversation?.processing_agent_id || null, processing_agent_name: conversation?.processing_agent_name || null,
        context_stats,
      });
    } catch (err) {
      apiLogger.error({ err }, 'Error getting messages');
      return error(res, 'GET_MESSAGES_ERROR', err.message, 500);
    }
  });

  // PATCH /messages/:messageId/content - Update message content (checkbox toggle)
  router.patch('/messages/:messageId/content', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const { content } = req.body;
      if (!content || typeof content !== 'string') return badRequest(res, 'content is required and must be a string');
      const message = await dbGet(isPostgres() ? 'SELECT id, conversation_id, sender_id, content, is_deleted FROM messages WHERE id = $1' : 'SELECT id, conversation_id, sender_id, content, is_deleted FROM messages WHERE id = ?', [messageId]);
      if (!message) return notFound(res, 'Message not found');
      if (message.is_deleted) return badRequest(res, 'Cannot update a deleted message');
      await dbRun(isPostgres() ? `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2` : `UPDATE messages SET content = ?, updated_at = datetime('now') WHERE id = ?`, [content, messageId]);
      apiLogger.info({ messageId, conversationId: message.conversation_id }, 'Message content updated (checkbox toggle)');
      return success(res, { updated: true, message_id: Number(messageId) });
    } catch (err) {
      apiLogger.error('Error updating message content:', err);
      return error(res, 'UPDATE_MESSAGE_CONTENT_ERROR', err.message, 500);
    }
  });

  // DELETE /messages/:messageId - Soft delete message
  router.delete('/messages/:messageId', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;
      const message = await dbGet(isPostgres() ? 'SELECT id, sender_id, is_deleted FROM messages WHERE id = $1' : 'SELECT id, sender_id, is_deleted FROM messages WHERE id = ?', [messageId]);
      if (!message) return notFound(res, 'Message not found');
      if (Number(message.sender_id) !== Number(userId)) return forbidden(res, 'You can only delete your own messages');
      if (message.is_deleted) return success(res, { already_deleted: true });
      await dbRun(isPostgres() ? `UPDATE messages SET is_deleted = 1, updated_at = NOW() WHERE id = $1` : `UPDATE messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [messageId]);
      apiLogger.info({ messageId, userId }, 'Message soft deleted');
      return success(res, { deleted: true, message_id: messageId });
    } catch (err) {
      apiLogger.error('Error deleting message:', err);
      return error(res, 'DELETE_MESSAGE_ERROR', err.message, 500);
    }
  });
}
