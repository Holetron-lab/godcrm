// ADR-0031 P5 / ADR-133 WP-20 — Move-with-stub
//
// Move a batch of messages from source conversation to target conversation,
// leaving a stub (`content_type='moved'`) in the source pointing forward.
// Atomic: all source updates + target inserts in a single transaction.
//
// Source row after move:
//   content_type='moved'
//   content='Moved to chat #<target> at <ts>'
//   metadata.moved_to = { conversation_id, message_ids, batch_id, moved_by }
//
// Target row (new):
//   content_type / content / role / sender preserved from source
//   metadata.moved_from = { conversation_id, message_id, original_time, batch_id, moved_by }
//
// `moved_by` snapshots the actor at move time: { user_id, name, avatar }.
// avatar is null when missing OR when >2KB (mobile OOM guard, matches summary
// endpoint's AVATAR_MAX_BYTES). Frontend ChatLinkCard renders the mover's
// avatar+name as the card header.
//
// ADR-0031 §Z / WP-24: every move call generates one UUID v4 `batch_id`. Both
// the stub (source) and the new rows (target) carry it so the frontend
// ChatLinkCard can group all messages from the same move into a single card.
//
// Auth: caller must be a participant of BOTH source and target conversations,
// unless `actorIsChatOwner=true` (the route layer sets this for the chat owner
// per `conversations.created_by`, or for the system admin override). The
// chat-owner gate itself is enforced at the route layer (ADR-0031 WP-24).

import { randomUUID } from 'crypto';
import { dbGet, withTransactionAsync } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

export class MoveValidationError extends Error {
  constructor(message) { super(message); this.name = 'MoveValidationError'; this.code = 'VALIDATION'; }
}
export class MoveAuthError extends Error {
  constructor(message) { super(message); this.name = 'MoveAuthError'; this.code = 'AUTH'; }
}

