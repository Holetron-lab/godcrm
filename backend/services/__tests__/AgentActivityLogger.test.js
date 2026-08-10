/**
 * AgentActivityLogger Tests
 * Ticket #40813: Agent Activity logging to table 1701
 *
 * Tests the fire-and-forget logging service:
 *   - logAgentActivity (core)
 *   - logMessageSent, logAgentMentioned, logToolUsed, logAgentError, logTaskCompleted (convenience)
 *   - Non-blocking: errors inside logger never throw
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock database functions
const mockDbRun = vi.fn();

vi.mock('../../database/connection', () => ({
  dbRun: (...args) => mockDbRun(...args),
  sqlNow: () => "datetime('now')",
}));

// Mock baseId generator
vi.mock('../../utils/baseId', () => ({
  generateBaseId: () => 'TESTID01',
}));

// Mock logger to avoid noise in tests
vi.mock('../../utils/logger', () => ({
  aiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  logAgentActivity,
  logMessageSent,
  logAgentMentioned,
  logToolUsed,
  logAgentError,
  logTaskCompleted,
  ACTION_TYPES,
} from '../AgentActivityLogger.js';

describe('AgentActivityLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRun.mockResolvedValue({ lastID: 42 });
  });

  describe('ACTION_TYPES', () => {
    it('exports the expected action types matching table 1701 schema', () => {
      expect(ACTION_TYPES).toContain('message_sent');
      expect(ACTION_TYPES).toContain('error_occurred');
      expect(ACTION_TYPES).toContain('task_completed');
      expect(ACTION_TYPES).toContain('agent_mentioned');
      expect(ACTION_TYPES).toContain('task_started');
      expect(ACTION_TYPES).toContain('task_failed');
      expect(ACTION_TYPES).toContain('code_change');
      expect(ACTION_TYPES).toContain('test_run');
      expect(ACTION_TYPES).toContain('retry_attempted');
      expect(ACTION_TYPES.length).toBe(13);
    });
  });

  describe('logAgentActivity', () => {
    it('inserts a row into table 1701 with correct data', async () => {
      const rowId = await logAgentActivity({
        agent_id: 'developer-ralph',
        action: 'task_started',
        details: 'Starting work on ticket #40813',
        success: true,
        task_id: 40813,
        duration_ms: 1500,
        tokens_used: 200,
        cost_usd: 0.003,
      });

      expect(rowId).toBe(42);
      expect(mockDbRun).toHaveBeenCalledTimes(1);

      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain('INSERT INTO table_rows');
      expect(sql).toContain('table_id');
      expect(params[0]).toBe(1701); // table_id
      expect(params[1]).toBe('TESTID01'); // base_id

      const data = JSON.parse(params[2]);
      expect(data.agent_id).toBe('developer-ralph');
      expect(data.action).toBe('task_started');
      expect(data.details).toBe('Starting work on ticket #40813');
      expect(data.success).toBe(true);
      expect(data.task_id).toBe(40813);
      expect(data.duration_ms).toBe(1500);
      expect(data.tokens_used).toBe(200);
      expect(data.cost_usd).toBe(0.003);
      expect(data.timestamp).toBeDefined();
    });

    it('returns null and warns when agent_id is missing', async () => {
      const rowId = await logAgentActivity({ action: 'task_started' });
      expect(rowId).toBeNull();
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('returns null and warns when action is missing', async () => {
      const rowId = await logAgentActivity({ agent_id: 'test-agent' });
      expect(rowId).toBeNull();
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('returns null when entry is null', async () => {
      const rowId = await logAgentActivity(null);
      expect(rowId).toBeNull();
      expect(mockDbRun).not.toHaveBeenCalled();
    });

    it('never throws even if dbRun fails (fire-and-forget)', async () => {
      mockDbRun.mockRejectedValue(new Error('DB connection lost'));

      const rowId = await logAgentActivity({
        agent_id: 'test-agent',
        action: 'message_sent',
      });

      expect(rowId).toBeNull();
      // Should NOT throw
    });

    it('defaults success to true when not provided', async () => {
      await logAgentActivity({
        agent_id: 'test-agent',
        action: 'message_sent',
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.success).toBe(true);
    });

    it('includes conversation_id in details when provided', async () => {
      await logAgentActivity({
        agent_id: 'test-agent',
        action: 'message_sent',
        conversation_id: 555,
        details: 'Agent responded',
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.details).toContain('[conv:555]');
      expect(data.details).toContain('Agent responded');
    });

    it('handles conversation_id without explicit details', async () => {
      await logAgentActivity({
        agent_id: 'test-agent',
        action: 'message_sent',
        conversation_id: 123,
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.details).toBe('[conv:123]');
    });

    it('handles error_message field', async () => {
      await logAgentActivity({
        agent_id: 'test-agent',
        action: 'error_occurred',
        success: false,
        error_message: 'Rate limit exceeded',
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.success).toBe(false);
      expect(data.error_message).toBe('Rate limit exceeded');
    });

    it('uses lastInsertRowid if lastID is not available', async () => {
      mockDbRun.mockResolvedValue({ lastInsertRowid: 99 });

      const rowId = await logAgentActivity({
        agent_id: 'test-agent',
        action: 'message_sent',
      });

      expect(rowId).toBe(99);
    });
  });

  describe('logMessageSent', () => {
    it('logs a message_sent action with conversation context', async () => {
      await logMessageSent('developer-ralph', 100, 'Responded to user query');

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.agent_id).toBe('developer-ralph');
      expect(data.action).toBe('message_sent');
      expect(data.details).toContain('[conv:100]');
      expect(data.details).toContain('Responded to user query');
      expect(data.success).toBe(true);
    });

    it('uses default details when none provided', async () => {
      await logMessageSent('test-agent', 200);

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.details).toContain('Agent responded to message');
    });
  });

  describe('logAgentMentioned', () => {
    it('logs an agent_mentioned action', async () => {
      await logAgentMentioned('architect', 300, 'user-42');

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.agent_id).toBe('architect');
      expect(data.action).toBe('agent_mentioned');
      expect(data.details).toContain('Mentioned by user user-42');
    });

    it('handles missing triggeredBy', async () => {
      await logAgentMentioned('architect', 300);

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.details).toContain('Agent mentioned');
    });
  });

  describe('logToolUsed', () => {
    it('logs a tool usage action', async () => {
      await logToolUsed('developer-ralph', 'query_table', 400, {
        duration_ms: 250,
        tokens_used: 150,
        success: true,
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.agent_id).toBe('developer-ralph');
      expect(data.action).toBe('task_started');
      expect(data.details).toContain('Tool used: query_table');
      expect(data.duration_ms).toBe(250);
      expect(data.tokens_used).toBe(150);
      expect(data.success).toBe(true);
    });

    it('defaults success to true when not provided in extra', async () => {
      await logToolUsed('test-agent', 'read_file', 400);

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.success).toBe(true);
    });
  });

  describe('logAgentError', () => {
    it('logs an error with Error object', async () => {
      await logAgentError('frontend', 500, new Error('API timeout'));

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.agent_id).toBe('frontend');
      expect(data.action).toBe('error_occurred');
      expect(data.success).toBe(false);
      expect(data.error_message).toBe('API timeout');
    });

    it('logs an error with string message', async () => {
      await logAgentError('frontend', 500, 'Connection refused');

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.error_message).toBe('Connection refused');
    });
  });

  describe('logTaskCompleted', () => {
    it('logs task completion with metrics', async () => {
      await logTaskCompleted('developer-ralph', 600, {
        duration_ms: 5000,
        tokens_used: 1200,
        cost_usd: 0.015,
      });

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.agent_id).toBe('developer-ralph');
      expect(data.action).toBe('task_completed');
      expect(data.success).toBe(true);
      expect(data.duration_ms).toBe(5000);
      expect(data.tokens_used).toBe(1200);
      expect(data.cost_usd).toBe(0.015);
    });

    it('works without extra metrics', async () => {
      await logTaskCompleted('test-agent', 600);

      const data = JSON.parse(mockDbRun.mock.calls[0][1][2]);
      expect(data.action).toBe('task_completed');
      expect(data.success).toBe(true);
    });
  });

  describe('fire-and-forget behavior', () => {
    it('all convenience methods return a Promise', () => {
      const promises = [
        logMessageSent('a', 1),
        logAgentMentioned('a', 1),
        logToolUsed('a', 'tool', 1),
        logAgentError('a', 1, 'err'),
        logTaskCompleted('a', 1),
      ];

      // All should be promises (fire-and-forget)
      promises.forEach(p => {
        expect(p).toBeInstanceOf(Promise);
      });
    });

    it('convenience methods never throw on DB failure', async () => {
      mockDbRun.mockRejectedValue(new Error('DB dead'));

      // None of these should throw
      await logMessageSent('a', 1);
      await logAgentMentioned('a', 1);
      await logToolUsed('a', 'tool', 1);
      await logAgentError('a', 1, 'err');
      await logTaskCompleted('a', 1);
    });
  });
});
