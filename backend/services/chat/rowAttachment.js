/**
 * ADR-0068 WP-B — Single source of truth for the `bound_table_id = 0`
 * sentinel that means "this conversation/message is bound to another
 * CONVERSATION row" (not to a universal-tables row).
 *
 * Background — every conversation and message carries a
 * (`bound_table_id`, `bound_row_id`) pair that points at the CRM row this
 * chat is attached to. Until WP-B, `bound_table_id` always referenced a
 * universal_tables.id. WP-B introduces a child-of-parent chat (comment
 * thread): the child's bound row IS its parent conversation, so it needs
 * a way to say "bound to a conversation, not a table row".
 *
 * Architect-locked rule (chat 2026-05-19): `bound_table_id = 0` is the
 * sentinel for that case, no new sentinel registry. Every join /
 * row-resolver MUST funnel through `resolveAttachedRow()` here — that way
 * if the sentinel ever changes, exactly one place updates.
 *
 * Use cases today (post-WP-B):
 *   - Chat list "attached to" chip → fetch parent conversation title to
 *     render the chip on the child.
 *   - send_widget_message → resolve table_name/row_title for the
 *     attachment payload (universal path; sentinel rerouted to
 *     conversations.title).
 *
 * Callers should treat the result as best-effort metadata:
 *   - `{ table_name, row_title }` when the bound entity exists.
 *   - `null` when missing/deleted (caller decides whether to drop the chip
 *     or render a tombstone).
 */

import { dbGet } from '../../routes/v3/chat/chatShared.js';

export const CONVERSATIONS_SENTINEL = 0;
// Public alias — readable at call sites that aren't about resolution but about
// stamping the sentinel on outgoing inserts (e.g. POST /comment-thread).
export const BOUND_TABLE_ID_CONVERSATIONS = CONVERSATIONS_SENTINEL;

/**
 * Resolve a (bound_table_id, bound_row_id) pair to display metadata.
 * Handles the `bound_table_id = 0` sentinel by querying `conversations`
 * instead of `universal_tables` + `table_rows`.
 *
 * @param {object} args
 * @param {number|null} args.bound_table_id
 * @param {number|null} args.bound_row_id
 * @returns {Promise<{table_name: string, row_title: string|null, source: 'conversation'|'universal_table'} | null>}
 */
export async function resolveAttachedRow({ bound_table_id, bound_row_id } = {}) {
  const tableId = Number(bound_table_id);
  const rowId = Number(bound_row_id);
  if (!Number.isFinite(rowId) || rowId <= 0) return null;
  if (!Number.isFinite(tableId)) return null;

  if (tableId === CONVERSATIONS_SENTINEL) {
    const row = await dbGet(
      `SELECT id, title, type FROM conversations WHERE id = $1`,
      [rowId]
    );
    if (!row) return null;
    return {
      table_name: 'conversations',
      row_title: row.title || `Conversation #${row.id}`,
      source: 'conversation',
    };
  }

  // Universal-table path — keep it minimal here; full row data resolution
  // belongs to higher layers that already do JOINs against table_rows.
  const ut = await dbGet(
    `SELECT name FROM universal_tables WHERE id = $1`,
    [tableId]
  );
  if (!ut) return null;
  return {
    table_name: ut.name,
    row_title: null,
    source: 'universal_table',
  };
}

/**
 * True when bound_table_id addresses a conversation row.
 * Cheap predicate so callers can branch without going through dbGet.
 * Distinguishes the sentinel (0) from null/undefined — `Number(null)` coerces
 * to 0 in JS so we have to reject nullish inputs explicitly.
 */
export function isConversationSentinel(bound_table_id) {
  if (bound_table_id == null) return false;
  return Number(bound_table_id) === CONVERSATIONS_SENTINEL;
}

/**
 * Find the active comment-thread child for a given parent conversation.
 * Returns the child's id or null. Archived children (purpose='comments_archived',
 * parent_conversation_id NULL after the cascade-archive trigger) are intentionally
 * skipped — the find-or-create idempotency only matches live links.
 */
export async function getCommentThreadChildId(parentConversationId) {
  const pid = Number(parentConversationId);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const row = await dbGet(
    `SELECT id FROM conversations
      WHERE parent_conversation_id = $1 AND purpose = 'comments'
      LIMIT 1`,
    [pid]
  );
  return row?.id || null;
}
