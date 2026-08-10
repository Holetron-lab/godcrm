// @vitest-environment node
/**
 * ADR-0031 P5/P6 — MCP wrappers for moveMessages + spawnTicketFromCriterion.
 *
 * Validates auth gating, input validation, and that errors from the underlying
 * services are forwarded with the right shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();
const isPostgres = vi.fn(() => false);
const sqlNow = vi.fn(() => "datetime('now')");

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  dbAll: (...args) => dbAll(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: vi.fn(),
  hasInvocationTokens: vi.fn(() => false),
}));

const moveMessages = vi.fn();
const spawnTicketFromCriterion = vi.fn();

class MockMoveValidationError extends Error {
  constructor(m) { super(m); this.name = 'MoveValidationError'; this.code = 'VALIDATION'; }
}
class MockMoveAuthError extends Error {
  constructor(m) { super(m); this.name = 'MoveAuthError'; this.code = 'AUTH'; }
}
class MockSpawnValidationError extends Error {
  constructor(m) { super(m); this.name = 'SpawnValidationError'; this.code = 'VALIDATION'; }
}

vi.mock('../../messageMoveService.js', () => ({
  moveMessages: (...args) => moveMessages(...args),
  MoveValidationError: MockMoveValidationError,
  MoveAuthError: MockMoveAuthError,
}));

vi.mock('../../criterionTicketSpawnService.js', () => ({
  spawnTicketFromCriterion: (...args) => spawnTicketFromCriterion(...args),
  SpawnValidationError: MockSpawnValidationError,
}));

const canAdminister = vi.fn();
vi.mock('../../EffectiveRoleService.js', () => ({
  canAdminister: (...args) => canAdminister(...args),
}));

const { chatToolHandlers } = await import('../chat-tools.js');

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  moveMessages.mockReset();
  spawnTicketFromCriterion.mockReset();
  canAdminister.mockReset();
  canAdminister.mockResolvedValue(false);
});

describe('move_chat_messages — input validation', () => {
  it('rejects missing source_conversation_id', async () => {
    const res = await chatToolHandlers.move_chat_messages(
      { target_conversation_id: 2, message_ids: [1] }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('source_conversation_id') });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('rejects missing target_conversation_id', async () => {
    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 1, message_ids: [1] }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('target_conversation_id') });
  });

  it('rejects empty message_ids', async () => {
    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 1, target_conversation_id: 2, message_ids: [] }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('message_ids') });
  });
});

describe('move_chat_messages — auth gating', () => {
  it('rejects when caller is neither chat owner nor space admin', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: 11 }); // owned by someone else
    canAdminister.mockResolvedValueOnce(false); // not admin in space 11

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [1, 2] }, 1
    );

    expect(res).toEqual({ error: expect.stringContaining('chat owner or a space admin') });
    expect(canAdminister).toHaveBeenCalledWith(1, { spaceId: 11 });
    expect(moveMessages).not.toHaveBeenCalled();
  });

  it('rejects global users.role=admin when not space admin (no longer honored)', async () => {
    // Global admin is no longer a system override — must be admin within the space.
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: 11 });
    canAdminister.mockResolvedValueOnce(false);

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [1, 2] }, 1
    );

    expect(res).toEqual({ error: expect.stringContaining('chat owner or a space admin') });
    expect(moveMessages).not.toHaveBeenCalled();
  });

  it('passes when caller is chat owner', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 1, space_id: 11 });
    canAdminister.mockResolvedValueOnce(false); // not admin, but is owner — gate still passes
    moveMessages.mockResolvedValueOnce({
      moved_count: 2,
      source_message_ids: [101, 102],
      target_message_ids: [201, 202],
      batch_id: 'abc-123',
    });

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [101, 102] }, 1
    );

    expect(res).toEqual({
      success: true,
      source_conversation_id: 10,
      target_conversation_id: 20,
      moved_count: 2,
      source_message_ids: [101, 102],
      target_message_ids: [201, 202],
      batch_id: 'abc-123',
    });
    expect(moveMessages).toHaveBeenCalledWith({
      sourceConversationId: 10,
      targetConversationId: 20,
      messageIds: [101, 102],
      userId: 1,
      actorIsChatOwner: true,
    });
  });

  it('passes when caller is space admin (not chat owner)', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: 11 }); // not owner
    canAdminister.mockResolvedValueOnce(true);                       // but admin in the space
    moveMessages.mockResolvedValueOnce({
      moved_count: 1, source_message_ids: [5], target_message_ids: [50], batch_id: 'b',
    });

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [5] }, 1
    );

    expect(res.success).toBe(true);
    expect(canAdminister).toHaveBeenCalledWith(1, { spaceId: 11 });
    expect(moveMessages).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsChatOwner: true })
    );
  });

  it('rejects when conversation has no space_id and caller is not owner', async () => {
    // Edge case: orphan conversation with no space_id can't have a space admin override.
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: null });

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [5] }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('chat owner or a space admin') });
    // No space → canAdminister must not be invoked (avoids spurious denied lookups).
    expect(canAdminister).not.toHaveBeenCalled();
    expect(moveMessages).not.toHaveBeenCalled();
  });

  it('errors when source conversation is missing', async () => {
    dbGet.mockResolvedValueOnce(null);
    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 9999, target_conversation_id: 20, message_ids: [1] }, 1
    );
    expect(res).toEqual({ error: expect.stringMatching(/Source conversation 9999 not found/) });
  });
});

describe('move_chat_messages — error forwarding', () => {
  it('forwards MoveValidationError as VALIDATION code', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 1, space_id: 11 });
    moveMessages.mockRejectedValueOnce(new MockMoveValidationError('messages already moved: 5'));

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [5] }, 1
    );
    expect(res).toEqual({ error: 'messages already moved: 5', code: 'VALIDATION' });
  });

  it('forwards MoveAuthError as AUTH code', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 1, space_id: 11 });
    moveMessages.mockRejectedValueOnce(new MockMoveAuthError('not a participant of target conversation'));

    const res = await chatToolHandlers.move_chat_messages(
      { source_conversation_id: 10, target_conversation_id: 20, message_ids: [5] }, 1
    );
    expect(res).toEqual({ error: 'not a participant of target conversation', code: 'AUTH' });
  });
});

describe('spawn_ticket_from_chat — input validation', () => {
  it('rejects missing source_conversation_id', async () => {
    const res = await chatToolHandlers.spawn_ticket_from_chat(
      { ticket_data: { what: 'X', assigned_to: 'developer-ralph' } }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('source_conversation_id') });
  });

  it('rejects missing ticket_data', async () => {
    const res = await chatToolHandlers.spawn_ticket_from_chat(
      { source_conversation_id: 10 }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('ticket_data') });
  });

  it('rejects ticket_data without "what"', async () => {
    const res = await chatToolHandlers.spawn_ticket_from_chat(
      { source_conversation_id: 10, ticket_data: { assigned_to: 'x' } }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('ticket_data.what') });
  });

  it('rejects ticket_data without assigned_to', async () => {
    const res = await chatToolHandlers.spawn_ticket_from_chat(
      { source_conversation_id: 10, ticket_data: { what: 'Bug X' } }, 1
    );
    expect(res).toEqual({ error: expect.stringContaining('assigned_to') });
  });

  it('rejects non-array message_ids', async () => {
    const res = await chatToolHandlers.spawn_ticket_from_chat(
      {
        source_conversation_id: 10,
        ticket_data: { what: 'X', assigned_to: 'y' },
        message_ids: 'not-an-array',
      },
      1
    );
    expect(res).toEqual({ error: expect.stringContaining('message_ids') });
  });
});

describe('spawn_ticket_from_chat — auth + happy path', () => {
  it('rejects when caller is neither chat owner nor space admin', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: 11 });
    canAdminister.mockResolvedValueOnce(false);

    const res = await chatToolHandlers.spawn_ticket_from_chat(
      {
        source_conversation_id: 10,
        ticket_data: { what: 'Bug X', assigned_to: 'developer-ralph' },
      },
      1
    );
    expect(res).toEqual({ error: expect.stringContaining('chat owner or a space admin') });
    expect(canAdminister).toHaveBeenCalledWith(1, { spaceId: 11 });
    expect(spawnTicketFromCriterion).not.toHaveBeenCalled();
  });

  it('passes when caller is space admin (not chat owner)', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 999, space_id: 11 });
    canAdminister.mockResolvedValueOnce(true);
    spawnTicketFromCriterion.mockResolvedValueOnce({
      ticket_id: 42, ticket_conversation_id: 1500, source_conversation_id: 10,
      moved_count: 1, source_message_ids: [1], target_message_ids: [10],
    });

    const res = await chatToolHandlers.spawn_ticket_from_chat(
      {
        source_conversation_id: 10,
        ticket_data: { what: 'Bug X', assigned_to: 'developer-ralph' },
        message_ids: [1],
      },
      1
    );
    expect(res.success).toBe(true);
    expect(spawnTicketFromCriterion).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsChatOwner: true })
    );
  });

  it('returns ticket info on success', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 1, space_id: 11 });
    spawnTicketFromCriterion.mockResolvedValueOnce({
      ticket_id: 42,
      ticket_conversation_id: 1500,
      source_conversation_id: 10,
      moved_count: 4,
      source_message_ids: [1, 2, 3, 4],
      target_message_ids: [10, 11, 12, 13],
      spawned_from: { table_id: null, row_id: null, conversation_id: 10 },
    });

    const res = await chatToolHandlers.spawn_ticket_from_chat(
      {
        source_conversation_id: 10,
        ticket_data: { what: 'Agents not aware of group chat', assigned_to: 'developer-ralph' },
        message_ids: [1, 2, 3, 4],
      },
      1
    );

    expect(res).toMatchObject({
      success: true,
      ticket_id: 42,
      ticket_conversation_id: 1500,
      moved_count: 4,
    });
    expect(spawnTicketFromCriterion).toHaveBeenCalledWith({
      sourceConversationId: 10,
      ticketData: { what: 'Agents not aware of group chat', assigned_to: 'developer-ralph' },
      messageIds: [1, 2, 3, 4],
      userId: 1,
      actorIsChatOwner: true,
    });
  });

  it('forwards SpawnValidationError as VALIDATION code', async () => {
    dbGet.mockResolvedValueOnce({ created_by: 1, space_id: 11 });
    spawnTicketFromCriterion.mockRejectedValueOnce(
      new MockSpawnValidationError('source conversation has no messages eligible to move')
    );

    const res = await chatToolHandlers.spawn_ticket_from_chat(
      { source_conversation_id: 10, ticket_data: { what: 'X', assigned_to: 'y' } }, 1
    );
    expect(res).toEqual({
      error: 'source conversation has no messages eligible to move',
      code: 'VALIDATION',
    });
  });
});
