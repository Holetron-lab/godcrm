/**
 * Message routes: send message, get messages, update/delete messages.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound, forbidden,
  requireAuth, getAttachmentBaseUrl, conversationLock,
  parseInvocationMentions, parseInvocationCommands,
} from './chatShared.js';
// ADR-0031 P5 / ADR-133 WP-20 — move-with-stub
import { moveMessages, MoveValidationError, MoveAuthError } from '../../../services/messageMoveService.js';
// ADR-0031 P6 — spawn ticket from criterion chat
import { spawnTicketFromCriterion, SpawnValidationError } from '../../../services/criterionTicketSpawnService.js';
import { canAdminister } from '../../../services/EffectiveRoleService.js';
import {
  resolveMentionedUser, resolveAgentUser, findAiAgentByCommand,
  autoJoinAgentToConversation, resolveAgentInfoForMessages,
} from './chatAgentHelpers.js';
// ADR-0068 WP-B — comment-thread child lookup (single source of truth).
import { getCommentThreadChildId } from '../../../services/chat/rowAttachment.js';
import { executeAgentResponse } from './chatAgentExecution.js';
import { getAutoRespondAgents, shouldAutoRespondWithAI, getDefaultAgentForConversation } from './chatAgentAutoRespond.js';
// ADR-0057-A WP-B — UNION _inflight_runs ∪ agent_jobs for the presence array.
// Adds reason/resume_at/paused_at; older agent_jobs-only fields stay populated.
import { queryActiveInflight } from '../../../services/inflight/queryActive.js';

// ADR-0031 WP-20+21 (T-141237): content_type whitelist for POST /messages.
// Adds 'widget_embed' so agents/users can embed live mini-widgets in chat.
// Unknown values are rejected with 400 — no DB migration, just an expanded validator.
const ALLOWED_POST_CONTENT_TYPES = new Set([
  'text', 'thinking', 'tool_call', 'tool_result', 'tool_approval',
  'plan', 'markdown', 'code', 'image', 'agent_status', 'system',
  'call', 'row_mutation', 'moved', 'widget_embed', 'widget_row',
]);

// ADR-0068 WP-C — partial-text quote payload. Persisted in messages.metadata.reply_to.
// fragment + range describe a substring of `content`; missing means full-message reply.
// Returns { ok, value, error } so the caller can 400 with a precise message.
function validateReplyTo(rt) {
  if (rt == null) return { ok: true, value: null };
  if (typeof rt !== 'object' || Array.isArray(rt)) {
    return { ok: false, error: 'reply_to must be an object' };
  }
  const { message_id, sender, content, fragment, range } = rt;
  if (typeof message_id !== 'number' || !Number.isFinite(message_id) || message_id <= 0) {
    return { ok: false, error: 'reply_to.message_id must be a positive number' };
  }
  if (typeof sender !== 'string' || sender.length === 0) {
    return { ok: false, error: 'reply_to.sender must be a non-empty string' };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'reply_to.content must be a string' };
  }
  const out = { message_id, sender, content };
  if (fragment !== undefined) {
    if (typeof fragment !== 'string') {
      return { ok: false, error: 'reply_to.fragment must be a string' };
    }
    if (fragment.length > content.length) {
      return { ok: false, error: 'reply_to.fragment.length must be <= reply_to.content.length' };
    }
    out.fragment = fragment;
  }
  if (range !== undefined) {
    if (!Array.isArray(range) || range.length !== 2
      || typeof range[0] !== 'number' || typeof range[1] !== 'number'
      || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
      return { ok: false, error: 'reply_to.range must be [number, number]' };
    }
    if (range[0] < 0 || range[1] > content.length || range[0] > range[1]) {
      return { ok: false, error: 'reply_to.range is out of bounds' };
    }
    out.range = [range[0], range[1]];
  }
  return { ok: true, value: out };
}

export default function registerMessageRoutes(router) {

  // POST /conversations/:id/messages - Send message
  router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const {
        content, content_type = 'text', mentions = [], parent_id, attachments,
        agent_mode, thinking_enabled,
        // ADR-0068 WP-B4 — persona override. Default persona is 'user'.
        // 'space' = owner posting as the space (sender_user_id retained for audit).
        // 'agent' is reserved for server-side agent paths; rejected from REST input.
        sender_kind: requestedSenderKind,
        sender_space_id: requestedSenderSpaceId,
        // ADR-0068 WP-C — reply with optional partial-text quote (fragment + range).
        reply_to,
      } = req.body;

      // ADR-0031 WP-20+21: validate content_type against whitelist.
      if (content_type != null && !ALLOWED_POST_CONTENT_TYPES.has(content_type)) {
        return badRequest(res, `invalid content_type "${content_type}" — allowed: ${[...ALLOWED_POST_CONTENT_TYPES].join(', ')}`);
      }

      // ADR-0068 WP-C — validate reply_to shape (out-of-bounds rejected here, not later).
      const replyToCheck = validateReplyTo(reply_to);
      if (!replyToCheck.ok) {
        return badRequest(res, replyToCheck.error);
      }

      // ADR-0068 WP-B — load the conversation up front for readonly + space
      // ownership checks. The original handler only fetched it lazily when no
      // participant row existed; moving the read here is a fixed-cost SELECT
      // against an indexed PK that we already paid for in most code paths
      // (e.g. the space_id read on line ~115).
      const conversation = await dbGet(
        isPostgres()
          ? `SELECT id, type, space_id, created_by, is_readonly, parent_conversation_id, purpose FROM conversations WHERE id = $1`
          : `SELECT id, type, space_id, created_by, is_readonly, parent_conversation_id, purpose FROM conversations WHERE id = ?`,
        [id]
      );
      if (!conversation) return notFound(res, 'Conversation not found');

      // ADR-0068 WP-B4 — validate persona override. Only 'user' (default) and
      // 'space' are accepted from REST input; 'agent' is server-side only and
      // must come from the agent-execution path, never from a user request.
      let senderKind = 'user';
      let senderSpaceId = null;
      if (requestedSenderKind != null && requestedSenderKind !== 'user') {
        if (requestedSenderKind !== 'space') {
          return badRequest(res, `invalid sender_kind "${requestedSenderKind}" — only 'user' and 'space' accepted via REST`);
        }
        const targetSpaceId = Number(requestedSenderSpaceId);
        if (!Number.isFinite(targetSpaceId) || targetSpaceId <= 0) {
          return badRequest(res, `sender_kind='space' requires a valid sender_space_id`);
        }
        // Persona scope: the space the caller is posting AS must match the
        // conversation's space. Cross-space personas are out of scope for WP-B.
        if (conversation.space_id && Number(conversation.space_id) !== targetSpaceId) {
          return badRequest(res, `sender_space_id (${targetSpaceId}) must match the conversation's space (${conversation.space_id})`);
        }
        // Owner gate — caller must be the chat owner OR a space admin (same
        // policy as messages/move and spawn-ticket, reusing EffectiveRoleService).
        const isChatOwner = Number(conversation.created_by) === Number(userId);
        const isSpaceAdmin = conversation.space_id
          ? await canAdminister(userId, { spaceId: conversation.space_id })
          : false;
        if (!isChatOwner && !isSpaceAdmin) {
          return forbidden(res, 'send-as-space requires chat owner or space admin');
        }
        senderKind = 'space';
        senderSpaceId = targetSpaceId;
      }

      // ADR-0068 WP-B3 — channel-style readonly guard. Non-owners are blocked
      // from sending to a `is_readonly = true` parent. Owners posting as the
      // space (validated above) bypass the lock — that's how a "channel"
      // broadcaster reaches their audience. Children of a readonly parent
      // (comment threads) remain writable regardless of the parent's flag.
      if (conversation.is_readonly && !(senderKind === 'space')) {
        // Surface the comment-thread child id (if any) so the client can
        // redirect the user there instead of just bouncing them.
        const childId = await getCommentThreadChildId(id);
        return forbidden(res, JSON.stringify({
          code: 'READONLY_CONVERSATION',
          message: 'This conversation is read-only — non-owners cannot post here.',
          comment_thread_child_id: childId,
        }));
      }

      let participant = await dbGet(
        isPostgres() ? `SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2` : `SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
        [id, userId]
      );

      if (!participant) {
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
      if (replyToCheck.value) metadata.reply_to = replyToCheck.value;
      const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '{}';

      // ADR-0068 WP-B4 — sender_id ALWAYS the real user (audit trail). Persona
      // ships via sender_kind + sender_space_id, never by overwriting sender_id.
      let result;
      if (isPostgres()) {
        result = await dbRun(`INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, parent_id, metadata, sender_kind, sender_space_id, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, NOW())`,
          [id, userId, role, content, content_type, mentionsJson, attachmentsJson, parent_id || null, metadataJson, senderKind, senderSpaceId]);
      } else {
        result = await dbRun(`INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, parent_id, metadata, sender_kind, sender_space_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [id, userId, role, content, content_type, mentionsJson, attachmentsJson, parent_id || null, metadataJson, senderKind, senderSpaceId]);
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
      const VALID_CONTENT_TYPES = ['text', 'thinking', 'tool_call', 'tool_result', 'tool_approval', 'plan', 'markdown', 'code', 'image', 'agent_status', 'row_mutation', 'moved'];
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
        ? `m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type`
        : `m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type`;
      const fromJoin = `FROM messages m LEFT JOIN users u ON m.sender_id = u.id`;
      const deletedFilter = ` AND (m.is_deleted IS NULL OR m.is_deleted = 0)`;

      if (afterId && before) {
        // Range query: messages between afterId and before (exclusive on both ends)
        // Used for lazy-loading tool steps between two known message IDs
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id > $2 AND m.id < $3${deletedFilter}${contentTypeFilter} ORDER BY m.id ASC LIMIT $4`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id > ? AND m.id < ?${deletedFilter}${contentTypeFilter} ORDER BY m.id ASC LIMIT ?`;
        messagesParams = [id, afterId, before, limit];
      } else if (afterId) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id > $2${deletedFilter}${contentTypeFilter} ORDER BY m.id ASC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id > ?${deletedFilter}${contentTypeFilter} ORDER BY m.id ASC LIMIT ?`;
        messagesParams = [id, afterId, limit];
      } else if (afterTimestamp) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.created_at > $2${deletedFilter}${contentTypeFilter} ORDER BY m.created_at ASC, m.id ASC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.created_at > ?${deletedFilter}${contentTypeFilter} ORDER BY m.created_at ASC, m.id ASC LIMIT ?`;
        messagesParams = [id, afterTimestamp, limit];
      } else if (before) {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1 AND m.id < $2${deletedFilter}${contentTypeFilter} ORDER BY m.id DESC LIMIT $3`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ? AND m.id < ?${deletedFilter}${contentTypeFilter} ORDER BY m.id DESC LIMIT ?`;
        messagesParams = [id, before, limit + 1];
      } else {
        messagesQuery = isPostgres()
          ? `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = $1${deletedFilter}${contentTypeFilter} ORDER BY m.id DESC LIMIT $2`
          : `SELECT ${selectFields} ${fromJoin} WHERE m.conversation_id = ?${deletedFilter}${contentTypeFilter} ORDER BY m.id DESC LIMIT ?`;
        messagesParams = [id, limit + 1];
      }

      const [rawMessages, conversation] = await Promise.all([
        dbAll(messagesQuery, messagesParams).then(rows => {
          if (contentTypesParam === 'agent_status') {
            apiLogger.info({ conversationId: id, rowCount: rows?.length, query: messagesQuery, params: messagesParams }, 'DEBUG agent_status query result');
          }
          return rows;
        }),
        dbGet(isPostgres()
          ? `SELECT settings, bound_table_id, bound_row_id, is_processing, processing_started_at, processing_agent_id, processing_agent_name, parent_conversation_id, purpose, is_readonly FROM conversations WHERE id = $1`
          : `SELECT settings, bound_table_id, bound_row_id, is_processing, processing_started_at, processing_agent_id, processing_agent_name, parent_conversation_id, purpose, is_readonly FROM conversations WHERE id = ?`, [id])
      ]);

      // Auto-clear stale is_processing flags — but only if agent is truly dead.
      // Agents (especially Orchestrator) can run for hours, so we check if the
      // agent_status message was recently updated (within 5 min) before clearing.
      // If agent_status was updated recently, the agent is alive — just long-running.
      if (conversation?.is_processing && conversation.processing_started_at) {
        const staleMs = Date.now() - new Date(conversation.processing_started_at).getTime();
        if (staleMs > 10 * 60 * 1000) {
          // Check if agent_status was recently updated (agent still alive)
          const recentStatus = await dbGet(isPostgres()
            ? `SELECT updated_at FROM messages WHERE conversation_id = $1 AND content_type = 'agent_status' AND agent_id = $2 ORDER BY updated_at DESC LIMIT 1`
            : `SELECT updated_at FROM messages WHERE conversation_id = ? AND content_type = 'agent_status' AND agent_id = ? ORDER BY updated_at DESC LIMIT 1`,
            [id, conversation.processing_agent_id]);
          const statusAge = recentStatus?.updated_at
            ? Date.now() - new Date(recentStatus.updated_at).getTime()
            : Infinity;
          if (statusAge > 5 * 60 * 1000) {
            // Agent hasn't updated status in 5+ minutes AND processing started 10+ min ago → truly dead
            await dbRun(isPostgres()
              ? `UPDATE conversations SET is_processing = false, processing_agent_id = NULL, processing_agent_name = NULL, processing_started_at = NULL WHERE id = $1`
              : `UPDATE conversations SET is_processing = false, processing_agent_id = NULL, processing_agent_name = NULL, processing_started_at = NULL WHERE id = ?`, [id]);
            conversation.is_processing = false;
            conversation.processing_agent_name = null;
          } else {
            // Agent is still alive — refresh processing_started_at to prevent re-checking every poll
            await dbRun(isPostgres()
              ? `UPDATE conversations SET processing_started_at = NOW() WHERE id = $1`
              : `UPDATE conversations SET processing_started_at = datetime('now') WHERE id = ?`, [id]);
          }
        }
      }

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
        metadata: typeof m.metadata === 'string' ? safeJsonParse(m.metadata, {}) : (m.metadata || {}),
        parentId: m.parent_id || null, timestamp: m.created_at,
        sender_name: m.sender_name || null, sender_avatar: m.sender_avatar || null, sender_user_type: m.sender_user_type || null,
        pinned_at: m.pinned_at || null, // ADR-0068 WP-E
      }));

      // Annotate messages with hidden step counts (split by type: thinking vs tool)
      // For each visible message, count hidden thinking/tool steps that belong to
      // the same agent turn (between the previous visible message and this one).
      // Also provide _hidden_range_start / _hidden_range_end so the frontend knows
      // the exact ID boundaries to fetch when lazy-loading steps.
      if (filteringToolSteps && parsed.length > 0) {
        const minId = parsed[0].id;
        const maxId = parsed[parsed.length - 1].id;

        // Find the closest non-filtered message BEFORE minId (to catch steps before
        // the first visible message) and AFTER maxId (steps after last visible).
        // BUG FIX: agent_status and plan are NOT fetched by LAZY_CONTENT_TYPES (text,tool_approval),
        // so they must be treated as invisible (like thinking/tool_call/tool_result) when computing
        // range bounds. Otherwise, an agent_status message between the last visible text message
        // and the agent's steps creates a false boundary, and steps after it are never found.
        const boundsSql = isPostgres()
          ? `SELECT
               (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = $1 AND id < $2 AND content_type NOT IN ('thinking','tool_call','tool_result','agent_status','plan')) AS prev_visible_id,
               (SELECT COALESCE(MIN(id), 0) FROM messages WHERE conversation_id = $1 AND id > $3 AND content_type NOT IN ('thinking','tool_call','tool_result','agent_status','plan')) AS next_visible_id`
          : `SELECT
               (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ? AND id < ? AND content_type NOT IN ('thinking','tool_call','tool_result','agent_status','plan')) AS prev_visible_id,
               (SELECT COALESCE(MIN(id), 0) FROM messages WHERE conversation_id = ? AND id > ? AND content_type NOT IN ('thinking','tool_call','tool_result','agent_status','plan')) AS next_visible_id`;
        const boundsParams = isPostgres() ? [id, minId, maxId] : [id, minId, id, maxId];
        const bounds = await dbGet(boundsSql, boundsParams);
        const rangeStart = bounds?.prev_visible_id || 0;  // 0 means no previous visible message
        const rangeEnd = bounds?.next_visible_id || 0;     // 0 means no next visible message

        // Fetch hidden steps in the expanded range with content preview for thinking
        const expandedMin = rangeStart > 0 ? rangeStart : 0;
        // When no next visible message exists (agent still working), fetch ALL hidden steps after last visible
        const expandedMax = rangeEnd > 0 ? rangeEnd : 2147483647;
        // ADR-129 WP-B6: Extend preview to ALL content types (was thinking-only, hiding tool_call/tool_result previews)
        const hiddenStepsSql = isPostgres()
          ? `SELECT id, content_type, agent_id, LEFT(content, 150) AS preview, metadata->>'agent_name' AS agent_name, metadata->>'agent_icon' AS agent_icon, metadata->>'agent_color' AS agent_color FROM messages WHERE conversation_id = $1 AND content_type IN ('thinking', 'tool_call', 'tool_result') AND id > $2 AND id < $3 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY id`
          : `SELECT id, content_type, agent_id, SUBSTR(content, 1, 150) AS preview, json_extract(metadata, '$.agent_name') AS agent_name, json_extract(metadata, '$.agent_icon') AS agent_icon, json_extract(metadata, '$.agent_color') AS agent_color FROM messages WHERE conversation_id = ? AND content_type IN ('thinking', 'tool_call', 'tool_result') AND id > ? AND id < ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY id`;
        const hiddenSteps = await dbAll(hiddenStepsSql, [id, expandedMin, expandedMax]);

        // Build chronological step groups between visible messages
        // Each group: { type: 'thinking'|'tools', count, first_id, last_id, preview?, agent_name?, agent_icon?, agent_color? }
        const buildStepGroups = (steps) => {
          if (steps.length === 0) return [];
          const groups = [];
          let currentType = null; // 'thinking' or 'tools'
          let currentGroup = null;
          for (const step of steps) {
            const stepType = step.content_type === 'thinking' ? 'thinking' : 'tools';
            if (stepType !== currentType) {
              if (currentGroup) groups.push(currentGroup);
              currentGroup = {
                type: stepType,
                count: 1,
                first_id: step.id,
                last_id: step.id,
              };
              if (stepType === 'thinking' && step.preview) {
                currentGroup.preview = step.preview;
              }
              // Carry agent info from first step of the group
              if (step.agent_name) currentGroup.agent_name = step.agent_name;
              if (step.agent_icon) currentGroup.agent_icon = step.agent_icon;
              if (step.agent_color) currentGroup.agent_color = step.agent_color;
              currentType = stepType;
            } else {
              currentGroup.count++;
              currentGroup.last_id = step.id;
              // For thinking, concatenate previews (up to first few)
              if (stepType === 'thinking' && step.preview && currentGroup.count <= 3) {
                currentGroup.preview = (currentGroup.preview || '') + '\n' + step.preview;
              }
            }
          }
          if (currentGroup) groups.push(currentGroup);
          return groups;
        };

        if (hiddenSteps.length > 0) {
          // For each visible message, build step groups between previous visible and this one.
          // FIX: If the current message is a user message but the previous is an agent message,
          // attach the step groups as _step_groups_after on the agent message instead of
          // _step_groups_before on the user message. TurnBody only processes step groups for
          // agent turns, so annotations on user messages were silently ignored — causing
          // "agent steps without final message" to disappear.
          for (let i = 0; i < parsed.length; i++) {
            const currentId = parsed[i].id;
            const prevId = i > 0 ? parsed[i - 1].id : rangeStart;
            const between = hiddenSteps.filter(h => h.id > prevId && h.id < currentId);
            if (between.length > 0) {
              const currentIsUser = parsed[i].role === 'user';
              if (currentIsUser) {
                // Only attach to the IMMEDIATELY preceding visible message if it's an agent message.
                // Previously we searched all the way back, which could attach steps to an agent
                // from a completely different turn — causing the steps to be lost and consecutive
                // user messages to be incorrectly merged (no _step_groups annotations between them).
                if (i > 0 && parsed[i - 1].role === 'assistant') {
                  const agentMsg = parsed[i - 1];
                  const existingGroups = agentMsg._step_groups_after || [];
                  agentMsg._step_groups_after = [...existingGroups, ...buildStepGroups(between)];
                  agentMsg._total_hidden_after = (agentMsg._total_hidden_after || 0) + between.length;
                } else {
                  // Previous visible message is user or doesn't exist — attach to current user message
                  parsed[i]._step_groups_before = buildStepGroups(between);
                  parsed[i]._total_hidden_before = between.length;
                }
              } else {
                parsed[i]._step_groups_before = buildStepGroups(between);
                parsed[i]._total_hidden_before = between.length;
              }
            }
          }
          // Groups after the last visible message
          const lastVisibleId = parsed[parsed.length - 1].id;
          const afterLast = hiddenSteps.filter(h => h.id > lastVisibleId);
          if (afterLast.length > 0) {
            parsed[parsed.length - 1]._step_groups_after = buildStepGroups(afterLast);
            parsed[parsed.length - 1]._total_hidden_after = afterLast.length;
          }
        }
      }

      // Truncate content for tool_result messages when truncate_content param is set
      // Used for L3 progressive loading: show tool calls with preview of results
      const truncateContent = parseInt(req.query.truncate_content) || 0;
      if (truncateContent > 0) {
        for (const msg of parsed) {
          if (msg.content_type === 'tool_result' && msg.content && msg.content.length > truncateContent) {
            msg._full_length = msg.content.length;
            msg.content = msg.content.substring(0, truncateContent);
            msg._truncated = true;
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

      // ADR-0057 WP-C + ADR-0057-A WP-B: source-of-truth presence query.
      // Every agent currently bound to this conversation maps to one badge.
      // Frontend reads this array and ignores the legacy is_processing /
      // processing_agent_* scalars. WP-B widens the source from agent_jobs
      // alone to UNION(_inflight_runs ∪ agent_jobs) so paused runs surface
      // with reason/resume_at/paused_at. See queryActive.js for the SQL.
      let active_agents = [];
      try {
        active_agents = await queryActiveInflight(id);
      } catch (activeErr) {
        apiLogger.warn({ err: activeErr.message, conversationId: id }, 'ADR-0057-A WP-B: active_agents query failed (non-fatal)');
      }

      // Always include active agent_status + plan in response (even for incremental polls).
      // This eliminates the need for separate frontend fetches and prevents race conditions.
      let active_agent_status = null;
      let active_plan = null;
      try {
        const statusRow = await dbGet(isPostgres()
          ? `SELECT m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.content_type = 'agent_status' AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.id DESC LIMIT 1`
          : `SELECT m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.content_type = 'agent_status' AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.id DESC LIMIT 1`,
          [id]);
        if (statusRow) {
          const meta = typeof statusRow.metadata === 'string' ? safeJsonParse(statusRow.metadata, {}) : (statusRow.metadata || {});
          if (meta.placeholder === true && meta.agent_status !== 'finished' && meta.agent_status !== 'error') {
            active_agent_status = {
              ...statusRow,
              contentType: 'agent_status', senderType: statusRow.sender_type || 'agent',
              metadata: meta, timestamp: statusRow.created_at,
              mentions: safeJsonParse(statusRow.mentions) || [], attachments: safeJsonParse(statusRow.attachments) || [],
            };
          }
        }
        const planRow = await dbGet(isPostgres()
          ? `SELECT m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.content_type = 'plan' AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.id DESC LIMIT 1`
          : `SELECT m.*, u.name as sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as sender_avatar, u.user_type as sender_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.content_type = 'plan' AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.id DESC LIMIT 1`,
          [id]);
        if (planRow) {
          const planMeta = typeof planRow.metadata === 'string' ? safeJsonParse(planRow.metadata, {}) : (planRow.metadata || {});
          const planAge = planRow.updated_at ? Date.now() - new Date(planRow.updated_at).getTime() : Infinity;
          if (planAge < 2 * 60 * 60 * 1000) {
            active_plan = {
              ...planRow,
              contentType: 'plan', senderType: planRow.sender_type || 'agent',
              metadata: planMeta, timestamp: planRow.created_at,
              mentions: safeJsonParse(planRow.mentions) || [], attachments: safeJsonParse(planRow.attachments) || [],
            };
          }
        }
      } catch (liveErr) {
        apiLogger.warn({ err: liveErr.message, conversationId: id }, 'Failed to fetch active agent_status/plan (non-fatal)');
      }

      // ADR-0068 WP-B — surface child id when on a parent so clients can
      // render the chip without a second round-trip.
      let comment_thread_child_id = null;
      try {
        comment_thread_child_id = await getCommentThreadChildId(id);
      } catch (_) { /* non-fatal */ }

      return success(res, {
        messages: resolvedMessages, hasMore, nextCursor,
        settings: safeJsonParse(conversation?.settings) || {},
        bound_table_id: conversation?.bound_table_id || null, bound_row_id: conversation?.bound_row_id || null,
        // ADR-0068 WP-B — parent/child/readonly state for client banner + chip.
        parent_conversation_id: conversation?.parent_conversation_id || null,
        purpose: conversation?.purpose || null,
        is_readonly: !!conversation?.is_readonly,
        comment_thread_child_id,
        is_processing: conversation?.is_processing ? true : false, processing_started_at: conversation?.processing_started_at || null,
        processing_agent_id: conversation?.processing_agent_id || null, processing_agent_name: conversation?.processing_agent_name || null,
        // ADR-0057 WP-C: source-of-truth presence array. Frontend uses this and
        // ignores the legacy scalar fields above (kept for backward compat).
        active_agents,
        active_agent_status, active_plan,
        context_stats,
      });
    } catch (err) {
      apiLogger.error({ err }, 'Error getting messages');
      return error(res, 'GET_MESSAGES_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/messages/by-ids?ids=1,2,3 — ADR-0031 §Z / WP-24
  //
  // Lightweight batch read for the ChatLinkCard inline-expand preview. The
  // source-side card knows the target conversation id + the list of message
  // ids that landed there (metadata.moved_to.message_ids). When the user
  // clicks the chevron we fetch ONLY those ids — much cheaper than loading
  // the entire target conversation.
  //
  // Auth: caller must be a participant of the conversation. Mirrors the
  // summary endpoint policy.
  router.get('/conversations/:id/messages/by-ids', requireAuth, async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return badRequest(res, 'Invalid conversation id');
      }
      const idsParam = String(req.query.ids || '').trim();
      if (!idsParam) return badRequest(res, '`ids` query param is required');
      const ids = idsParam.split(',')
        .map(s => parseInt(s, 10))
        .filter(n => Number.isFinite(n) && n > 0)
        .slice(0, 50);
      if (ids.length === 0) return badRequest(res, '`ids` must contain at least one positive integer');

      const userId = req.user.userId;
      const participant = await dbGet(
        isPostgres()
          ? `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`
          : `SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, userId]
      );
      if (!participant) return forbidden(res, 'No access to this conversation');

      const rows = await dbAll(
        isPostgres()
          ? `SELECT m.id, m.sender_id, m.sender_type, m.role, m.content, m.content_type,
                    m.attachments, m.metadata, m.created_at,
                    u.name AS sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END AS sender_avatar, u.user_type AS sender_user_type
               FROM messages m
               LEFT JOIN users u ON u.id = m.sender_id
              WHERE m.conversation_id = $1
                AND m.id = ANY($2::int[])
                AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
              ORDER BY m.id ASC`
          : `SELECT m.id, m.sender_id, m.sender_type, m.role, m.content, m.content_type,
                    m.attachments, m.metadata, m.created_at,
                    u.name AS sender_name, CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END AS sender_avatar, u.user_type AS sender_user_type
               FROM messages m
               LEFT JOIN users u ON u.id = m.sender_id
              WHERE m.conversation_id = ?
                AND m.id IN (${ids.map(() => '?').join(',')})
                AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
              ORDER BY m.id ASC`,
        isPostgres() ? [conversationId, ids] : [conversationId, ...ids]
      );

      const AVATAR_MAX_BYTES = 2048;
      const messages = rows.map(r => ({
        id: r.id,
        sender_id: r.sender_id,
        sender_type: r.sender_type || null,
        role: r.role || null,
        content: r.content,
        content_type: r.content_type || null,
        attachments: safeJsonParse(r.attachments) || [],
        metadata: safeJsonParse(r.metadata) || {},
        created_at: r.created_at,
        sender_name: r.sender_name || null,
        sender_avatar: typeof r.sender_avatar === 'string'
          && r.sender_avatar.length > 0
          && r.sender_avatar.length <= AVATAR_MAX_BYTES
          ? r.sender_avatar : null,
        sender_user_type: r.sender_user_type || null,
      }));

      return success(res, { messages });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'Error in GET /conversations/:id/messages/by-ids');
      return error(res, 'GET_MESSAGES_BY_IDS_ERROR', err.message, 500);
    }
  });

  // GET /messages/:messageId/full - Get full content of a single message (L4 lazy load)
  router.get('/messages/:messageId/full', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const message = await dbGet(
        isPostgres()
          ? `SELECT id, content, content_type FROM messages WHERE id = $1`
          : `SELECT id, content, content_type FROM messages WHERE id = ?`,
        [messageId]
      );
      if (!message) return notFound(res, 'Message not found');
      return success(res, { id: message.id, content: message.content, content_type: message.content_type });
    } catch (err) {
      apiLogger.error({ err }, 'Error getting full message');
      return error(res, 'GET_FULL_MESSAGE_ERROR', err.message, 500);
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
      // ADR-0068 WP-B4 — edit only by the real actor. sender_id retains the
      // user who authored the message even when sender_kind='space', so this
      // is the right column to gate on; persona doesn't transfer edit rights.
      const callerId = req.user.userId || req.user.id;
      if (Number(message.sender_id) !== Number(callerId)) {
        return forbidden(res, 'You can only edit your own messages');
      }
      await dbRun(isPostgres() ? `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2` : `UPDATE messages SET content = ?, updated_at = datetime('now') WHERE id = ?`, [content, messageId]);
      apiLogger.info({ messageId, conversationId: message.conversation_id }, 'Message content updated (checkbox toggle)');
      return success(res, { updated: true, message_id: Number(messageId) });
    } catch (err) {
      apiLogger.error('Error updating message content:', err);
      return error(res, 'UPDATE_MESSAGE_CONTENT_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/messages/move — ADR-0031 P5 / ADR-133 WP-20.
  // Move messages out of one chat to another, leaving stub-pointers in the source.
  // Implementation lives in services/messageMoveService.js so it can be reused (e.g.
  // by ADR-0031 P6 criterion → ticket continuation).
  //
  // Auth (ADR-0031 WP-24): caller must be the chat owner (conversations.created_by)
  // OR hold admin-or-higher within the source chat's space (per EffectiveRoleService
  // inheritance — owner_owner/owner/admin all qualify). Global users.role is NOT
  // honored — admin is space-scoped (privilege bug fix; see WP-24).
  router.post('/conversations/:id/messages/move', requireAuth, async (req, res) => {
    try {
      const sourceId = Number(req.params.id);
      const { target_conversation_id, message_ids } = req.body || {};

      const conv = await dbGet(
        isPostgres()
          ? `SELECT created_by, space_id FROM conversations WHERE id = $1`
          : `SELECT created_by, space_id FROM conversations WHERE id = ?`,
        [sourceId]
      );
      if (!conv) return notFound(res, 'conversation not found');

      const callerId = Number(req.user.userId);
      const isChatOwner = Number(conv.created_by) === callerId;
      const isSpaceAdmin = conv.space_id
        ? await canAdminister(callerId, { spaceId: conv.space_id })
        : false;
      if (!isChatOwner && !isSpaceAdmin) {
        return forbidden(res, 'only the chat owner or a space admin can move messages out of this conversation');
      }

      const result = await moveMessages({
        sourceConversationId: sourceId,
        targetConversationId: target_conversation_id,
        messageIds: message_ids,
        userId: callerId,
        actorIsChatOwner: isChatOwner || isSpaceAdmin,
      });
      return success(res, {
        source_conversation_id: sourceId,
        target_conversation_id: Number(target_conversation_id),
        source_message_ids: result.source_message_ids,
        target_message_ids: result.target_message_ids,
        moved_count: result.moved_count,
      });
    } catch (err) {
      if (err instanceof MoveValidationError) return badRequest(res, err.message);
      if (err instanceof MoveAuthError) return forbidden(res, err.message);
      apiLogger.error({ err }, 'ADR-0031 P5: move messages failed');
      return error(res, 'MOVE_MESSAGES_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/spawn-ticket — ADR-0031 P6.
  // Spawn a ticket from this conversation (typically a BDD-criterion chat),
  // create the ticket's row-chat, and move the discussion into it leaving
  // stubs in the source per move-with-stub (P5).
  //
  // Auth (ADR-0031 WP-24): same gate as /messages/move — chat owner OR
  // space-scoped admin (per EffectiveRoleService); global users.role is NOT
  // honored.
  router.post('/conversations/:id/spawn-ticket', requireAuth, async (req, res) => {
    try {
      const sourceId = Number(req.params.id);
      const { ticket_data, message_ids } = req.body || {};

      const conv = await dbGet(
        isPostgres()
          ? `SELECT created_by, space_id FROM conversations WHERE id = $1`
          : `SELECT created_by, space_id FROM conversations WHERE id = ?`,
        [sourceId]
      );
      if (!conv) return notFound(res, 'conversation not found');

      const callerId = Number(req.user.userId);
      const isChatOwner = Number(conv.created_by) === callerId;
      const isSpaceAdmin = conv.space_id
        ? await canAdminister(callerId, { spaceId: conv.space_id })
        : false;
      if (!isChatOwner && !isSpaceAdmin) {
        return forbidden(res, 'only the chat owner or a space admin can spawn a ticket from this conversation');
      }

      const result = await spawnTicketFromCriterion({
        sourceConversationId: sourceId,
        ticketData: ticket_data,
        messageIds: message_ids,
        userId: callerId,
        actorIsChatOwner: isChatOwner || isSpaceAdmin,
      });
      return success(res, result);
    } catch (err) {
      if (err instanceof SpawnValidationError) return badRequest(res, err.message);
      if (err instanceof MoveValidationError) return badRequest(res, err.message);
      if (err instanceof MoveAuthError) return forbidden(res, err.message);
      apiLogger.error({ err }, 'ADR-0031 P6: spawn ticket from criterion failed');
      return error(res, 'SPAWN_TICKET_ERROR', err.message, 500);
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
