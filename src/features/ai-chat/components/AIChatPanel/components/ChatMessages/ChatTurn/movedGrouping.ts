/**
 * Grouping helpers for ADR-0031 §Z / WP-24 — collapse consecutive moved-message
 * stubs (source) and consecutive moved-from messages (target) into a single
 * <ChatLinkCard>.
 *
 * Primary key: `metadata.moved_to.batch_id` (forward) /
 *              `metadata.moved_from.batch_id` (backward).
 * Fallback when batch_id is missing on legacy data:
 *   group by conversation_id + chronological adjacency (gap < 60s).
 */
import type { ChatMessage } from '../../../types';

const ADJACENCY_GAP_MS = 60_000; // 1 minute

interface MovedToMeta {
  conversation_id?: number;
  message_id?: number;
  message_ids?: number[];
  batch_id?: string | number;
}

interface MovedFromMeta {
  conversation_id?: number;
  message_id?: number;
  original_time?: string;
  batch_id?: string | number;
}

export interface MovedGroup {
  conversationId: number;
  count: number;
  firstMessageId?: number;
  /** Source-side: ids of the original stub messages (so the host can render data-message-id). */
  stubMessageIds: string[];
  /** Source-side: the stub messages themselves (carry metadata.moved_to → target body fetch). */
  stubMessages: ChatMessage[];
  /** Backward only: the messages that compose the target-side group. */
  targetMessages: ChatMessage[];
}

const getCreatedAt = (m: ChatMessage): number => {
  const raw =
    (m as unknown as { created_at?: string; createdAt?: string }).createdAt ||
    (m as unknown as { created_at?: string }).created_at ||
    m.timestamp;
  if (!raw) return 0;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const getMovedTo = (m: ChatMessage): MovedToMeta | undefined => {
  const meta = (m.metadata || {}) as { moved_to?: MovedToMeta };
  return meta.moved_to;
};

const getMovedFrom = (m: ChatMessage): MovedFromMeta | undefined => {
  const meta = (m.metadata || {}) as { moved_from?: MovedFromMeta };
  return meta.moved_from;
};

/**
 * Group source-side `content_type='moved'` stubs by batch_id (preferred) or
 * by conversation_id + adjacency. Returns one MovedGroup per collapse target.
 *
 * Each group's `firstMessageId` is the first message_id from the target
 * conversation (so click-to-scroll works in the target chat).
 */
export function groupMovedSourceStubs(messages: ChatMessage[]): MovedGroup[] {
  const stubs = messages.filter(m => m.contentType === 'moved');
  if (stubs.length === 0) return [];

  const groups: MovedGroup[] = [];
  let current: MovedGroup | null = null;
  let currentBatch: string | number | null = null;
  let currentLastTime = 0;

  for (const m of stubs) {
    const meta = getMovedTo(m);
    const convId = Number(meta?.conversation_id);
    if (!convId) continue;

    const batchId = meta?.batch_id ?? null;
    const createdAt = getCreatedAt(m);
    const firstMsgId = meta?.message_ids?.[0] ?? meta?.message_id;

    const sameBatch =
      current &&
      batchId !== null &&
      currentBatch !== null &&
      String(batchId) === String(currentBatch) &&
      current.conversationId === convId;

    const sameAdjacent =
      current &&
      (batchId === null || currentBatch === null) &&
      current.conversationId === convId &&
      createdAt > 0 &&
      currentLastTime > 0 &&
      Math.abs(createdAt - currentLastTime) < ADJACENCY_GAP_MS;

    if (current && (sameBatch || sameAdjacent)) {
      current.count += 1;
      current.stubMessageIds.push(String(m.id));
      current.stubMessages.push(m);
      // Prefer the smallest first message id we have seen so the target
      // scrolls to the top of the moved batch.
      if (
        typeof firstMsgId === 'number' &&
        (current.firstMessageId === undefined ||
          firstMsgId < current.firstMessageId)
      ) {
        current.firstMessageId = firstMsgId;
      }
      currentLastTime = createdAt || currentLastTime;
    } else {
      current = {
        conversationId: convId,
        count: 1,
        firstMessageId: typeof firstMsgId === 'number' ? firstMsgId : undefined,
        stubMessageIds: [String(m.id)],
        stubMessages: [m],
        targetMessages: [],
      };
      currentBatch = batchId;
      currentLastTime = createdAt;
      groups.push(current);
    }
  }

  return groups;
}

/**
 * Group target-side messages that carry `metadata.moved_from` by batch_id
 * (preferred) or by source conversation_id + adjacency. The returned groups
 * are used to render ONE banner above each contiguous block of moved messages.
 */
export function groupMovedTarget(messages: ChatMessage[]): MovedGroup[] {
  const groups: MovedGroup[] = [];
  let current: MovedGroup | null = null;
  let currentBatch: string | number | null = null;
  let currentLastTime = 0;

  for (const m of messages) {
    const meta = getMovedFrom(m);
    if (!meta || !meta.conversation_id) {
      current = null;
      currentBatch = null;
      currentLastTime = 0;
      continue;
    }
    const convId = Number(meta.conversation_id);
    const batchId = meta.batch_id ?? null;
    const createdAt = getCreatedAt(m);
    const sourceMsgId =
      typeof meta.message_id === 'number' ? meta.message_id : undefined;

    const sameBatch =
      current &&
      batchId !== null &&
      currentBatch !== null &&
      String(batchId) === String(currentBatch) &&
      current.conversationId === convId;

    const sameAdjacent =
      current &&
      (batchId === null || currentBatch === null) &&
      current.conversationId === convId &&
      createdAt > 0 &&
      currentLastTime > 0 &&
      Math.abs(createdAt - currentLastTime) < ADJACENCY_GAP_MS;

    if (current && (sameBatch || sameAdjacent)) {
      current.count += 1;
      current.targetMessages.push(m);
      if (
        sourceMsgId !== undefined &&
        (current.firstMessageId === undefined ||
          sourceMsgId < current.firstMessageId)
      ) {
        current.firstMessageId = sourceMsgId;
      }
      currentLastTime = createdAt || currentLastTime;
    } else {
      current = {
        conversationId: convId,
        count: 1,
        firstMessageId: sourceMsgId,
        stubMessageIds: [],
        stubMessages: [],
        targetMessages: [m],
      };
      currentBatch = batchId;
      currentLastTime = createdAt;
      groups.push(current);
    }
  }

  return groups;
}

/**
 * Index target messages → group head id (so the renderer can show ONE banner
 * above the first message of each group, and skip the banner for the rest).
 */
export function buildMovedFromBannerIndex(
  messages: ChatMessage[],
): Map<string, MovedGroup> {
  const groups = groupMovedTarget(messages);
  const idx = new Map<string, MovedGroup>();
  for (const g of groups) {
    if (g.targetMessages.length === 0) continue;
    const headId = String(g.targetMessages[0].id);
    idx.set(headId, g);
  }
  return idx;
}
