/**
 * QualityGateService Tests — ADR-109 Part C: Quality Gate
 *
 * Tests for automated quality gate checks:
 *   - runQualityGate(): Returns { passed, checks } and handles pass/fail flows
 *   - Auto-advance to control when all checks pass (mock ChainHandoffService)
 *   - Stays in review when checks fail, failure details appended to why field
 *   - storeQualityReport(): Creates row in Quality Reports table (1702)
 *   - runCheck(): Individual check execution
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const { mockDbRun, mockDbGet, mockIsPostgres, mockSafeJsonParse } = vi.hoisted(() => {
  return {
    mockDbRun: vi.fn(),
    mockDbGet: vi.fn(),
    mockIsPostgres: vi.fn(() => false),
    mockSafeJsonParse: vi.fn((str, def) => {
      if (str === null || str === undefined) return def;
      if (typeof str === 'object') return str;
      try { return JSON.parse(str); } catch { return def; }
    }),
  };
});

vi.mock('../../database/connection.js', () => ({
  dbRun: (...args) => mockDbRun(...args),
  dbGet: (...args) => mockDbGet(...args),
  isPostgres: () => mockIsPostgres(),
  safeJsonParse: (...args) => mockSafeJsonParse(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/baseId.js', () => ({
  generateBaseId: vi.fn((prefix) => `${prefix}-test-001`),
}));

// Mock ChainHandoffService
const mockGetTicket = vi.fn();
const mockUpdateTicketStatus = vi.fn();
const mockLogActivity = vi.fn();

vi.mock('../ChainHandoffService.js', () => ({
  default: {
    getTicket: (...args) => mockGetTicket(...args),
    updateTicketStatus: (...args) => mockUpdateTicketStatus(...args),
    logActivity: (...args) => mockLogActivity(...args),
  },
}));

// ─── Import (after all mocks) ───────────────────────────────────────────────

import QualityGateService, { QUALITY_REPORTS_TABLE_ID, ANY_COUNT_THRESHOLD, MAX_LINES_PER_FILE } from '../QualityGateService.js';

// ─── Test Data Helpers ──────────────────────────────────────────────────────

/** Mock shell executor — replaces QualityGateService._execCommand in tests */
const mockExecCommand = vi.fn();

