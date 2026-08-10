/**
 * Chat / Conversation Tool Handlers (ADR-144 P1)
 *
 * Handles: send_chat_message, list_conversations, get_conversation_messages, create_conversation
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { parseRowData } from './data-tools.js';
import {
  dispatchInvocationsFromContent, hasInvocationTokens,
} from '../chat/invocation-dispatcher.js';
import { moveMessages, MoveValidationError, MoveAuthError } from '../messageMoveService.js';
import { spawnTicketFromCriterion, SpawnValidationError } from '../criterionTicketSpawnService.js';
import { canAdminister } from '../EffectiveRoleService.js';

// ADR-0031 WP-20+21 (T-141237): content_type + attachments[] support for MCP send_chat_message.
const ALLOWED_MCP_CONTENT_TYPES = new Set(['text', 'widget_embed']);
const ALLOWED_WIDGET_VIEWS = new Set(['list', 'kanban', 'table']);

/**
 * Validate a single attachment shape for the MCP send_chat_message tool.
 * Returns null on success, or an error string describing the first problem.
 */
function _validateAttachment(att, idx) {
  if (!att || typeof att !== 'object') return `attachments[${idx}] must be an object`;
  if (!att.type || typeof att.type !== 'string') return `attachments[${idx}].type is required (string)`;
  if (att.type === 'widget_embed') {
    const we = att.widgetEmbed;
    if (!we || typeof we !== 'object') return `attachments[${idx}].widgetEmbed is required for widget_embed`;
    if (typeof we.table_id !== 'number') return `attachments[${idx}].widgetEmbed.table_id must be a number`;
    if (!we.view || !ALLOWED_WIDGET_VIEWS.has(we.view)) {
      return `attachments[${idx}].widgetEmbed.view must be one of: ${[...ALLOWED_WIDGET_VIEWS].join(', ')}`;
    }
    if (we.filter != null && (typeof we.filter !== 'object' || Array.isArray(we.filter))) {
      return `attachments[${idx}].widgetEmbed.filter must be an object`;
    }
    if (we.columns != null && !Array.isArray(we.columns)) {
      return `attachments[${idx}].widgetEmbed.columns must be an array of strings`;
    }
    if (we.limit != null && typeof we.limit !== 'number') {
      return `attachments[${idx}].widgetEmbed.limit must be a number`;
    }
  } else if (att.type === 'row_reference') {
    const rr = att.rowReference;
    if (!rr || typeof rr !== 'object') return `attachments[${idx}].rowReference is required for row_reference`;
    if (typeof rr.table_id !== 'number' || typeof rr.row_id !== 'number') {
      return `attachments[${idx}].rowReference.table_id and row_id must be numbers`;
    }
  }
  // Other attachment types (e.g. plain files) pass through unvalidated for forward-compat.
  return null;
}

