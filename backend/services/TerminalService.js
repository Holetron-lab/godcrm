/**
 * TerminalService - ADR-076: Terminal Module
 *
 * Manages terminal sessions and command execution with approval flow.
 * Uses child_process.spawn for shell execution (no OpenCode dependency).
 */

import { spawn } from 'node:child_process';
import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { classifyCommand } from './CommandClassifier.js';
import { logger } from '../utils/logger.js';

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB
const COMMAND_TIMEOUT_MS = 5 * 60_000; // 5 minutes

// Clean up orphaned commands from previous server restart
cleanupOrphanedCommands().catch(() => {});

async function cleanupOrphanedCommands() {
  try {
    const result = await dbRun(
      `UPDATE terminal_commands
       SET output = $1, exit_code = $2, completed_at = NOW()
       WHERE completed_at IS NULL AND approval_status != $3`,
      ['[Process killed by server restart]', 137, 'pending']
    );
    const count = result.rowCount ?? result.changes ?? 0;
    if (count > 0) {
      logger.info({ count }, 'Cleaned up orphaned terminal commands');
    }
  } catch {
    // DB might not be ready yet at import time — ignore
  }
}

// ============================================================
// Session Management
// ============================================================

/**
 * Get or create a terminal session for a user.
 * Bug #74147: Excludes agent sessions so quick-execute doesn't reuse an agent tab.
 * @param {number} userId
 * @param {string} [title]
 * @returns {Promise<Object>}
 */
export async function getOrCreateSession(userId, title = 'Terminal') {
  // Bug #74147: exclude agent sessions so we don't reuse them for user commands
  const existing = await dbGet(
    `SELECT * FROM terminal_sessions WHERE user_id = $1 AND status = $2 AND title NOT LIKE 'Agent #%' ORDER BY updated_at DESC LIMIT 1`,
    [userId, 'active']
  );

  if (existing) {
    return existing;
  }

  const result = await dbRun(
    `INSERT INTO terminal_sessions (user_id, title, cwd, status) VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, title, '/root/production/business-crm', 'active']
  );

  return result.rows ? result.rows[0] : await dbGet(
    `SELECT * FROM terminal_sessions WHERE id = $1`,
    [result.lastInsertRowid || result.insertId]
  );
}

/**
 * Create a new terminal session
 * @param {number} userId
 * @param {string} [title]
 * @param {string} [cwd]
 * @returns {Promise<Object>}
 */
export async function createSession(userId, title = 'Terminal', cwd = '/root/production/business-crm') {
  const result = await dbRun(
    `INSERT INTO terminal_sessions (user_id, title, cwd, status) VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, title, cwd, 'active']
  );

  return result.rows ? result.rows[0] : await dbGet(
    `SELECT * FROM terminal_sessions WHERE id = $1`,
    [result.lastInsertRowid || result.insertId]
  );
}

/**
 * List sessions for a user.
 * Bug #74147: By default, excludes agent-created sessions (title LIKE 'Agent #%')
 * so they don't pollute the user's terminal tab bar. Agent sessions remain
 * accessible by explicit session ID (e.g. from chat tool_call links).
 *
 * @param {number} userId
 * @param {{ includeAgent?: boolean }} [options]
 * @returns {Promise<Array>}
 */
export async function listSessions(userId, { includeAgent = false, showAll = false } = {}) {
  const agentFilter = includeAgent ? '' : `AND ts.title NOT LIKE 'Agent #%'`;
  // showAll: owner can see all users' sessions (for monitoring agent terminals)
  const userFilter = showAll ? '' : `AND ts.user_id = $1`;
  return dbAll(
    `SELECT ts.*,
     (SELECT COUNT(*) FROM terminal_commands tc WHERE tc.session_id = ts.id) as command_count
     FROM terminal_sessions ts
     WHERE ts.status = 'active' ${userFilter} ${agentFilter}
     ORDER BY ts.updated_at DESC`,
    showAll ? [] : [userId]
  );
}

/**
 * Get a session by ID with recent commands
 * @param {number} sessionId
 * @param {number} [commandLimit=50]
 * @returns {Promise<Object|null>}
 */