function makeTicket(overrides = {}) {
  return {
    id: 999,
    what: 'Implement feature X',
    why: 'Business need',
    state: 24277, // review
    test_file: null,
    _chain: { chain_id: 'chain-test-abc', step: 1 },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('QualityGateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Inject mock shell executor
    QualityGateService._execCommand = mockExecCommand;
    // Default: dbRun returns a mock insert result
    mockDbRun.mockResolvedValue({ lastInsertRowid: 42 });
    // Default: logActivity succeeds
    mockLogActivity.mockResolvedValue(undefined);
    // Default: updateTicketStatus succeeds
    mockUpdateTicketStatus.mockResolvedValue({
      ticket_id: 999,
      old_state: 24277,
      new_state: 43437,
    });
  });

  // ─── runQualityGate ─────────────────────────────────────────────────────

  describe('runQualityGate()', () => {
    test('returns { passed: true, checks: [...] } when all checks pass', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      // All shell commands succeed:
      // Promise.all runs: tests (skipped, no testFile), typecheck, any_count, max_lines
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })     // typecheck (tsc --noEmit)
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' })  // any_count (grep | wc -l)
        .mockResolvedValueOnce({ stdout: '', stderr: '' });    // max_lines (no violations)

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(true);
      expect(result.ticket_id).toBe(999);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every(c => c.passed)).toBe(true);

      // Verify check names
      const checkNames = result.checks.map(c => c.name);
      expect(checkNames).toContain('tests');
      expect(checkNames).toContain('typecheck');
      expect(checkNames).toContain('any_count');
      expect(checkNames).toContain('max_lines');
    });

    test('returns { passed: false } when typecheck fails', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      // typecheck fails (non-zero exit)
      const typecheckError = new Error('tsc failed');
      typecheckError.stdout = 'src/index.ts(5,3): error TS2322: ...';
      typecheckError.stderr = '';
      mockExecCommand
        .mockRejectedValueOnce(typecheckError)                  // typecheck fails
        .mockResolvedValueOnce({ stdout: '3\n', stderr: '' })   // any_count ok
        .mockResolvedValueOnce({ stdout: '', stderr: '' });     // max_lines ok

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(false);
      expect(result.ticket_id).toBe(999);

      const typecheckResult = result.checks.find(c => c.name === 'typecheck');
      expect(typecheckResult.passed).toBe(false);
      expect(typecheckResult.details).toContain('TypeScript errors found');
    });

    test('returns { passed: false } when any_count exceeds threshold', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      // typecheck passes, any_count exceeds threshold
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })      // typecheck ok
        .mockResolvedValueOnce({ stdout: '25\n', stderr: '' })  // any_count: 25 > 20
        .mockResolvedValueOnce({ stdout: '', stderr: '' });     // max_lines ok

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(false);

      const anyResult = result.checks.find(c => c.name === 'any_count');
      expect(anyResult.passed).toBe(false);
      expect(anyResult.details).toContain('exceeds threshold');
    });

    test('auto-advances ticket to control when ALL checks pass', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      // All commands succeed
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })      // typecheck
        .mockResolvedValueOnce({ stdout: '10\n', stderr: '' })  // any_count
        .mockResolvedValueOnce({ stdout: '', stderr: '' });     // max_lines

      const result = await QualityGateService.runQualityGate(999, { agent_id: 19 });

      expect(result.auto_advanced).toBe(true);
      expect(result.passed).toBe(true);

      // Verify ChainHandoffService.updateTicketStatus was called with review -> control
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith({
        ticket_id: 999,
        new_state: 43437, // STATE.CONTROL
        agent_id: 19,
        notes: expect.stringContaining('auto-advanced to control'),
      });
    });

    test('stays in review when checks fail — does NOT call updateTicketStatus', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      // typecheck fails
      const typecheckError = new Error('tsc failed');
      typecheckError.stdout = 'errors found';
      mockExecCommand
        .mockRejectedValueOnce(typecheckError)                  // typecheck fails
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' })   // any_count ok
        .mockResolvedValueOnce({ stdout: '', stderr: '' });     // max_lines ok

      // Mock dbGet for appendToTicketWhy
      mockDbGet.mockResolvedValue({
        data: JSON.stringify({ why: 'original reason', state: 24277 }),
      });

      const result = await QualityGateService.runQualityGate(999);

      expect(result.auto_advanced).toBe(false);
      expect(result.passed).toBe(false);

      // updateTicketStatus should NOT have been called
      expect(mockUpdateTicketStatus).not.toHaveBeenCalled();

      // dbRun should have been called to update the why field (appendToTicketWhy)
      // The first call is storeQualityReport INSERT, the second is the UPDATE
      const updateCalls = mockDbRun.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('UPDATE')
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    test('returns error info when ticket not found', async () => {
      mockGetTicket.mockResolvedValue(null);

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(false);
      expect(result.checks).toHaveLength(0);
      expect(result.error).toBe('Ticket not found');
    });

    test('skips tests check when no test_file in ticket metadata', async () => {
      mockGetTicket.mockResolvedValue(makeTicket({ test_file: null }));

      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })     // typecheck
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' })  // any_count
        .mockResolvedValueOnce({ stdout: '', stderr: '' });    // max_lines

      const result = await QualityGateService.runQualityGate(999);

      const testCheck = result.checks.find(c => c.name === 'tests');
      expect(testCheck.passed).toBe(true);
      expect(testCheck.details).toContain('skipped');
    });

    test('runs specific test file when test_file is set', async () => {
      mockGetTicket.mockResolvedValue(makeTicket({ test_file: 'src/foo.test.ts' }));

      // tests pass, typecheck passes, any_count passes, max_lines passes
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'Tests: 3 passed', stderr: '' }) // tests (vitest run)
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                // typecheck
        .mockResolvedValueOnce({ stdout: '2\n', stderr: '' })             // any_count
        .mockResolvedValueOnce({ stdout: '', stderr: '' });               // max_lines

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(true);
      const testCheck = result.checks.find(c => c.name === 'tests');
      expect(testCheck.passed).toBe(true);
      expect(testCheck.details).toContain('Tests passed');
    });

    test('returns { passed: false } when max_lines check finds oversized files', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());

      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })      // typecheck ok
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' })   // any_count ok
        .mockResolvedValueOnce({ stdout: '2833 src/features/widgets/components/presets/KanbanWidget.tsx\n', stderr: '' }); // max_lines: violation

      const result = await QualityGateService.runQualityGate(999);

      expect(result.passed).toBe(false);

      const maxLinesResult = result.checks.find(c => c.name === 'max_lines');
      expect(maxLinesResult.passed).toBe(false);
      expect(maxLinesResult.details).toContain('KanbanWidget.tsx');
      expect(maxLinesResult.details).toContain('2833');
    });

    test('logs activity via ChainHandoffService.logActivity', async () => {
      mockGetTicket.mockResolvedValue(makeTicket());
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '5\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });     // max_lines

      await QualityGateService.runQualityGate(999, { agent_id: 19, chain_id: 'chain-xyz' });

      expect(mockLogActivity).toHaveBeenCalledWith({
        action: 'quality_gate_completed',
        agent_id: 19,
        ticket_id: 999,
        chain_id: 'chain-xyz',
        details: expect.objectContaining({
          passed: true,
          checks: expect.arrayContaining([
            expect.objectContaining({ name: 'tests', passed: true }),
          ]),
        }),
      });
    });
  });

  // ─── runCheck ───────────────────────────────────────────────────────────

  describe('runCheck()', () => {
    test('returns { passed: true } for typecheck when tsc succeeds', async () => {
      mockExecCommand.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await QualityGateService.runCheck('typecheck');

      expect(result.name).toBe('typecheck');
      expect(result.passed).toBe(true);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    test('returns { passed: false } for typecheck when tsc fails', async () => {
      const tscErr = new Error('exit code 1');
      tscErr.stdout = 'Type errors';
      mockExecCommand.mockRejectedValueOnce(tscErr);

      const result = await QualityGateService.runCheck('typecheck');

      expect(result.name).toBe('typecheck');
      expect(result.passed).toBe(false);
    });

    test('returns { passed: true } for any_count when count <= threshold', async () => {
      mockExecCommand.mockResolvedValueOnce({ stdout: '15\n', stderr: '' });

      const result = await QualityGateService.runCheck('any_count');

      expect(result.name).toBe('any_count');
      expect(result.passed).toBe(true);
      expect(result.details).toContain('15');
    });

    test('returns { passed: false } for any_count when count > threshold', async () => {
      mockExecCommand.mockResolvedValueOnce({ stdout: '30\n', stderr: '' });

      const result = await QualityGateService.runCheck('any_count');

      expect(result.name).toBe('any_count');
      expect(result.passed).toBe(false);
      expect(result.details).toContain('exceeds threshold');
    });

    test('returns { passed: true } for max_lines when no files exceed threshold', async () => {
      mockExecCommand.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await QualityGateService.runCheck('max_lines');

      expect(result.name).toBe('max_lines');
      expect(result.passed).toBe(true);
      expect(result.details).toContain(`${MAX_LINES_PER_FILE}`);
    });

    test('returns { passed: false } for max_lines when files exceed threshold', async () => {
      mockExecCommand.mockResolvedValueOnce({
        stdout: '2833 src/features/widgets/components/presets/KanbanWidget.tsx\n1200 src/pages/help/HelpPage.tsx\n',
        stderr: '',
      });

      const result = await QualityGateService.runCheck('max_lines');

      expect(result.name).toBe('max_lines');
      expect(result.passed).toBe(false);
      expect(result.details).toContain('2 file(s) exceed');
      expect(result.details).toContain('KanbanWidget.tsx');
      expect(result.details).toContain('HelpPage.tsx');
      expect(result.violations).toHaveLength(2);
    });

    test('returns { passed: false } for unknown check names', async () => {
      const result = await QualityGateService.runCheck('nonexistent');

      expect(result.name).toBe('nonexistent');
      expect(result.passed).toBe(false);
      expect(result.details).toContain('Unknown check');
    });

    test('returns { passed: true } for tests when no test file provided', async () => {
      const result = await QualityGateService.runCheck('tests', {});

      expect(result.name).toBe('tests');
      expect(result.passed).toBe(true);
      expect(result.details).toContain('skipped');
    });

    test('returns { passed: false } for tests when test file fails', async () => {
      const testErr = new Error('vitest fail');
      testErr.stdout = 'FAIL src/foo.test.ts';
      mockExecCommand.mockRejectedValueOnce(testErr);

      const result = await QualityGateService.runCheck('tests', { testFile: 'src/foo.test.ts' });

      expect(result.name).toBe('tests');
      expect(result.passed).toBe(false);
      expect(result.details).toContain('Tests failed');
    });
  });

  // ─── storeQualityReport ─────────────────────────────────────────────────

  describe('storeQualityReport()', () => {
    test('creates a row in the Quality Reports table (1702)', async () => {
      mockDbRun.mockResolvedValue({ lastInsertRowid: 77 });

      const checks = [
        { name: 'tests', passed: true, details: 'ok', duration_ms: 100 },
        { name: 'typecheck', passed: true, details: 'ok', duration_ms: 200 },
        { name: 'any_count', passed: true, details: 'ok', duration_ms: 50 },
      ];

      const result = await QualityGateService.storeQualityReport(999, checks);

      expect(result.report_id).toBe(77);

      // Verify INSERT was called with correct table ID
      expect(mockDbRun).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbRun.mock.calls[0];
      expect(sql).toContain('INSERT INTO table_rows');
      expect(params[0]).toBe(1702); // QUALITY_REPORTS_TABLE_ID

      // Verify the data payload
      const dataPayload = JSON.parse(params[2]);
      expect(dataPayload.ticket_id).toBe(999);
      expect(dataPayload.passed).toBe(true);
      expect(dataPayload.total_checks).toBe(3);
      expect(dataPayload.passed_checks).toBe(3);
      expect(dataPayload.failed_checks).toBe(0);
      expect(dataPayload.checks).toHaveLength(3);
    });

    test('stores report with failed checks correctly', async () => {
      mockDbRun.mockResolvedValue({ lastInsertRowid: 78 });

      const checks = [
        { name: 'tests', passed: true, details: 'ok', duration_ms: 100 },
        { name: 'typecheck', passed: false, details: 'errors', duration_ms: 200 },
        { name: 'any_count', passed: false, details: 'too many', duration_ms: 50 },
      ];

      const result = await QualityGateService.storeQualityReport(999, checks);

      expect(result.report_id).toBe(78);

      const [, params] = mockDbRun.mock.calls[0];
      const dataPayload = JSON.parse(params[2]);
      expect(dataPayload.passed).toBe(false);
      expect(dataPayload.passed_checks).toBe(1);
      expect(dataPayload.failed_checks).toBe(2);
    });

    test('returns { report_id: null } on database error', async () => {
      mockDbRun.mockRejectedValue(new Error('DB connection failed'));

      const result = await QualityGateService.storeQualityReport(999, []);

      expect(result.report_id).toBeNull();
    });

    test('uses PostgreSQL syntax when isPostgres() returns true', async () => {
      mockIsPostgres.mockReturnValue(true);
      mockDbRun.mockResolvedValue({ rows: [{ id: 88 }] });

      const checks = [
        { name: 'tests', passed: true, details: 'ok', duration_ms: 100 },
      ];

      const result = await QualityGateService.storeQualityReport(999, checks);

      expect(result.report_id).toBe(88);

      const [sql] = mockDbRun.mock.calls[0];
      expect(sql).toContain('$1');
      expect(sql).toContain('::jsonb');
      expect(sql).toContain('NOW()');
      expect(sql).toContain('RETURNING id');
    });
  });

  // ─── Exports ────────────────────────────────────────────────────────────

  describe('exports', () => {
    test('QUALITY_REPORTS_TABLE_ID is 1702', () => {
      expect(QUALITY_REPORTS_TABLE_ID).toBe(1702);
    });

    test('ANY_COUNT_THRESHOLD is 20', () => {
      expect(ANY_COUNT_THRESHOLD).toBe(20);
    });

    test('MAX_LINES_PER_FILE is 800', () => {
      expect(MAX_LINES_PER_FILE).toBe(800);
    });
  });
});
