// ADR-0068 WP-B — rowAttachment.js is the single source of truth for the
// `bound_table_id = 0` sentinel ≡ "this conversation/message is bound to
// another conversation row". Tests pin the routing so future refactors can't
// accidentally re-route the sentinel through universal_tables.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGetMock = vi.fn();
vi.mock('../../../routes/v3/chat/chatShared.js', () => ({
  dbGet: (...args) => dbGetMock(...args),
}));

const { resolveAttachedRow, isConversationSentinel, CONVERSATIONS_SENTINEL, BOUND_TABLE_ID_CONVERSATIONS, getCommentThreadChildId } = await import('../rowAttachment.js');

describe('rowAttachment — ADR-0068 WP-B sentinel resolver', () => {
  beforeEach(() => dbGetMock.mockReset());

  it('exports the sentinel constant as 0 (architect-locked value)', () => {
    expect(CONVERSATIONS_SENTINEL).toBe(0);
    expect(BOUND_TABLE_ID_CONVERSATIONS).toBe(0);
  });

  it('isConversationSentinel matches 0, rejects everything else', () => {
    expect(isConversationSentinel(0)).toBe(true);
    expect(isConversationSentinel('0')).toBe(true); // coerced
    expect(isConversationSentinel(1)).toBe(false);
    expect(isConversationSentinel(null)).toBe(false);
    expect(isConversationSentinel(undefined)).toBe(false);
  });

  it('sentinel path queries conversations, not universal_tables', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 42, title: 'Parent chat', type: 'chat' });

    const out = await resolveAttachedRow({ bound_table_id: 0, bound_row_id: 42 });

    expect(out).toEqual({
      table_name: 'conversations',
      row_title: 'Parent chat',
      source: 'conversation',
    });
    expect(dbGetMock).toHaveBeenCalledOnce();
    expect(dbGetMock.mock.calls[0][0]).toMatch(/FROM\s+conversations/i);
    expect(dbGetMock.mock.calls[0][0]).not.toMatch(/universal_tables/i);
  });

  it('falls back to row-id title when conversation has no title', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 42, title: null, type: 'chat' });
    const out = await resolveAttachedRow({ bound_table_id: 0, bound_row_id: 42 });
    expect(out.row_title).toBe('Conversation #42');
  });

  it('returns null when sentinel target conversation does not exist', async () => {
    dbGetMock.mockResolvedValueOnce(null);
    const out = await resolveAttachedRow({ bound_table_id: 0, bound_row_id: 999 });
    expect(out).toBeNull();
  });

  it('non-sentinel path resolves via universal_tables', async () => {
    dbGetMock.mockResolvedValueOnce({ name: 'tickets' });
    const out = await resolveAttachedRow({ bound_table_id: 1708, bound_row_id: 158946 });
    expect(out).toEqual({
      table_name: 'tickets',
      row_title: null,
      source: 'universal_table',
    });
    expect(dbGetMock.mock.calls[0][0]).toMatch(/FROM\s+universal_tables/i);
  });

  it('returns null for invalid inputs', async () => {
    expect(await resolveAttachedRow({ bound_table_id: 0, bound_row_id: 0 })).toBeNull();
    expect(await resolveAttachedRow({ bound_table_id: null, bound_row_id: 42 })).toBeNull();
    expect(await resolveAttachedRow({})).toBeNull();
  });

  it('getCommentThreadChildId returns the active child id', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 555 });
    const out = await getCommentThreadChildId(100);
    expect(out).toBe(555);
    const [sql, params] = dbGetMock.mock.calls[0];
    expect(sql).toMatch(/parent_conversation_id\s*=\s*\$1/);
    expect(sql).toMatch(/purpose\s*=\s*'comments'/);
    expect(params).toEqual([100]);
  });

  it('getCommentThreadChildId returns null when no active child exists', async () => {
    dbGetMock.mockResolvedValueOnce(null);
    expect(await getCommentThreadChildId(100)).toBeNull();
  });

  it('getCommentThreadChildId rejects invalid parent ids without hitting the DB', async () => {
    expect(await getCommentThreadChildId(null)).toBeNull();
    expect(await getCommentThreadChildId(0)).toBeNull();
    expect(await getCommentThreadChildId(-5)).toBeNull();
    expect(await getCommentThreadChildId('foo')).toBeNull();
    expect(dbGetMock).not.toHaveBeenCalled();
  });
});
