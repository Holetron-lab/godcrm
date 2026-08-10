// ADR-0031 P5 / ADR-133 WP-20 — moveMessages tests
//
// Covers:
//   1. Move 3 messages → source becomes 3 stubs, target gets 3 inserts with moved_from
//   2. Auth fail (non-participant) → throws MoveAuthError
//   3. Source/target same → throws MoveValidationError
//   4. Already-moved message → throws MoveValidationError
//   5. Agent context reader (formatMessageByLevel) replaces 'moved' content with breadcrumb

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGetMock = vi.fn();
const withTransactionAsyncMock = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbGet: (...args) => dbGetMock(...args),
  withTransactionAsync: (...args) => withTransactionAsyncMock(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { moveMessages, MoveValidationError, MoveAuthError } from '../messageMoveService.js';
import { formatMessageByLevel } from '../chat/agent-execution-shared/helpers.js';

describe('moveMessages — ADR-0031 P5 / ADR-133 WP-20', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    withTransactionAsyncMock.mockReset();
  });

  function authBoth() {
    dbGetMock.mockImplementation((sql, params) => {
      if (/conversation_participants/.test(sql)) return Promise.resolve({ user_id: params[1] });
      // ADR-0031 §Z / WP-24: actor snapshot for moved_by metadata
      if (/FROM users WHERE id/i.test(sql)) {
        return Promise.resolve({
          id: params[0], name: 'Alice Mover', username: 'alice', avatar: '/uploads/alice.png',
        });
      }
      return Promise.resolve(null);
    });
  }

  it('moves 3 messages: stubs source, inserts target with moved_from', async () => {
    authBoth();
    const sourceMsgs = [
      { id: 101, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
        content: 'first', content_type: 'text', agent_id: null, model_used: null,
        mentions: '[]', attachments: '[]', tool_results: null, metadata: {},
        created_at: '2026-05-04T10:00:00Z' },
      { id: 102, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
        content: 'second', content_type: 'text', agent_id: null, model_used: null,
        mentions: '[]', attachments: '[]', tool_results: null, metadata: {},
        created_at: '2026-05-04T10:01:00Z' },
      { id: 103, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
        content: 'third', content_type: 'text', agent_id: null, model_used: null,
        mentions: '[]', attachments: '[]', tool_results: null, metadata: {},
        created_at: '2026-05-04T10:02:00Z' },
    ];
    const insertCalls = [];
    const updateCalls = [];
    let insertCounter = 200;

    withTransactionAsyncMock.mockImplementation(async (cb) => {
      const trx = {
        all: vi.fn(async (sql, params) => {
          if (/FROM messages\b/i.test(sql) && /id = ANY/i.test(sql)) return sourceMsgs;
          return [];
        }),
        run: vi.fn(async (sql, params) => {
          if (/^\s*INSERT INTO messages/i.test(sql)) {
            insertCalls.push({ sql, params });
            return { lastInsertRowid: ++insertCounter, changes: 1 };
          }
          if (/^\s*UPDATE messages/i.test(sql)) {
            updateCalls.push({ sql, params });
            return { changes: 1 };
          }
          if (/^\s*UPDATE conversations/i.test(sql)) return { changes: 1 };
          return { changes: 0 };
        }),
      };
      return cb(trx);
    });

    const result = await moveMessages({
      sourceConversationId: 1,
      targetConversationId: 2,
      messageIds: [101, 102, 103],
      userId: 7,
    });

    expect(result.moved_count).toBe(3);
    expect(result.source_message_ids).toEqual([101, 102, 103]);
    expect(result.target_message_ids).toEqual([201, 202, 203]);
    // ADR-0031 §Z / WP-24: batch_id is a v4 UUID, returned from the service
    expect(result.batch_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const expectedBatchId = result.batch_id;

    expect(insertCalls.length).toBe(3);
    // Each insert contains conversation_id=2 + metadata with moved_from (incl. batch_id + moved_by)
    const expectedMovedBy = { user_id: 7, name: 'Alice Mover', avatar: '/uploads/alice.png' };
    const firstInsertMeta = JSON.parse(insertCalls[0].params[11]);
    expect(firstInsertMeta.moved_from).toEqual({
      conversation_id: 1, message_id: 101, original_time: '2026-05-04T10:00:00Z',
      batch_id: expectedBatchId, moved_by: expectedMovedBy,
    });
    expect(insertCalls[0].params[0]).toBe(2);
    // All 3 target messages share the same batch_id and same moved_by snapshot
    for (const call of insertCalls) {
      const meta = JSON.parse(call.params[11]);
      expect(meta.moved_from.batch_id).toBe(expectedBatchId);
      expect(meta.moved_from.moved_by).toEqual(expectedMovedBy);
    }

    expect(updateCalls.length).toBe(3);
    // First stub points to its new id 201, plus the full batch [201,202,203] so
    // the frontend [Открыть →] button can scroll to the first moved message.
    const firstStubMeta = JSON.parse(updateCalls[0].params[1]);
    expect(firstStubMeta.moved_to).toEqual({
      conversation_id: 2, message_id: 201, message_ids: [201, 202, 203],
      batch_id: expectedBatchId, moved_by: expectedMovedBy,
    });
    expect(updateCalls[0].params[0]).toBe('Moved to chat #2');
    expect(updateCalls[0].params[2]).toBe(101);
    // Third stub: own message_id is 203, batch identical, moved_by identical
    const thirdStubMeta = JSON.parse(updateCalls[2].params[1]);
    expect(thirdStubMeta.moved_to.message_id).toBe(203);
    expect(thirdStubMeta.moved_to.message_ids).toEqual([201, 202, 203]);
    expect(thirdStubMeta.moved_to.batch_id).toBe(expectedBatchId);
    expect(thirdStubMeta.moved_to.moved_by).toEqual(expectedMovedBy);
  });

  it('strips oversized avatar (>2KB) from moved_by snapshot', async () => {
    const longAvatar = 'data:image/png;base64,' + 'A'.repeat(3000);
    dbGetMock.mockImplementation((sql, params) => {
      if (/conversation_participants/.test(sql)) return Promise.resolve({ user_id: params[1] });
      if (/FROM users WHERE id/i.test(sql)) {
        return Promise.resolve({ id: params[0], name: 'Bob', username: 'bob', avatar: longAvatar });
      }
      return Promise.resolve(null);
    });
    const insertCalls = [];
    let counter = 200;
    withTransactionAsyncMock.mockImplementation(async (cb) => cb({
      all: async () => [{
        id: 101, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
        content: 'x', content_type: 'text', agent_id: null, model_used: null,
        mentions: '[]', attachments: '[]', tool_results: null, metadata: {},
        created_at: '2026-05-04T10:00:00Z',
      }],
      run: async (sql, params) => {
        if (/^\s*INSERT INTO messages/i.test(sql)) {
          insertCalls.push({ sql, params });
          return { lastInsertRowid: ++counter };
        }
        return { changes: 1 };
      },
    }));

    await moveMessages({
      sourceConversationId: 1, targetConversationId: 2, messageIds: [101], userId: 7,
    });
    const meta = JSON.parse(insertCalls[0].params[11]);
    expect(meta.moved_from.moved_by).toEqual({ user_id: 7, name: 'Bob', avatar: null });
  });

  it('refuses move when caller is not a participant of target', async () => {
    dbGetMock.mockImplementation((sql, params) => {
      if (/conversation_participants/.test(sql)) {
        // participant of source (#1) but not target (#2)
        if (Number(params[0]) === 1) return Promise.resolve({ user_id: params[1] });
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    await expect(moveMessages({
      sourceConversationId: 1, targetConversationId: 2, messageIds: [101], userId: 7,
    })).rejects.toThrow(MoveAuthError);
    // transaction must not run
    expect(withTransactionAsyncMock).not.toHaveBeenCalled();
  });

  it('rejects identical source and target', async () => {
    authBoth();
    await expect(moveMessages({
      sourceConversationId: 1, targetConversationId: 1, messageIds: [101], userId: 7,
    })).rejects.toThrow(MoveValidationError);
  });

  it('rejects already-moved messages', async () => {
    authBoth();
    withTransactionAsyncMock.mockImplementation(async (cb) => {
      const trx = {
        all: vi.fn(async () => [{
          id: 101, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
          content: 'old', content_type: 'moved', agent_id: null, model_used: null,
          mentions: '[]', attachments: '[]', tool_results: null,
          metadata: { moved_to: { conversation_id: 9, message_ids: [555] } },
          created_at: '2026-05-04T10:00:00Z',
        }]),
        run: vi.fn(),
      };
      return cb(trx);
    });

    await expect(moveMessages({
      sourceConversationId: 1, targetConversationId: 2, messageIds: [101], userId: 7,
    })).rejects.toThrow(/already moved/);
  });

  it('rejects empty message_ids', async () => {
    authBoth();
    await expect(moveMessages({
      sourceConversationId: 1, targetConversationId: 2, messageIds: [], userId: 7,
    })).rejects.toThrow(MoveValidationError);
  });

  it('actorIsChatOwner=true skips participation lookup (chat-owner / admin override path)', async () => {
    // Participant lookup must be bypassed; only the actor-snapshot dbGet runs.
    dbGetMock.mockReset();
    dbGetMock.mockImplementation((sql, params) => {
      if (/FROM users WHERE id/i.test(sql)) {
        return Promise.resolve({ id: params[0], name: 'Owner', username: 'owner', avatar: null });
      }
      return Promise.resolve(null);
    });
    withTransactionAsyncMock.mockImplementation(async (cb) => cb({
      all: async () => [{
        id: 101, conversation_id: 1, sender_id: 7, sender_type: 'human', role: 'user',
        content: 'x', content_type: 'text', agent_id: null, model_used: null,
        mentions: '[]', attachments: '[]', tool_results: null, metadata: {},
        created_at: '2026-05-04T10:00:00Z',
      }],
      run: async (sql) => /^\s*INSERT/i.test(sql) ? { lastInsertRowid: 999 } : { changes: 1 },
    }));

    const result = await moveMessages({
      sourceConversationId: 1, targetConversationId: 2, messageIds: [101], userId: 7,
      actorIsChatOwner: true,
    });
    expect(result.moved_count).toBe(1);
    // No participant lookup, but actor-snapshot dbGet still runs.
    const sqls = dbGetMock.mock.calls.map(c => c[0]);
    expect(sqls.some(sql => /conversation_participants/.test(sql))).toBe(false);
    expect(sqls.some(sql => /FROM users WHERE id/i.test(sql))).toBe(true);
  });
});

describe('formatMessageByLevel — \'moved\' breadcrumb (ADR-0031 P5)', () => {
  it('replaces moved-stub content with breadcrumb pointing to target chat', () => {
    const stub = {
      id: 999, content_type: 'moved',
      content: 'Moved to chat #42',
      metadata: { moved_to: { conversation_id: 42, message_ids: [201, 202] } },
    };
    const out = formatMessageByLevel(stub, {});
    expect(out).toMatch(/\[Moved to chat #42/);
    expect(out).toMatch(/metadata\.moved_to\.conversation_id/);
  });

  it('falls back gracefully if metadata.moved_to is missing', () => {
    const stub = { id: 999, content_type: 'moved', content: 'Moved', metadata: {} };
    const out = formatMessageByLevel(stub, {});
    expect(out).toBe('[Moved to another chat]');
  });
});
