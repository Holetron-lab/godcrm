// ADR-0031 P6 — spawnTicketFromCriterion tests.
//
// Covers:
//   1. Happy path with auto-discovered messages (skips moved stubs)
//   2. Happy path with explicit message_ids
//   3. ticket_data validation (missing what / assigned_to)
//   4. source conversation not found
//   5. empty source conversation (no movable messages)
//   6. spawned_from links source bound row to new ticket
//   7. moveMessages failure surfaces upstream

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGetMock = vi.fn();
const dbAllMock = vi.fn();
const dbRunMock = vi.fn();
const isPostgresMock = vi.fn(() => true);
const ensureRowChatMock = vi.fn();
const moveMessagesMock = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  dbRun: (...args) => dbRunMock(...args),
  isPostgres: () => isPostgresMock(),
}));

vi.mock('../tableMutationService.js', () => ({
  ensureRowChat: (...args) => ensureRowChatMock(...args),
}));

vi.mock('../messageMoveService.js', () => ({
  moveMessages: (...args) => moveMessagesMock(...args),
  MoveValidationError: class extends Error {},
  MoveAuthError: class extends Error {},
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/baseId.js', () => ({
  generateBaseId: () => 'TESTBASE',
}));

vi.mock('../chain-handoff/constants.js', () => ({
  TICKETS_TABLE_ID: 1708,
}));

import { spawnTicketFromCriterion, SpawnValidationError } from '../criterionTicketSpawnService.js';

describe('spawnTicketFromCriterion — ADR-0031 P6', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbAllMock.mockReset();
    dbRunMock.mockReset();
    ensureRowChatMock.mockReset();
    moveMessagesMock.mockReset();
  });

  function mockSourceConversation(overrides = {}) {
    dbGetMock.mockResolvedValueOnce({
      id: 3001,
      bound_table_id: 7256,
      bound_row_id: 134220,
      space_id: 11,
      ...overrides,
    });
  }

  it('happy path: auto-discovers movable messages, creates ticket+chat, moves all', async () => {
    mockSourceConversation();
    dbAllMock.mockResolvedValueOnce([{ id: 501 }, { id: 502 }, { id: 503 }]);
    dbRunMock.mockResolvedValueOnce({ rows: [{ id: 144000 }] });
    ensureRowChatMock.mockResolvedValueOnce({ id: 4500 });
    moveMessagesMock.mockResolvedValueOnce({
      moved_count: 3,
      source_message_ids: [501, 502, 503],
      target_message_ids: [9001, 9002, 9003],
    });

    const result = await spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'Fix regression', why: 'criterion failed', assigned_to: 7 },
      userId: 7,
    });

    expect(result.ticket_id).toBe(144000);
    expect(result.ticket_conversation_id).toBe(4500);
    expect(result.moved_count).toBe(3);
    expect(result.spawned_from).toEqual({
      table_id: 7256,
      row_id: 134220,
      conversation_id: 3001,
    });

    const insertSql = dbRunMock.mock.calls[0][0];
    expect(insertSql).toMatch(/INSERT INTO table_rows/);
    const insertParams = dbRunMock.mock.calls[0][1];
    expect(insertParams[0]).toBe(1708);
    expect(insertParams[1]).toBe('TESTBASE');
    const persistedData = JSON.parse(insertParams[2]);
    expect(persistedData.what).toBe('Fix regression');
    expect(persistedData.spawned_from.row_id).toBe(134220);
    expect(persistedData.state).toBe(24275);

    expect(ensureRowChatMock).toHaveBeenCalledWith(expect.objectContaining({
      tableId: 1708,
      rowId: 144000,
      actorId: 7,
    }));
    expect(moveMessagesMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceConversationId: 3001,
      targetConversationId: 4500,
      messageIds: [501, 502, 503],
      actorIsChatOwner: true,
    }));
  });

  it('uses explicit message_ids when provided, skipping auto-discovery', async () => {
    mockSourceConversation();
    dbRunMock.mockResolvedValueOnce({ rows: [{ id: 144001 }] });
    ensureRowChatMock.mockResolvedValueOnce({ id: 4501 });
    moveMessagesMock.mockResolvedValueOnce({
      moved_count: 1,
      source_message_ids: [502],
      target_message_ids: [9100],
    });

    const result = await spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'subset only', assigned_to: 7 },
      messageIds: [502],
      userId: 7,
    });

    expect(dbAllMock).not.toHaveBeenCalled();
    expect(moveMessagesMock.mock.calls[0][0].messageIds).toEqual([502]);
    expect(result.moved_count).toBe(1);
  });

  it('rejects when ticket_data.what is missing', async () => {
    await expect(spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { assigned_to: 7 },
      userId: 7,
    })).rejects.toBeInstanceOf(SpawnValidationError);
  });

  it('rejects when ticket_data.assigned_to is missing', async () => {
    await expect(spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'no assignee' },
      userId: 7,
    })).rejects.toBeInstanceOf(SpawnValidationError);
  });

  it('rejects when source conversation does not exist', async () => {
    dbGetMock.mockResolvedValueOnce(null);
    await expect(spawnTicketFromCriterion({
      sourceConversationId: 9999,
      ticketData: { what: 'X', assigned_to: 7 },
      userId: 7,
    })).rejects.toBeInstanceOf(SpawnValidationError);
  });

  it('rejects when source conversation has no movable messages', async () => {
    mockSourceConversation();
    dbAllMock.mockResolvedValueOnce([]);
    await expect(spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'X', assigned_to: 7 },
      userId: 7,
    })).rejects.toBeInstanceOf(SpawnValidationError);
  });

  it('surfaces moveMessages failure (ticket+chat already created — caller handles cleanup)', async () => {
    mockSourceConversation();
    dbAllMock.mockResolvedValueOnce([{ id: 501 }]);
    dbRunMock.mockResolvedValueOnce({ rows: [{ id: 144002 }] });
    ensureRowChatMock.mockResolvedValueOnce({ id: 4502 });
    moveMessagesMock.mockRejectedValueOnce(new Error('database error during move'));

    await expect(spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'fail in move', assigned_to: 7 },
      userId: 7,
    })).rejects.toThrow(/database error during move/);

    expect(dbRunMock).toHaveBeenCalledTimes(1);
    expect(ensureRowChatMock).toHaveBeenCalledTimes(1);
  });

  it('preserves source bound row info (criterion id 7256:X) in spawned_from on the ticket', async () => {
    mockSourceConversation({ bound_table_id: 7256, bound_row_id: 999 });
    dbAllMock.mockResolvedValueOnce([{ id: 700 }]);
    dbRunMock.mockResolvedValueOnce({ rows: [{ id: 144003 }] });
    ensureRowChatMock.mockResolvedValueOnce({ id: 4503 });
    moveMessagesMock.mockResolvedValueOnce({
      moved_count: 1,
      source_message_ids: [700],
      target_message_ids: [9200],
    });

    const result = await spawnTicketFromCriterion({
      sourceConversationId: 3001,
      ticketData: { what: 'criterion regression follow-up', assigned_to: 7 },
      userId: 7,
    });

    const persistedData = JSON.parse(dbRunMock.mock.calls[0][1][2]);
    expect(persistedData.spawned_from).toEqual({
      table_id: 7256,
      row_id: 999,
      conversation_id: 3001,
    });
    expect(result.spawned_from.row_id).toBe(999);
  });
});