function asJsonString(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function asObject(val, fallback = {}) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

/**
 * Move messages from one conversation to another, leaving stubs in the source.
 *
 * @param {Object} args
 * @param {number} args.sourceConversationId
 * @param {number} args.targetConversationId
 * @param {number[]} args.messageIds — must all belong to the source conversation, not deleted, not already moved.
 * @param {number} args.userId — caller; must be a participant of both conversations (unless actorIsChatOwner=true).
 * @param {boolean} [args.actorIsChatOwner=false] — caller is the chat owner (or system admin override); skip the participant check. The chat-owner gate itself is enforced at the route layer (ADR-0031 WP-24).
 * @returns {Promise<{moved_count, source_message_ids, target_message_ids}>}
 */
export async function moveMessages({
  sourceConversationId,
  targetConversationId,
  messageIds,
  userId,
  actorIsChatOwner = false,
}) {
  const srcId = Number(sourceConversationId);
  const tgtId = Number(targetConversationId);
  const uid = Number(userId);

  if (!Number.isFinite(srcId) || srcId <= 0) throw new MoveValidationError('invalid source conversation id');
  if (!Number.isFinite(tgtId) || tgtId <= 0) throw new MoveValidationError('invalid target conversation id');
  if (!Number.isFinite(uid) || uid <= 0) throw new MoveValidationError('invalid user id');
  if (srcId === tgtId) throw new MoveValidationError('source and target conversation must differ');
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    throw new MoveValidationError('message_ids must be a non-empty array');
  }
  const ids = messageIds.map(Number);
  if (ids.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new MoveValidationError('message_ids must contain positive integers');
  }

  // Auth: caller is participant of both conversations (skipped when the route layer
  // has already verified the caller is the chat owner or system admin override).
  if (!actorIsChatOwner) {
    const srcPart = await dbGet(
      `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [srcId, uid]
    );
    if (!srcPart) throw new MoveAuthError('not a participant of source conversation');

    const tgtPart = await dbGet(
      `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [tgtId, uid]
    );
    if (!tgtPart) throw new MoveAuthError('not a participant of target conversation');
  }

  // ADR-0031 §Z / WP-24: one UUID v4 per move operation, written to every
  // stub (moved_to.batch_id) and every target message (moved_from.batch_id).
  const batchId = randomUUID();

  // Snapshot the actor (avatar capped to 2KB to keep messages JSONB small —
  // see project_users_avatar_base64_mine memory). Frontend renders mover's
  // avatar+name in the card header.
  const AVATAR_MAX_BYTES = 2048;
  const actorRow = await dbGet(
    `SELECT id, name, avatar FROM users WHERE id = $1`,
    [uid]
  );
  const movedBy = actorRow ? {
    user_id: actorRow.id,
    name: actorRow.name || null,
    avatar: typeof actorRow.avatar === 'string' && actorRow.avatar.length > 0 && actorRow.avatar.length <= AVATAR_MAX_BYTES
      ? actorRow.avatar
      : null,
  } : { user_id: uid, name: null, avatar: null };

  return await withTransactionAsync(async (trx) => {
    // Fetch source messages — must all belong to source conversation, not deleted, not already moved.
    const sourceMsgs = await trx.all(
      `SELECT id, conversation_id, sender_id, sender_type, role, content, content_type,
              agent_id, model_used, mentions, attachments, tool_results, metadata, created_at
       FROM messages
       WHERE id = ANY($1::int[])
         AND conversation_id = $2
         AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY id ASC`,
      [ids, srcId]
    );

    if (sourceMsgs.length !== ids.length) {
      const found = new Set(sourceMsgs.map(m => m.id));
      const missing = ids.filter(i => !found.has(i));
      throw new MoveValidationError(`messages not found in source conversation: ${missing.join(', ')}`);
    }
    const alreadyMoved = sourceMsgs.filter(m => m.content_type === 'moved');
    if (alreadyMoved.length > 0) {
      throw new MoveValidationError(`messages already moved: ${alreadyMoved.map(m => m.id).join(', ')}`);
    }

    // Insert into target — collect new ids 1:1 with sourceMsgs ordering.
    const targetIds = [];
    for (const src of sourceMsgs) {
      const baseMeta = asObject(src.metadata, {});
      const targetMeta = {
        ...baseMeta,
        moved_from: {
          conversation_id: srcId,
          message_id: src.id,
          original_time: src.created_at instanceof Date
            ? src.created_at.toISOString()
            : String(src.created_at),
          batch_id: batchId,
          moved_by: movedBy,
        },
      };

      // ADR-0031 P5 acceptance: preserve original created_at on target rows
      // (so they appear in chronological position in the target conversation).
      const inserted = await trx.run(
        `INSERT INTO messages (
           conversation_id, sender_id, sender_type, role, content, content_type,
           agent_id, model_used, mentions, attachments, tool_results, metadata, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13
         ) RETURNING id`,
        [
          tgtId,
          src.sender_id,
          src.sender_type || 'human',
          src.role,
          src.content,
          src.content_type,
          src.agent_id,
          src.model_used,
          asJsonString(src.mentions) ?? '[]',
          asJsonString(src.attachments) ?? '[]',
          src.tool_results == null ? null : asJsonString(src.tool_results),
          JSON.stringify(targetMeta),
          src.created_at,
        ]
      );
      targetIds.push(Number(inserted.lastInsertRowid));
    }

    // Stub each source row. Each stub carries:
    //   - message_id: own 1:1 counterpart in the target chat
    //   - message_ids: full batch (so frontend's "[Открыть →]" can scroll to the
    //                  first moved message regardless of which stub was clicked)
    const stubContent = `Moved to chat #${tgtId}`;
    for (let i = 0; i < sourceMsgs.length; i++) {
      const src = sourceMsgs[i];
      const newTargetId = targetIds[i];
      const baseMeta = asObject(src.metadata, {});
      const stubMeta = {
        ...baseMeta,
        moved_to: {
          conversation_id: tgtId,
          message_id: newTargetId,
          message_ids: targetIds,
          batch_id: batchId,
          moved_by: movedBy,
        },
      };
      await trx.run(
        `UPDATE messages
            SET content_type = 'moved',
                content = $1,
                metadata = $2::jsonb,
                updated_at = NOW()
          WHERE id = $3`,
        [stubContent, JSON.stringify(stubMeta), src.id]
      );
    }

    await trx.run(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [srcId]);
    await trx.run(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [tgtId]);

    apiLogger.info(
      { srcId, tgtId, moved: sourceMsgs.length, sourceIds: sourceMsgs.map(m => m.id), targetIds, batchId, userId: uid },
      'ADR-0031 P5: messages moved with stub'
    );

    return {
      moved_count: sourceMsgs.length,
      source_message_ids: sourceMsgs.map(m => m.id),
      target_message_ids: targetIds,
      batch_id: batchId,
    };
  });
}