export const chatToolHandlers = {
  async send_chat_message({ conversation_id, content, role = 'user', content_type = 'text', attachments = null }, userId, ctx = {}) {
    // ── ADR-0031 WP-20+21: validate content_type + attachments shape ──
    if (!ALLOWED_MCP_CONTENT_TYPES.has(content_type)) {
      return { error: `Invalid content_type "${content_type}". Allowed: ${[...ALLOWED_MCP_CONTENT_TYPES].join(', ')}` };
    }
    let validatedAttachments = null;
    if (attachments != null) {
      if (!Array.isArray(attachments)) {
        return { error: 'attachments must be an array' };
      }
      for (let i = 0; i < attachments.length; i++) {
        const err = _validateAttachment(attachments[i], i);
        if (err) return { error: err };
      }
      validatedAttachments = attachments;
    }
    // For widget_embed messages, require at least one widget_embed attachment.
    if (content_type === 'widget_embed') {
      const hasWidget = Array.isArray(validatedAttachments)
        && validatedAttachments.some(a => a?.type === 'widget_embed');
      if (!hasWidget) {
        return { error: 'content_type "widget_embed" requires at least one widget_embed attachment' };
      }
    }

    const conv = await dbGet(
      isPostgres() ? 'SELECT id, space_id FROM conversations WHERE id = $1'
                   : 'SELECT id, space_id FROM conversations WHERE id = ?',
      [conversation_id]
    );
    if (!conv) return { error: `Conversation ${conversation_id} not found` };

    const attachmentsJson = validatedAttachments && validatedAttachments.length > 0
      ? JSON.stringify(validatedAttachments)
      : '[]';

    const result = await dbRun(`
      INSERT INTO messages (conversation_id, role, content, content_type, sender_id, attachments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()})
    `, [conversation_id, role, content, content_type, userId || 1, attachmentsJson]);

    await dbRun(`UPDATE conversations SET updated_at = ${sqlNow()} WHERE id = ?`, [conversation_id]);

    const messageId = result.lastInsertRowid;

    // ADR-117: dispatch <<@slug>> / <</slug>> invocations from MCP-sent messages.
    // Without this, agents calling send_chat_message could not pin/wake other agents.
    if (hasInvocationTokens(content)) {
      dispatchInvocationsFromContent({
        conversationId: Number(conversation_id),
        content,
        userId: userId || null,
        spaceId: conv.space_id || null,
        sourceLabel: 'mcp_tool',
        sourceMessageId: messageId,
        sourceAgentId: ctx.agentId || null,
      }).catch(err => {
        apiLogger.error({ err: err.message, conversation_id, messageId }, 'send_chat_message: dispatch failed');
      });
    }

    return { success: true, message_id: messageId, message: 'Message sent' };
  },

  // ADR-0031 WP-23: thin façade — resolves row metadata server-side, then
  // posts a row_reference attachment so the chat renderer can pick a preset
  // (DocumentRowAtom / TicketRowAtom / RowPresetCard) and render a chip/card.
  // Returns the same shape as send_chat_message: { success, message_id, message }.
  async send_widget_message({ conversation_id, table_id, row_id, style = 'chip', note = '' }, userId, ctx = {}) {
    if (typeof conversation_id !== 'number') return { error: 'conversation_id is required (number)' };
    if (typeof table_id !== 'number') return { error: 'table_id is required (number)' };
    if (typeof row_id !== 'number') return { error: 'row_id is required (number)' };
    if (style && !['chip', 'card'].includes(style)) {
      return { error: `Invalid style "${style}". Allowed: chip, card` };
    }

    // Resolve table metadata (name + icon for the collapsed chip view).
    const table = await dbGet(
      'SELECT id, name, display_name, icon FROM universal_tables WHERE id = ?',
      [table_id]
    );
    if (!table) return { error: `Table ${table_id} not found` };

    // Resolve row + a best-effort title from common display columns.
    const row = await dbGet(
      isPostgres()
        ? 'SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2'
        : 'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [row_id, table_id]
    );
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };

    const rowData = parseRowData(row.data) || {};
    const TITLE_KEYS = ['title', 'name', 'what', 'subject', 'summary', 'display_name', 'label'];
    let rowTitle = '';
    for (const k of TITLE_KEYS) {
      const v = rowData[k];
      if (typeof v === 'string' && v.trim()) { rowTitle = v.trim(); break; }
    }
    if (!rowTitle) rowTitle = `Row #${row_id}`;

    const tableName = table.display_name || table.name || `Table #${table_id}`;
    const tableIcon = table.icon || undefined;

    const attachment = {
      type: 'row_reference',
      rowReference: {
        table_id,
        row_id,
        table_name: tableName,
        ...(tableIcon ? { table_icon: tableIcon } : {}),
        row_title: rowTitle,
        // Forward-compat: renderer may consult `style` to force chip vs card.
        style,
      },
    };

    // Reuse the validated send path so dispatch / conversation bump / etc. all run.
    return chatToolHandlers.send_chat_message(
      {
        conversation_id,
        content: note || '',
        role: 'user',
        content_type: 'text',
        attachments: [attachment],
      },
      userId,
      ctx
    );
  },

  async list_conversations({ space_id, type, search, limit = 50 }) {
    const pg = isPostgres();
    let paramIdx = 1;
    let query = 'SELECT id, title, type, space_id, created_at, updated_at FROM conversations WHERE 1=1';
    const params = [];

    if (space_id) {
      query += pg ? ` AND space_id = $${paramIdx++}` : ' AND space_id = ?';
      params.push(space_id);
    }
    if (type) {
      query += pg ? ` AND type = $${paramIdx++}` : ' AND type = ?';
      params.push(type);
    }
    if (search) {
      query += pg ? ` AND title ILIKE $${paramIdx++}` : ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    query += ` ORDER BY updated_at DESC`;
    query += pg ? ` LIMIT $${paramIdx++}` : ' LIMIT ?';
    params.push(limit);

    const conversations = await dbAll(query, params);
    return { conversations, total: conversations.length };
  },

  async get_conversation_messages({ conversation_id, limit = 50, before_id }) {
    const conv = await dbGet('SELECT id, title FROM conversations WHERE id = ?', [conversation_id]);
    if (!conv) return { error: `Conversation ${conversation_id} not found` };

    const pg = isPostgres();
    let paramIdx = 1;
    let query = pg
      ? `SELECT id, role, content, sender_id, created_at FROM messages WHERE conversation_id = $${paramIdx++}`
      : 'SELECT id, role, content, sender_id, created_at FROM messages WHERE conversation_id = ?';
    const params = [conversation_id];

    if (before_id) {
      query += pg ? ` AND id < $${paramIdx++}` : ' AND id < ?';
      params.push(before_id);
    }

    query += ` ORDER BY id DESC`;
    query += pg ? ` LIMIT $${paramIdx++}` : ' LIMIT ?';
    params.push(limit);

    const messages = await dbAll(query, params);
    return { conversation: conv, messages: messages.reverse(), total: messages.length };
  },

  // ADR-0031 P5 — MCP wrapper around messageMoveService.moveMessages.
  // Auth gate: caller is the chat owner (conversations.created_by === userId)
  // OR holds admin-or-higher within the source chat's space (per
  // EffectiveRoleService inheritance — owner_owner/owner/admin all qualify).
  // A global users.role='admin' is NOT honored here; admin is space-scoped.
  async move_chat_messages({ source_conversation_id, target_conversation_id, message_ids }, userId) {
    if (typeof source_conversation_id !== 'number') return { error: 'source_conversation_id is required (number)' };
    if (typeof target_conversation_id !== 'number') return { error: 'target_conversation_id is required (number)' };
    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      return { error: 'message_ids must be a non-empty array' };
    }

    const conv = await dbGet(
      isPostgres()
        ? `SELECT created_by, space_id FROM conversations WHERE id = $1`
        : `SELECT created_by, space_id FROM conversations WHERE id = ?`,
      [source_conversation_id]
    );
    if (!conv) return { error: `Source conversation ${source_conversation_id} not found` };

    const callerId = Number(userId || 1);
    const isChatOwner = Number(conv.created_by) === callerId;
    const isSpaceAdmin = conv.space_id
      ? await canAdminister(callerId, { spaceId: conv.space_id })
      : false;
    if (!isChatOwner && !isSpaceAdmin) {
      return { error: 'only the chat owner or a space admin can move messages out of this conversation' };
    }

    try {
      const result = await moveMessages({
        sourceConversationId: source_conversation_id,
        targetConversationId: target_conversation_id,
        messageIds: message_ids,
        userId: callerId,
        actorIsChatOwner: isChatOwner || isSpaceAdmin,
      });
      return {
        success: true,
        source_conversation_id,
        target_conversation_id,
        moved_count: result.moved_count,
        source_message_ids: result.source_message_ids,
        target_message_ids: result.target_message_ids,
        batch_id: result.batch_id,
      };
    } catch (err) {
      if (err instanceof MoveValidationError) return { error: err.message, code: 'VALIDATION' };
      if (err instanceof MoveAuthError) return { error: err.message, code: 'AUTH' };
      apiLogger.error({ err: err.message, source_conversation_id, target_conversation_id }, 'move_chat_messages MCP failed');
      return { error: err.message };
    }
  },

  // ADR-0031 P6 — MCP wrapper around criterionTicketSpawnService.spawnTicketFromCriterion.
  // Despite the service name (which dates from the BDD-criterion use case), it works for any
  // chat: it creates a ticket row, ensures the row-chat for that ticket, and moves the selected
  // messages into it. Auth gate matches /conversations/:id/spawn-ticket: chat owner OR
  // space-scoped admin (per EffectiveRoleService); global users.role is NOT honored.
  async spawn_ticket_from_chat({ source_conversation_id, ticket_data, message_ids }, userId) {
    if (typeof source_conversation_id !== 'number') return { error: 'source_conversation_id is required (number)' };
    if (!ticket_data || typeof ticket_data !== 'object') return { error: 'ticket_data is required (object)' };
    if (!ticket_data.what || typeof ticket_data.what !== 'string' || !ticket_data.what.trim()) {
      return { error: 'ticket_data.what is required (non-empty string)' };
    }
    if (ticket_data.assigned_to == null) {
      return { error: 'ticket_data.assigned_to is required' };
    }
    if (message_ids != null && (!Array.isArray(message_ids) || message_ids.some(n => typeof n !== 'number'))) {
      return { error: 'message_ids must be an array of numbers when provided' };
    }

    const conv = await dbGet(
      isPostgres()
        ? `SELECT created_by, space_id FROM conversations WHERE id = $1`
        : `SELECT created_by, space_id FROM conversations WHERE id = ?`,
      [source_conversation_id]
    );
    if (!conv) return { error: `Source conversation ${source_conversation_id} not found` };

    const callerId = Number(userId || 1);
    const isChatOwner = Number(conv.created_by) === callerId;
    const isSpaceAdmin = conv.space_id
      ? await canAdminister(callerId, { spaceId: conv.space_id })
      : false;
    if (!isChatOwner && !isSpaceAdmin) {
      return { error: 'only the chat owner or a space admin can spawn a ticket from this conversation' };
    }

    try {
      const result = await spawnTicketFromCriterion({
        sourceConversationId: source_conversation_id,
        ticketData: ticket_data,
        messageIds: message_ids,
        userId: callerId,
        actorIsChatOwner: isChatOwner || isSpaceAdmin,
      });
      return { success: true, ...result };
    } catch (err) {
      if (err instanceof SpawnValidationError) return { error: err.message, code: 'VALIDATION' };
      if (err instanceof MoveValidationError) return { error: err.message, code: 'VALIDATION' };
      if (err instanceof MoveAuthError) return { error: err.message, code: 'AUTH' };
      apiLogger.error({ err: err.message, source_conversation_id }, 'spawn_ticket_from_chat MCP failed');
      return { error: err.message };
    }
  },

  async create_conversation({ title, type = 'direct', space_id, participant_ids = [] }, userId) {
    const result = await dbRun(`
      INSERT INTO conversations (title, type, space_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [title, type, space_id || null, userId || 1]);

    const convId = result.lastInsertRowid;

    // Add creator as participant
    await dbRun(`
      INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'admin', ${sqlNow()})
    `, [convId, userId || 1]);

    // Add additional participants
    for (const pid of participant_ids) {
      try {
        await dbRun(`
          INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
          VALUES (?, ?, 'member', ${sqlNow()})
        `, [convId, pid]);
      } catch (e) { /* skip duplicates */ }
    }

    return { success: true, conversation_id: convId, message: `Conversation "${title}" created` };
  }
};
