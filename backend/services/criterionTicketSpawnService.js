// ADR-0031 P6 — Spawn ticket from criterion chat (move-with-stub integration).
//
// Geratron's workflow: in a BDD-criterion chat (lazy-created on regression in P4),
// participants discuss the failure. When the discussion concludes a ticket needs
// to be created, click "Spawn ticket" → this service:
//
//   1. creates the ticket row in tickets table (1708)
//   2. ensures a row-chat exists for the new ticket (P4 ensureRowChat)
//   3. moves the discussion messages from criterion chat → ticket chat,
//      leaving stubs behind (P5 moveMessages)
//   4. links the ticket back to the source row via `data.spawned_from`
//
// Net effect: source criterion chat keeps stubs pointing forward, ticket chat
// has the full thread with `metadata.moved_from` headers, and the ticket row
// itself records its provenance.
//
// Auth: the chat-owner gate (and admin override) is enforced at the route layer
// (ADR-0031 WP-24). `moveMessages` is invoked with actorIsChatOwner=true because
// the caller becomes a participant of the freshly-created ticket chat via
// ensureRowChat() in this same call — the standard "both sides" participant
// check would race.

import { dbAll, dbGet, dbRun, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { generateBaseId } from '../utils/baseId.js';
import { TICKETS_TABLE_ID } from './chain-handoff/constants.js';
import { ensureRowChat } from './tableMutationService.js';
import { moveMessages } from './messageMoveService.js';

export class SpawnValidationError extends Error {
  constructor(message) { super(message); this.name = 'SpawnValidationError'; this.code = 'VALIDATION'; }
}

const DEFAULT_TICKET_STATE = 24275; // backlog (space 11 — TICKETS_TABLE_ID 1708)

/**
 * Resolve the message ids that should ride along to the ticket chat.
 * If caller passes an explicit list, validate it. Otherwise default to
 * every non-deleted, non-already-moved message in the source conversation.
 */
async function resolveMessageIds(sourceConversationId, requestedIds) {
  if (Array.isArray(requestedIds) && requestedIds.length > 0) {
    const ids = requestedIds.map(Number);
    if (ids.some(n => !Number.isFinite(n) || n <= 0)) {
      throw new SpawnValidationError('message_ids must contain positive integers');
    }
    return ids;
  }
  const rows = await dbAll(
    `SELECT id FROM messages
       WHERE conversation_id = $1
         AND (is_deleted = 0 OR is_deleted IS NULL)
         AND (content_type IS NULL OR content_type <> 'moved')
       ORDER BY id ASC`,
    [Number(sourceConversationId)]
  );
  return rows.map(r => Number(r.id));
}

/**
 * Spawn a ticket from a source conversation (typically a BDD-criterion chat),
 * move discussion into the ticket's row-chat, leave stubs behind.
 *
 * @param {Object} args
 * @param {number} args.sourceConversationId — source criterion chat
 * @param {Object} args.ticketData — { what, why, assigned_to, priority, type, state, ... }
 * @param {number[]} [args.messageIds] — explicit subset to move; default = all non-stub
 * @param {number} args.userId — caller (becomes participant of new ticket chat via ensureRowChat)
 * @param {boolean} [args.actorIsChatOwner=true] — caller is chat owner / admin override (gate enforced at the route layer per ADR-0031 WP-24)
 * @returns {Promise<{ticket_id, ticket_conversation_id, source_conversation_id, moved_count, source_message_ids, target_message_ids, spawned_from}>}
 */
export async function spawnTicketFromCriterion({
  sourceConversationId,
  ticketData,
  messageIds,
  userId,
  actorIsChatOwner = true,
}) {
  const srcId = Number(sourceConversationId);
  const uid = Number(userId);

  if (!Number.isFinite(srcId) || srcId <= 0) {
    throw new SpawnValidationError('invalid source conversation id');
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new SpawnValidationError('invalid user id');
  }
  if (!ticketData || typeof ticketData !== 'object') {
    throw new SpawnValidationError('ticket_data is required');
  }
  if (!ticketData.what || typeof ticketData.what !== 'string' || !ticketData.what.trim()) {
    throw new SpawnValidationError('ticket_data.what is required');
  }
  if (ticketData.assigned_to == null) {
    throw new SpawnValidationError('ticket_data.assigned_to is required');
  }

  const srcConv = await dbGet(
    `SELECT id, bound_table_id, bound_row_id, space_id
       FROM conversations
      WHERE id = $1`,
    [srcId]
  );
  if (!srcConv) throw new SpawnValidationError(`source conversation not found: ${srcId}`);

  const resolvedMessageIds = await resolveMessageIds(srcId, messageIds);
  if (resolvedMessageIds.length === 0) {
    throw new SpawnValidationError('source conversation has no messages eligible to move');
  }

  const fullTicketData = {
    ...ticketData,
    state: ticketData.state != null ? ticketData.state : DEFAULT_TICKET_STATE,
    spawned_from: {
      table_id: srcConv.bound_table_id != null ? Number(srcConv.bound_table_id) : null,
      row_id: srcConv.bound_row_id != null ? Number(srcConv.bound_row_id) : null,
      conversation_id: srcId,
    },
  };

  const baseId = generateBaseId();
  const dataJson = JSON.stringify(fullTicketData);
  const insertResult = await dbRun(
    isPostgres()
      ? `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         RETURNING id`
      : `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [TICKETS_TABLE_ID, baseId, dataJson]
  );
  const ticketId = insertResult?.lastInsertRowid || insertResult?.rows?.[0]?.id;
  if (!ticketId) throw new Error('spawnTicketFromCriterion: failed to create ticket row');

  const titleHint = `Ticket #${ticketId}: ${String(fullTicketData.what).substring(0, 60)}`;
  const ticketConv = await ensureRowChat({
    tableId: TICKETS_TABLE_ID,
    rowId: ticketId,
    actorId: uid,
    titleHint,
  });
  if (!ticketConv?.id) {
    throw new Error('spawnTicketFromCriterion: failed to create ticket conversation');
  }

  let moveResult;
  try {
    moveResult = await moveMessages({
      sourceConversationId: srcId,
      targetConversationId: ticketConv.id,
      messageIds: resolvedMessageIds,
      userId: uid,
      actorIsChatOwner: actorIsChatOwner === true,
    });
  } catch (err) {
    apiLogger.error(
      { err: err.message, ticketId, srcConvId: srcId, tgtConvId: ticketConv.id },
      'ADR-0031 P6: moveMessages failed mid-spawn — ticket+chat orphaned, manual cleanup may be needed'
    );
    throw err;
  }

  apiLogger.info(
    {
      ticketId,
      ticketConvId: ticketConv.id,
      srcConvId: srcId,
      srcRowId: srcConv.bound_row_id,
      srcTableId: srcConv.bound_table_id,
      movedCount: moveResult.moved_count,
      userId: uid,
    },
    'ADR-0031 P6: ticket spawned from criterion chat'
  );

  return {
    ticket_id: Number(ticketId),
    ticket_conversation_id: Number(ticketConv.id),
    source_conversation_id: srcId,
    moved_count: moveResult.moved_count,
    source_message_ids: moveResult.source_message_ids,
    target_message_ids: moveResult.target_message_ids,
    spawned_from: fullTicketData.spawned_from,
  };
}
