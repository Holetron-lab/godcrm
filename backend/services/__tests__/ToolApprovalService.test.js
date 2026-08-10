/**
 * ToolApprovalService Tests — Ticket #74073: Tool Approval Flow
 *
 * Tests for the tool approval gate system:
 *   - requiresApproval() checks tool_approval_rules and respects auto-approve
 *   - createApprovalRequest() updates message with pending status
 *   - waitForDecision() polls DB and handles timeout
 *   - approveToolExecution() sets approved status, optionally creates always-allow rule
 *   - rejectToolExecution() sets rejected status and stores reason
 *   - getPendingApprovals() returns pending tool_call messages
 *   - getApprovalRules() returns all rules
 *   - updateApprovalRule() updates allowed fields
 *   - matchGlob() pattern matching utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockDbRun, mockDbGet, mockDbAll, mockIsPostgres } = vi.hoisted(() => {
  const mockDbRun = vi.fn();
  const mockDbGet = vi.fn();
  const mockDbAll = vi.fn();
  const mockIsPostgres = vi.fn(() => false);
  return { mockDbRun, mockDbGet, mockDbAll, mockIsPostgres };
});

vi.mock('../../database/connection.js', () => ({
  dbRun: (...args) => mockDbRun(...args),
  dbGet: (...args) => mockDbGet(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => mockIsPostgres(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import SUT after mocks ────────────────────────────────────────────────

import {
  requiresApproval,
  createApprovalRequest,
  waitForDecision,
  approveToolExecution,
  rejectToolExecution,
  getPendingApprovals,
  getApprovalRules,
  updateApprovalRule,
  getTimeoutForTool,
  invalidateRulesCache,
} from '../ToolApprovalService.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MOCK_RULES = [
  { id: 1, tool_name: 'write_file', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: null, timeout_seconds: 300 },
  { id: 2, tool_name: 'delete_row', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: null, timeout_seconds: 300 },
  { id: 3, tool_name: 'execute_sql', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: [18, 20], timeout_seconds: 600 },
  { id: 4, tool_name: '*', tool_pattern: 'mcp__*', risk_level: 'medium', requires_approval: true, auto_approve_for_agent_ids: null, timeout_seconds: 120 },
  { id: 5, tool_name: 'get_workspace_info', tool_pattern: null, risk_level: 'safe', requires_approval: false, auto_approve_for_agent_ids: null, timeout_seconds: 300 },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ToolApprovalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Invalidate the rules cache so each test starts fresh
    invalidateRulesCache();
    // Default: dbAll returns the mock rules
    mockDbAll.mockResolvedValue(MOCK_RULES);
  });

  // ─── requiresApproval ──────────────────────────────────────────

  describe('requiresApproval()', () => {
    it('should return true for a tool with requires_approval=true', async () => {
      const result = await requiresApproval('write_file', null);
      expect(result).toBe(true);
    });

    it('should return false for a tool with requires_approval=false', async () => {
      const result = await requiresApproval('get_workspace_info', null);
      expect(result).toBe(false);
    });

    it('should return false for a tool not in any rule (no wildcard)', async () => {
      // Override with rules that don't have a wildcard '*' catch-all
      invalidateRulesCache();
      mockDbAll.mockResolvedValue([
        { id: 1, tool_name: 'write_file', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: null, timeout_seconds: 300 },
        { id: 2, tool_name: 'delete_row', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: null, timeout_seconds: 300 },
      ]);
      const result = await requiresApproval('list_tables', null);
      expect(result).toBe(false);
    });

    it('should match wildcard * rule for unmatched tools', async () => {
      // With the default rules, the '*' catch-all matches any tool
      const result = await requiresApproval('list_tables', null);
      expect(result).toBe(true);
    });

    it('should return true for a glob pattern match (mcp__*)', async () => {
      const result = await requiresApproval('mcp__some_tool', null);
      expect(result).toBe(true);
    });

    it('should return false when agent is in auto_approve_for_agent_ids', async () => {
      // Agent 18 (ORCHESTRATOR) is in auto_approve list for execute_sql
      const result = await requiresApproval('execute_sql', 18);
      expect(result).toBe(false);
    });

    it('should return true when agent is NOT in auto_approve_for_agent_ids', async () => {
      // Agent 21 (FRONTEND) is NOT in auto_approve list for execute_sql
      const result = await requiresApproval('execute_sql', 21);
      expect(result).toBe(true);
    });

    it('should handle auto_approve_for_agent_ids as JSON string (SQLite)', async () => {
      invalidateRulesCache();
      mockDbAll.mockResolvedValue([
        { id: 1, tool_name: 'write_file', tool_pattern: null, risk_level: 'dangerous', requires_approval: true, auto_approve_for_agent_ids: '[19, 20]', timeout_seconds: 300 },
      ]);
      const result = await requiresApproval('write_file', 19);
      expect(result).toBe(false);
    });

    it('should return false (fail-open) when DB query fails', async () => {
      invalidateRulesCache();
      mockDbAll.mockRejectedValue(new Error('DB connection error'));
      const result = await requiresApproval('write_file', null);
      expect(result).toBe(false);
    });
  });

  // ─── getTimeoutForTool ──────────────────────────────────────────

  describe('getTimeoutForTool()', () => {
    it('should return the timeout for a matching tool', async () => {
      const timeout = await getTimeoutForTool('execute_sql');
      expect(timeout).toBe(600);
    });

    it('should return default 300 for non-matching tool', async () => {
      const timeout = await getTimeoutForTool('unknown_tool');
      expect(timeout).toBe(300);
    });

    it('should match glob patterns', async () => {
      const timeout = await getTimeoutForTool('mcp__some_tool');
      expect(timeout).toBe(120);
    });
  });

  // ─── createApprovalRequest ──────────────────────────────────────

  describe('createApprovalRequest()', () => {
    it('should update message with pending approval status', async () => {
      mockDbRun.mockResolvedValue({ changes: 1 });
      mockDbGet.mockResolvedValue({
        id: 42, approval_status: 'pending', content_type: 'tool_call', content: 'write_file',
      });

      const result = await createApprovalRequest(1, 42, 'write_file', { path: '/test' }, 19);

      expect(mockDbRun).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 42, approval_status: 'pending' }));
    });

    it('should throw on DB error', async () => {
      mockDbRun.mockRejectedValue(new Error('DB error'));

      await expect(createApprovalRequest(1, 42, 'write_file', {}, 19))
        .rejects.toThrow('DB error');
    });
  });

  // ─── waitForDecision ──────────────────────────────────────────

  describe('waitForDecision()', () => {
    it('should return "approved" when message gets approved', async () => {
      // First poll: pending, second poll: approved
      mockDbGet
        .mockResolvedValueOnce({ approval_status: 'pending' })
        .mockResolvedValueOnce({ approval_status: 'approved' });

      const result = await waitForDecision(42, 5000);
      expect(result).toBe('approved');
    });

    it('should return "rejected" when message gets rejected', async () => {
      mockDbGet
        .mockResolvedValueOnce({ approval_status: 'pending' })
        .mockResolvedValueOnce({ approval_status: 'rejected' });

      const result = await waitForDecision(42, 5000);
      expect(result).toBe('rejected');
    });

    it('should return "timeout" after timeout period', async () => {
      mockDbGet.mockResolvedValue({ approval_status: 'pending' });
      mockDbRun.mockResolvedValue({ changes: 1 });

      // Use a very short timeout for the test
      const result = await waitForDecision(42, 100);
      expect(result).toBe('timeout');
    });
  });

  // ─── approveToolExecution ──────────────────────────────────────

  describe('approveToolExecution()', () => {
    it('should set approval_status to approved', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42, approval_status: 'pending', content_type: 'tool_call', content: 'write_file', metadata: null })
        .mockResolvedValueOnce({ id: 42, approval_status: 'approved', approved_by: 1 });
      mockDbRun.mockResolvedValue({ changes: 1 });

      const result = await approveToolExecution(42, 1);
      expect(result).toEqual(expect.objectContaining({ approval_status: 'approved' }));
    });

    it('should throw if message is not pending', async () => {
      mockDbGet.mockResolvedValue({ id: 42, approval_status: 'approved' });

      await expect(approveToolExecution(42, 1))
        .rejects.toThrow('not pending');
    });

    it('should throw if message not found', async () => {
      mockDbGet.mockResolvedValue(null);

      await expect(approveToolExecution(42, 1))
        .rejects.toThrow('not found');
    });

    it('should create always-allow rule when alwaysAllow=true', async () => {
      mockDbGet
        .mockResolvedValueOnce({
          id: 42, approval_status: 'pending', content_type: 'tool_call',
          content: 'write_file', metadata: JSON.stringify({ approval_tool: 'write_file' }),
        })
        .mockResolvedValueOnce({ id: 1, tool_name: 'write_file' })  // existing rule check
        .mockResolvedValueOnce({ id: 42, approval_status: 'approved' });  // final fetch
      mockDbRun.mockResolvedValue({ changes: 1 });

      const result = await approveToolExecution(42, 1, true);
      // Should have called dbRun to update the existing rule
      expect(mockDbRun).toHaveBeenCalledTimes(2); // 1 for approve, 1 for rule update
    });
  });

  // ─── rejectToolExecution ──────────────────────────────────────

  describe('rejectToolExecution()', () => {
    it('should set approval_status to rejected', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42, approval_status: 'pending' })
        .mockResolvedValueOnce({ id: 42, approval_status: 'rejected', approved_by: 1 });
      mockDbRun.mockResolvedValue({ changes: 1 });

      const result = await rejectToolExecution(42, 1);
      expect(result).toEqual(expect.objectContaining({ approval_status: 'rejected' }));
    });

    it('should store rejection reason in metadata', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 42, approval_status: 'pending' })
        .mockResolvedValueOnce({ id: 42, approval_status: 'rejected' });
      mockDbRun.mockResolvedValue({ changes: 1 });

      await rejectToolExecution(42, 1, 'Too risky');
      // Verify dbRun was called with reason metadata
      const calls = mockDbRun.mock.calls;
      const hasReasonUpdate = calls.some(call =>
        typeof call[1]?.[0] === 'string' && call[1][0].includes('rejection_reason')
      );
      expect(hasReasonUpdate).toBe(true);
    });

    it('should throw if message not found', async () => {
      mockDbGet.mockResolvedValue(null);
      await expect(rejectToolExecution(42, 1))
        .rejects.toThrow('not found');
    });

    it('should throw if message is not pending', async () => {
      mockDbGet.mockResolvedValue({ id: 42, approval_status: 'approved' });
      await expect(rejectToolExecution(42, 1))
        .rejects.toThrow('not pending');
    });
  });

  // ─── getPendingApprovals ──────────────────────────────────────

  describe('getPendingApprovals()', () => {
    it('should return pending tool_call messages for a conversation', async () => {
      const pending = [
        { id: 42, conversation_id: 1, approval_status: 'pending', content_type: 'tool_call' },
        { id: 43, conversation_id: 1, approval_status: 'pending', content_type: 'tool_call' },
      ];
      mockDbAll.mockResolvedValue(pending);

      const result = await getPendingApprovals(1);
      expect(result).toEqual(pending);
      expect(result).toHaveLength(2);
    });

    it('should return empty array on DB error', async () => {
      mockDbAll.mockRejectedValue(new Error('DB error'));
      const result = await getPendingApprovals(1);
      expect(result).toEqual([]);
    });
  });

  // ─── getApprovalRules ──────────────────────────────────────

  describe('getApprovalRules()', () => {
    it('should return all rules', async () => {
      const result = await getApprovalRules();
      expect(result).toEqual(MOCK_RULES);
      expect(mockDbAll).toHaveBeenCalled();
    });
  });

  // ─── updateApprovalRule ──────────────────────────────────────

  describe('updateApprovalRule()', () => {
    it('should update allowed fields', async () => {
      mockDbGet
        .mockResolvedValueOnce({ id: 1, tool_name: 'write_file', risk_level: 'dangerous', requires_approval: true })
        .mockResolvedValueOnce({ id: 1, tool_name: 'write_file', risk_level: 'medium', requires_approval: false });
      mockDbRun.mockResolvedValue({ changes: 1 });

      const result = await updateApprovalRule(1, { risk_level: 'medium', requires_approval: false });
      expect(result).toEqual(expect.objectContaining({ risk_level: 'medium' }));
    });

    it('should throw if rule not found', async () => {
      mockDbGet.mockResolvedValue(null);
      await expect(updateApprovalRule(999, { risk_level: 'safe' }))
        .rejects.toThrow('not found');
    });

    it('should return unchanged rule if no valid fields provided', async () => {
      const existingRule = { id: 1, tool_name: 'write_file', risk_level: 'dangerous' };
      mockDbGet.mockResolvedValue(existingRule);

      const result = await updateApprovalRule(1, { invalid_field: 'value' });
      expect(result).toEqual(existingRule);
      // dbRun should NOT be called for update
      expect(mockDbRun).not.toHaveBeenCalled();
    });
  });
});
