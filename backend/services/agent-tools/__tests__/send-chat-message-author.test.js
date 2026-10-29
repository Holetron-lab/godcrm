// @vitest-environment node
/**
 * send_chat_message author attribution.
 *
 * MCP callers always arrive with userId=1 (the transport, not the subject).
 * When the execution context carries a trusted agent identity, the stored row
 * must be attributed to that agent — sender_id of its managed user,
 * sender_type='agent', agent_id + the same metadata shape the agent loop
 * writes — never to the owner (message 908676 regression).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn();
const dbRun = vi.fn();
const dbAll = vi.fn();
const isPostgres = vi.fn(() => true);
const sqlNow = vi.fn(() => 'NOW()');

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  dbAll: (...args) => dbAll(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));
vi.mock('../../../utils/logger.js', async () => (await import('../../../test/loggerMock.js')).loggerMock());
vi.mock('../../chat/invocation-dispatcher.js', () => ({
  dispatchInvocationsFromContent: vi.fn(),
  hasInvocationTokens: vi.fn(() => false),
}));
vi.mock('../../messageMoveService.js', () => ({
  moveMessages: vi.fn(), MoveValidationError: class extends Error {}, MoveAuthError: class extends Error {},
}));
vi.mock('../../criterionTicketSpawnService.js', () => ({
  spawnTicketFromCriterion: vi.fn(), SpawnValidationError: class extends Error {},
}));
vi.mock('../../EffectiveRoleService.js', () => ({ canAdminister: vi.fn() }));
vi.mock('../../mail/mailChip.js', () => ({
  isMailMirror: vi.fn(() => false), fetchMailChipHeaders: vi.fn(), mailChipTitle: vi.fn(),
}));

const { chatToolHandlers } = await import('../chat-tools.js');

const AGENT_ROW = 31114;
const AGENT_USER = 21;

function insertParams() {
  const call = dbRun.mock.calls.find(([sql]) => /INSERT INTO messages/.test(sql));
  expect(call, 'INSERT INTO messages was not issued').toBeTruthy();
  return { sql: call[0], params: call[1] };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbRun.mockResolvedValue({ lastInsertRowid: 4242 });
  dbGet.mockImplementation(async (sql) => {
    if (/FROM conversations/.test(sql)) return { id: 3660, space_id: 11 };
    if (/FROM table_rows/.test(sql)) {
      return {
        user_id: AGENT_USER,
        data: JSON.stringify({ name: 'Frontend Developer', icon: '🎨', color: '#10b981' }),
      };
    }
    return null;
  });
});

describe('send_chat_message author attribution', () => {
  it('attributes an MCP call with a trusted agent context to the agent, not userId=1', async () => {
    const res = await chatToolHandlers.send_chat_message(
      { conversation_id: 3660, content: 'progress note' },
      1,
      { source: 'mcp', agentId: AGENT_ROW, agentName: 'frontend-developer' },
    );
    expect(res).toEqual({ success: true, message_id: 4242, message: 'Message sent' });

    const { sql, params } = insertParams();
    expect(sql).toMatch(/sender_type/);
    expect(sql).toMatch(/agent_id/);
    expect(sql).toMatch(/metadata/);
    // (conversation_id, role, content, content_type, sender_id, sender_type, agent_id, attachments, metadata)
    expect(params.slice(0, 8)).toEqual([3660, 'assistant', 'progress note', 'text', AGENT_USER, 'agent', AGENT_ROW, '[]']);
    expect(JSON.parse(params[8])).toEqual({
      agent_name: 'Frontend Developer', agent_icon: '🎨', agent_color: '#10b981', agent_row_id: AGENT_ROW,
    });
    // identity is looked up by the trusted row id, never by a caller-supplied argument
    const lookup = dbGet.mock.calls.find(([s]) => /FROM table_rows/.test(s));
    expect(lookup[1]).toEqual([AGENT_ROW]);
  });

  it('keeps an explicit role from the caller', async () => {
    await chatToolHandlers.send_chat_message(
      { conversation_id: 3660, content: 'x', role: 'system' }, 1, { agentId: AGENT_ROW },
    );
    expect(insertParams().params[1]).toBe('system');
  });

  it('prefers the loop-resolved senderId over the managed-user lookup', async () => {
    await chatToolHandlers.send_chat_message(
      { conversation_id: 3660, content: 'x' }, 7, { agentId: AGENT_ROW, senderId: 19 },
    );
    const { params } = insertParams();
    expect(params[4]).toBe(19);
    expect(params[5]).toBe('agent');
    expect(params[6]).toBe(AGENT_ROW);
  });

  it('without an agent context stays a human message from the caller', async () => {
    await chatToolHandlers.send_chat_message({ conversation_id: 3660, content: 'hi' }, 5, {});
    const { params } = insertParams();
    expect(params.slice(0, 7)).toEqual([3660, 'user', 'hi', 'text', 5, 'human', null]);
    expect(dbGet.mock.calls.some(([s]) => /FROM table_rows/.test(s))).toBe(false);
  });

  it('falls back to the caller when the agent row has no managed user', async () => {
    dbGet.mockImplementation(async (sql) => {
      if (/FROM conversations/.test(sql)) return { id: 3660, space_id: 11 };
      if (/FROM table_rows/.test(sql)) return { user_id: null, data: { name: 'Ghost' } };
      return null;
    });
    await chatToolHandlers.send_chat_message({ conversation_id: 3660, content: 'x' }, 1, { agentId: AGENT_ROW });
    const { params } = insertParams();
    expect(params[4]).toBe(1);
    expect(params[5]).toBe('agent');
    expect(JSON.parse(params[8]).agent_name).toBe('Ghost');
  });
});