export async function getSession(sessionId, commandLimit = 50) {
  const session = await dbGet(
    `SELECT * FROM terminal_sessions WHERE id = $1`,
    [sessionId]
  );

  if (!session) return null;

  const commands = await dbAll(
    `SELECT * FROM terminal_commands WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, commandLimit]
  );

  return { ...session, commands: commands.reverse() };
}

/**
 * Close a session
 * @param {number} sessionId
 * @returns {Promise<void>}
 */
export async function closeSession(sessionId) {
  await dbRun(
    `UPDATE terminal_sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
    ['closed', sessionId]
  );
}

// ============================================================
// Command Execution
// ============================================================

/**
 * Execute a command in a session (async / fire-and-forget).
 *
 * Returns immediately with the command record.
 * The shell runs in the background; result is written to DB
 * and picked up by the frontend via polling GET /commands.
 *
 * @param {number} sessionId
 * @param {string} command
 * @param {{ source?: string, agentName?: string }} options
 * @returns {Promise<Object>} - { needsApproval, command: dbRecord }
 */
export async function executeCommand(sessionId, command, { source = 'user', agentName = null } = {}) {
  const session = await dbGet(
    `SELECT * FROM terminal_sessions WHERE id = $1`,
    [sessionId]
  );

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const { riskLevel } = classifyCommand(command);

  // Insert command record (output = null → "running" state)
  const insertResult = await dbRun(
    `INSERT INTO terminal_commands (session_id, command, risk_level, approval_status, source, agent_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      sessionId,
      command,
      riskLevel,
      riskLevel === 'dangerous' ? 'pending' : 'auto',
      source,
      agentName,
    ]
  );

  const cmdRecord = insertResult.rows
    ? insertResult.rows[0]
    : await dbGet(`SELECT * FROM terminal_commands ORDER BY id DESC LIMIT 1`);

  // If dangerous, don't execute — return for approval
  if (riskLevel === 'dangerous') {
    logger.warn({ sessionId, command, riskLevel }, 'Command requires approval');
    return { needsApproval: true, command: cmdRecord };
  }

  // Fire-and-forget: run in background, write result to DB when done
  runInBackground(cmdRecord.id, command, session.cwd, sessionId, riskLevel);

  // Return immediately — frontend polls for result
  return { needsApproval: false, command: cmdRecord };
}

/**
 * Run a shell command in the background and persist results to DB.
 * @param {number} cmdId
 * @param {string} command
 * @param {string} cwd
 * @param {number} sessionId
 * @param {string} riskLevel
 */
function runInBackground(cmdId, command, cwd, sessionId, riskLevel) {
  runShellCommand(command, cwd)
    .then(async (result) => {
      await dbRun(
        `UPDATE terminal_commands
         SET output = $1, exit_code = $2, execution_time_ms = $3, completed_at = NOW(), approval_status = $4
         WHERE id = $5`,
        [
          result.output.slice(0, MAX_OUTPUT_BYTES),
          result.exitCode,
          result.executionTimeMs,
          riskLevel === 'medium' ? 'auto_logged' : 'auto',
          cmdId,
        ]
      );

      // Update session cwd if command changed directory
      const cwdMatch = command.match(/^cd\s+(.+)/);
      if (cwdMatch && result.exitCode === 0) {
        const newCwdResult = await runShellCommand(`cd ${cwdMatch[1]} && pwd`, cwd);
        if (newCwdResult.exitCode === 0) {
          const newCwd = newCwdResult.output.trim();
          await dbRun(
            `UPDATE terminal_sessions SET cwd = $1, updated_at = NOW() WHERE id = $2`,
            [newCwd, sessionId]
          );
        }
      }

      await dbRun(
        `UPDATE terminal_sessions SET updated_at = NOW() WHERE id = $1`,
        [sessionId]
      );
    })
    .catch((err) => {
      logger.error({ err: err.message, cmdId }, 'Background command execution failed');
      dbRun(
        `UPDATE terminal_commands SET output = $1, exit_code = $2, completed_at = NOW() WHERE id = $3`,
        [`Error: ${err.message}`, 1, cmdId]
      ).catch(() => {});
    });
}

/**
 * Approve and execute a pending command
 * @param {number} commandId
 * @param {number} approvedByUserId
 * @returns {Promise<Object>}
 */
export async function approveCommand(commandId, approvedByUserId) {
  const cmd = await dbGet(
    `SELECT tc.*, ts.cwd FROM terminal_commands tc
     JOIN terminal_sessions ts ON tc.session_id = ts.id
     WHERE tc.id = $1`,
    [commandId]
  );

  if (!cmd) throw new Error(`Command ${commandId} not found`);
  if (cmd.approval_status !== 'pending') {
    throw new Error(`Command ${commandId} is not pending approval (status: ${cmd.approval_status})`);
  }

  // Mark as approved
  await dbRun(
    `UPDATE terminal_commands SET approval_status = $1, approved_by = $2 WHERE id = $3`,
    ['approved', approvedByUserId, commandId]
  );

  // Fire-and-forget: run in background
  runInBackground(commandId, cmd.command, cmd.cwd, cmd.session_id, 'dangerous');

  return dbGet(`SELECT * FROM terminal_commands WHERE id = $1`, [commandId]);
}

/**
 * Reject a pending command
 * @param {number} commandId
 * @param {number} rejectedByUserId
 * @returns {Promise<Object>}
 */
export async function rejectCommand(commandId, rejectedByUserId) {
  const cmd = await dbGet(
    `SELECT * FROM terminal_commands WHERE id = $1`,
    [commandId]
  );

  if (!cmd) throw new Error(`Command ${commandId} not found`);
  if (cmd.approval_status !== 'pending') {
    throw new Error(`Command ${commandId} is not pending approval`);
  }

  await dbRun(
    `UPDATE terminal_commands SET approval_status = $1, approved_by = $2, completed_at = NOW() WHERE id = $3`,
    ['rejected', rejectedByUserId, commandId]
  );

  return dbGet(`SELECT * FROM terminal_commands WHERE id = $1`, [commandId]);
}

/**
 * Get commands for a session (for polling)
 * @param {number} sessionId
 * @param {{ limit?: number, afterId?: number }} options
 * @returns {Promise<Array>}
 */
export async function getCommands(sessionId, { limit = 50, afterId = 0 } = {}) {
  return dbAll(
    `SELECT * FROM terminal_commands
     WHERE session_id = $1 AND id > $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [sessionId, afterId, limit]
  );
}

