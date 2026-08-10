/**
 * QualityGateService - ADR-109 Part C: Automated Quality Gate
 *
 * Runs quality checks when a ticket transitions from in_progress to review.
 * If all checks pass, auto-advances the ticket from review to control.
 * On failure, keeps the ticket in review and records failure details.
 *
 * Quality Checks:
 *   1. tests     - Run test files referenced in ticket metadata
 *   2. typecheck - Run `npx tsc --noEmit` and check exit code
 *   3. any_count - Count `: any` usages; threshold <= 20
 *   4. max_lines - Ensure no .ts/.tsx file exceeds 800 lines (ADR-035 / .eslintrc.cjs)
 *
 * Tables:
 *   - Quality Reports table (1702): Stores quality gate results
 *   - Tickets table (1708): Reads ticket metadata
 *   - Agent Activity table (1701): Audit logging via ChainHandoffService
 */

import { dbRun, dbGet, isPostgres, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { generateBaseId } from '../utils/baseId.js';
import ChainHandoffService from './ChainHandoffService.js';

// ===== CONSTANTS =====

const QUALITY_REPORTS_TABLE_ID = 1702;
const TICKETS_TABLE_ID = 1708;

/** Maximum allowed `: any` occurrences across src/ and backend/ */
const ANY_COUNT_THRESHOLD = 20;

/** Maximum allowed lines per file (matches .eslintrc.cjs max-lines rule) */
const MAX_LINES_PER_FILE = 800;

/** Timeout for child process commands (ms) */
const COMMAND_TIMEOUT_MS = 120_000; // 2 minutes

/** State IDs matching ChainHandoffService.STATE */
const STATE = {
  REVIEW: 24277,
  CONTROL: 43437,
};

// ===== SHELL EXECUTION =====

/**
 * Default shell executor using child_process.exec.
 * Can be replaced via QualityGateService._execCommand for testing.
 *
 * @param {string} command - Shell command to execute
 * @param {Object} [options] - Options for child_process.exec
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function defaultExecCommand(command, options = {}) {
  const cp = await import('child_process');
  const util = await import('util');
  const execPromise = util.promisify(cp.exec);
  return execPromise(command, options);
}

// ===== QUALITY CHECKS =====

/**
 * Run a specific quality check by name.
 *
 * @param {string} checkName - One of 'tests', 'typecheck', 'any_count'
 * @param {Object} [options] - Additional options
 * @param {string} [options.testFile] - Specific test file to run (for 'tests' check)
 * @param {string} [options.cwd] - Working directory for commands
 * @param {Function} [options.execFn] - Shell executor function (for testing)
 * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number}>}
 */
async function runCheck(checkName, options = {}) {
  const start = Date.now();
  const cwd = options.cwd || process.cwd();
  const execFn = options.execFn || QualityGateService._execCommand;

  try {
    switch (checkName) {
      case 'tests':
        return await runTestsCheck(options.testFile, cwd, start, execFn);

      case 'typecheck':
        return await runTypecheckCheck(cwd, start, execFn);

      case 'any_count':
        return await runAnyCountCheck(cwd, start, execFn);

      case 'max_lines':
        return await runMaxLinesCheck(cwd, start, execFn);

      default:
        return {
          name: checkName,
          passed: false,
          details: `Unknown check: ${checkName}`,
          duration_ms: Date.now() - start,
        };
    }
  } catch (err) {
    return {
      name: checkName,
      passed: false,
      details: `Check threw error: ${err.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Run test files referenced in ticket metadata.
 *
 * @param {string|null} testFile - Specific test file path
 * @param {string} cwd - Working directory
 * @param {number} start - Start timestamp
 * @param {Function} execFn - Shell executor
 * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number}>}
 */
async function runTestsCheck(testFile, cwd, start, execFn) {
  if (!testFile) {
    return {
      name: 'tests',
      passed: true,
      details: 'No test files referenced in ticket metadata; skipped',
      duration_ms: Date.now() - start,
    };
  }

  try {
    const { stdout } = await execFn(
      `npx vitest run ${testFile} --reporter=verbose 2>&1`,
      { cwd, timeout: COMMAND_TIMEOUT_MS }
    );
    return {
      name: 'tests',
      passed: true,
      details: `Tests passed. Output: ${(stdout || '').substring(0, 500)}`,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const output = err.stdout || err.stderr || err.message;
    return {
      name: 'tests',
      passed: false,
      details: `Tests failed. Output: ${String(output).substring(0, 500)}`,
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Run TypeScript type checking via tsc --noEmit.
 *
 * @param {string} cwd - Working directory
 * @param {number} start - Start timestamp
 * @param {Function} execFn - Shell executor
 * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number}>}
 */
async function runTypecheckCheck(cwd, start, execFn) {
  try {
    const { stdout } = await execFn(
      'npx tsc --noEmit 2>&1',
      { cwd, timeout: COMMAND_TIMEOUT_MS }
    );
    return {
      name: 'typecheck',
      passed: true,
      details: `TypeScript check passed. ${(stdout || '').substring(0, 300)}`,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const output = err.stdout || err.stderr || err.message;
    return {
      name: 'typecheck',
      passed: false,
      details: `TypeScript errors found. Output: ${String(output).substring(0, 500)}`,
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Count `: any` usages in src/ and backend/ TypeScript files.
 * Passes if count <= ANY_COUNT_THRESHOLD (20).
 *
 * @param {string} cwd - Working directory
 * @param {number} start - Start timestamp
 * @param {Function} execFn - Shell executor
 * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number, count?: number}>}
 */
async function runAnyCountCheck(cwd, start, execFn) {
  try {
    // grep returns exit code 1 when no matches found, which is actually a pass
    let count = 0;
    try {
      const { stdout } = await execFn(
        'grep -rn ": any" src/ backend/ --include="*.ts" --include="*.tsx" | wc -l',
        { cwd, timeout: COMMAND_TIMEOUT_MS }
      );
      count = parseInt(String(stdout).trim(), 10) || 0;
    } catch (grepErr) {
      // grep exit code 1 = no matches, which means count=0
      if (grepErr.code === 1) {
        count = 0;
      } else {
        throw grepErr;
      }
    }

    const passed = count <= ANY_COUNT_THRESHOLD;
    return {
      name: 'any_count',
      passed,
      details: passed
        ? `Found ${count} ": any" usages (threshold: ${ANY_COUNT_THRESHOLD}). OK.`
        : `Found ${count} ": any" usages, exceeds threshold of ${ANY_COUNT_THRESHOLD}.`,
      duration_ms: Date.now() - start,
      count,
    };
  } catch (err) {
    return {
      name: 'any_count',
      passed: false,
      details: `any_count check failed: ${err.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * Check that no TypeScript/TSX file in src/ or backend/ exceeds MAX_LINES_PER_FILE.
 * Uses `wc -l` + `awk` to find oversized files.
 *
 * @param {string} cwd - Working directory
 * @param {number} start - Start timestamp
 * @param {Function} execFn - Shell executor
 * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number, violations?: Array}>}
 */
async function runMaxLinesCheck(cwd, start, execFn) {
  try {
    // Find all .ts/.tsx files and count lines, filter those exceeding threshold
    // Output format: "  1234 src/path/to/File.tsx" per line
    const { stdout } = await execFn(
      `find src/ backend/ -type f \\( -name "*.ts" -o -name "*.tsx" \\) ! -path "*/node_modules/*" ! -path "*/dist/*" -exec wc -l {} + | awk '$1 > ${MAX_LINES_PER_FILE} && !/total$/ {print $1, $2}' | sort -rn`,
      { cwd, timeout: COMMAND_TIMEOUT_MS }
    );

    const lines = (stdout || '').trim().split('\n').filter(Boolean);
    const violations = lines.map(line => {
      const [count, file] = line.trim().split(/\s+/, 2);
      return { file, lines: parseInt(count, 10) };
    }).filter(v => v.file && v.lines > MAX_LINES_PER_FILE);

    const passed = violations.length === 0;
    const details = passed
      ? `All files under ${MAX_LINES_PER_FILE} lines. OK.`
      : `${violations.length} file(s) exceed ${MAX_LINES_PER_FILE} lines: ${violations.map(v => `${v.file} (${v.lines})`).join(', ')}`;

    return {
      name: 'max_lines',
      passed,
      details,
      duration_ms: Date.now() - start,
      violations,
    };
  } catch (err) {
    return {
      name: 'max_lines',
      passed: false,
      details: `max_lines check failed: ${err.message}`,
      duration_ms: Date.now() - start,
    };
  }
}

// ===== CORE SERVICE =====

const QualityGateService = {

  /**
   * Shell executor function. Override in tests with a mock.
   * @type {Function}
   */
  _execCommand: defaultExecCommand,

  /**
   * Run the full quality gate for a ticket.
   * Executes all quality checks, stores the report, and either
   * auto-advances to control or keeps the ticket in review.
   *
   * @param {number} ticketId - The ticket row ID
   * @param {Object} [chainMetadata={}] - Chain metadata for audit trail
   * @returns {Promise<{passed: boolean, checks: Array, ticket_id: number, auto_advanced: boolean}>}
   */
  async runQualityGate(ticketId, chainMetadata = {}) {
    apiLogger.info({ ticketId }, 'QualityGate: Starting quality gate checks');

    // Fetch ticket to extract test file references from metadata
    const ticket = await ChainHandoffService.getTicket(ticketId);
    if (!ticket) {
      apiLogger.warn({ ticketId }, 'QualityGate: Ticket not found');
      return {
        passed: false,
        checks: [],
        ticket_id: ticketId,
        auto_advanced: false,
        error: 'Ticket not found',
      };
    }

    // Extract test file reference from ticket metadata if available
    const testFile = ticket.test_file || ticket.acceptance_criteria_test || null;

    // Run all checks
    const checks = await Promise.all([
      runCheck('tests', { testFile }),
      runCheck('typecheck'),
      runCheck('any_count'),
      runCheck('max_lines'),
    ]);

    const allPassed = checks.every(c => c.passed);

    // Store quality report in database
    await this.storeQualityReport(ticketId, checks);

    // Log activity
    try {
      await ChainHandoffService.logActivity({
        action: 'quality_gate_completed',
        agent_id: chainMetadata.agent_id || null,
        ticket_id: ticketId,
        chain_id: chainMetadata.chain_id || ticket._chain?.chain_id || null,
        details: {
          passed: allPassed,
          checks: checks.map(c => ({ name: c.name, passed: c.passed })),
        },
      });
    } catch (err) {
      apiLogger.warn({ err, ticketId }, 'QualityGate: Failed to log activity');
    }

    let autoAdvanced = false;

    if (allPassed) {
      // Auto-advance: review -> control
      try {
        await ChainHandoffService.updateTicketStatus({
          ticket_id: ticketId,
          new_state: STATE.CONTROL,
          agent_id: chainMetadata.agent_id || 0,
          notes: 'Quality gate passed — auto-advanced to control',
        });
        autoAdvanced = true;
        apiLogger.info({ ticketId }, 'QualityGate: All checks passed, auto-advanced to control');
      } catch (err) {
        apiLogger.error({ err, ticketId }, 'QualityGate: Failed to auto-advance ticket');
      }
    } else {
      // Keep in review, add failure details to why field
      const failedChecks = checks.filter(c => !c.passed);
      const failureReport = failedChecks
        .map(c => `- ${c.name}: ${c.details}`)
        .join('\n');

      try {
        await this.appendToTicketWhy(
          ticketId,
          `[QualityGate FAILED @ ${new Date().toISOString()}]\n${failureReport}`
        );
        apiLogger.info({ ticketId, failedCount: failedChecks.length },
          'QualityGate: Checks failed, ticket stays in review');
      } catch (err) {
        apiLogger.error({ err, ticketId }, 'QualityGate: Failed to update ticket why field');
      }
    }

    return {
      passed: allPassed,
      checks,
      ticket_id: ticketId,
      auto_advanced: autoAdvanced,
    };
  },

  /**
   * Run a single quality check by name.
   * Thin wrapper around the module-level runCheck function.
   *
   * @param {string} checkName - Check name ('tests', 'typecheck', 'any_count')
   * @param {Object} [options] - Options passed to the check
   * @returns {Promise<{name: string, passed: boolean, details: string, duration_ms: number}>}
   */
  async runCheck(checkName, options = {}) {
    return runCheck(checkName, options);
  },

  /**
   * Store a quality report in the Quality Reports table (1702).
   * Uses the same INSERT pattern as ChainHandoffService.logActivity.
   *
   * @param {number} ticketId - Ticket row ID
   * @param {Array<{name: string, passed: boolean, details: string, duration_ms: number}>} checks - Check results
   * @returns {Promise<{report_id: number|null}>}
   */
  async storeQualityReport(ticketId, checks) {
    try {
      const allPassed = checks.every(c => c.passed);
      const reportData = {
        ticket_id: ticketId,
        passed: allPassed,
        checks,
        total_checks: checks.length,
        passed_checks: checks.filter(c => c.passed).length,
        failed_checks: checks.filter(c => !c.passed).length,
        created_at: new Date().toISOString(),
      };

      const baseId = generateBaseId('qr');
      const dataJson = JSON.stringify(reportData);

      let result;
      if (isPostgres()) {
        result = await dbRun(
          `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW(), NOW())
           RETURNING id`,
          [QUALITY_REPORTS_TABLE_ID, baseId, dataJson]
        );
      } else {
        result = await dbRun(
          `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
          [QUALITY_REPORTS_TABLE_ID, baseId, dataJson]
        );
      }

      const reportId = result?.lastInsertRowid || result?.rows?.[0]?.id || null;

      apiLogger.info({ ticketId, reportId, passed: allPassed },
        'QualityGate: Quality report stored');

      return { report_id: reportId };
    } catch (err) {
      apiLogger.error({ err, ticketId }, 'QualityGate: Failed to store quality report');
      return { report_id: null };
    }
  },

  /**
   * Append quality gate failure details to a ticket's `why` field.
   * Preserves existing content.
   *
   * @param {number} ticketId - Ticket row ID
   * @param {string} message - Message to append
   * @returns {Promise<void>}
   */
  async appendToTicketWhy(ticketId, message) {
    const row = await dbGet(
      isPostgres()
        ? `SELECT data FROM table_rows WHERE id = $1 AND table_id = $2`
        : `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [ticketId, TICKETS_TABLE_ID]
    );

    if (!row) return;

    const data = safeJsonParse(row.data, {});
    data.why = data.why
      ? `${data.why}\n\n${message}`
      : message;

    await dbRun(
      isPostgres()
        ? `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`
        : `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(data), ticketId]
    );
  },
};

export default QualityGateService;
export { QualityGateService, QUALITY_REPORTS_TABLE_ID, ANY_COUNT_THRESHOLD, MAX_LINES_PER_FILE, STATE };