/**
 * List currently pending commands (approval_status='pending') across sessions.
 * Used by the AI chat to surface an inline approval bar above the input.
 * @param {{ userId?: number, allUsers?: boolean }} options
 *   - userId: restrict to sessions owned by this user
 *   - allUsers: when true, return pending commands for any session (owner monitoring)
 * @returns {Promise<Array>}
 */
export async function listPendingCommands({ userId = null, allUsers = false } = {}) {
  const userFilter = allUsers ? '' : `AND ts.user_id = $1`;
  return dbAll(
    `SELECT tc.*, ts.title AS session_title, ts.user_id AS session_user_id
     FROM terminal_commands tc
     JOIN terminal_sessions ts ON ts.id = tc.session_id
     WHERE tc.approval_status = 'pending'
       AND ts.status = 'active'
       ${userFilter}
     ORDER BY tc.created_at ASC
     LIMIT 20`,
    allUsers ? [] : [userId]
  );
}

// ============================================================
// Shell Execution (private)
// ============================================================

/**
 * Execute a shell command using child_process.spawn
 * @param {string} command
 * @param {string} cwd
 * @returns {Promise<{ output: string, exitCode: number, executionTimeMs: number }>}
 */
function runShellCommand(command, cwd = '/root/production/business-crm') {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = '';
    let timedOut = false;

    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      timeout: COMMAND_TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, COMMAND_TIMEOUT_MS);

    proc.stdout.on('data', (data) => {
      if (output.length < MAX_OUTPUT_BYTES) {
        output += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      if (output.length < MAX_OUTPUT_BYTES) {
        output += data.toString();
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const executionTimeMs = Date.now() - startTime;

      if (timedOut) {
        output += '\n[TIMEOUT: Command killed after 5m]';
      }

      if (output.length > MAX_OUTPUT_BYTES) {
        output = output.slice(0, MAX_OUTPUT_BYTES) + '\n[OUTPUT TRUNCATED at 100KB]';
      }

      resolve({
        output,
        exitCode: timedOut ? 124 : (code ?? 1),
        executionTimeMs,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        output: `Error: ${err.message}`,
        exitCode: 1,
        executionTimeMs: Date.now() - startTime,
      });
    });
  });
}
