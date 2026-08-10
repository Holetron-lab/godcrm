/**
 * API v3: Terminal Routes (ADR-076)
 * Owner-only endpoints for terminal sessions with command approval system.
 *
 * Flow:
 *   User/Agent → POST /terminal/sessions/:id/execute
 *     → CommandClassifier (safe/medium/dangerous)
 *       → safe: execute immediately
 *       → medium: execute + log
 *       → dangerous: return needsApproval → frontend shows dialog
 *         → POST /terminal/commands/:id/approve → execute
 *         → POST /terminal/commands/:id/reject → skip
 *
 * @module routes/v3/terminal
 */

import express from 'express';
import { logger } from '../../utils/logger.js';
import {
  success,
  created,
  forbidden,
  badRequest,
  notFound,
  serverError
} from '../../utils/response.js';
import {
  createSession,
  getOrCreateSession,
  listSessions,
  getSession,
  closeSession,
  executeCommand,
  approveCommand,
  rejectCommand,
  getCommands,
  listPendingCommands,
} from '../../services/TerminalService.js';

const router = express.Router();

// ============================================================
// Middleware: Owner-only access
// ============================================================

const ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    logger.warn({
      userId: req.user?.id,
      role: req.user?.role,
      path: req.path
    }, 'Terminal access denied: not owner');
    return forbidden(res, 'Terminal access is owner-only');
  }
  next();
};

router.use(ownerOnly);

// ============================================================
// Session CRUD
// ============================================================

/**
 * GET /api/v3/terminal/sessions
 * List all sessions for the current user
 */
router.get('/sessions', async (req, res) => {
  try {
    // Owner can see all sessions (own + agent/other-user) for monitoring
    const isOwner = req.user.role === 'owner';
    const sessions = await listSessions(req.user.id, { showAll: isOwner, includeAgent: isOwner });
    return success(res, sessions);
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to list terminal sessions');
    return serverError(res, err.message);
  }
});

/**
 * POST /api/v3/terminal/sessions
 * Create a new terminal session
 * @body {string} [title] - Session title
 * @body {string} [cwd] - Working directory
 */
router.post('/sessions', async (req, res) => {
  try {
    const { title, cwd } = req.body;
    const session = await createSession(req.user.id, title, cwd);
    return created(res, session);
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to create terminal session');
    return serverError(res, err.message);
  }
});

/**
 * GET /api/v3/terminal/sessions/:id
 * Get session with recent commands
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await getSession(parseInt(req.params.id));
    if (!session) {
      return notFound(res, 'Session');
    }
    // Bug #74147: Verify session ownership so users can't access other users' sessions
    // Owner can access any session (for monitoring agent/user terminals)
    if (session.user_id !== req.user.id && req.user.role !== 'owner') {
      return forbidden(res, 'Session belongs to another user');
    }
    return success(res, session);
  } catch (err) {
    logger.error({ error: err.message, sessionId: req.params.id }, 'Failed to get session');
    return serverError(res, err.message);
  }
});

/**
 * DELETE /api/v3/terminal/sessions/:id
 * Close a session
 */
router.delete('/sessions/:id', async (req, res) => {
  try {
    await closeSession(parseInt(req.params.id));
    return success(res, { closed: true });
  } catch (err) {
    logger.error({ error: err.message, sessionId: req.params.id }, 'Failed to close session');
    return serverError(res, err.message);
  }
});

// ============================================================
// Command Execution
// ============================================================

/**
 * POST /api/v3/terminal/sessions/:id/execute
 * Execute a command in the session (or request approval if dangerous)
 *
 * @body {string} command - Shell command to run
 * @body {string} [source=user] - "user" or "agent"
 * @body {string} [agentName] - Agent name if source=agent
 */
router.post('/sessions/:id/execute', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { command, source, agentName } = req.body;

    if (!command || typeof command !== 'string') {
      return badRequest(res, 'command is required');
    }

    const result = await executeCommand(sessionId, command.trim(), {
      source: source || 'user',
      agentName: agentName || null,
    });

    if (result.needsApproval) {
      return success(res, {
        needsApproval: true,
        commandId: result.command.id,
        command: result.command.command,
        riskLevel: result.command.risk_level,
        message: 'Command requires approval before execution',
      });
    }

    return success(res, {
      needsApproval: false,
      command: result.command,
    });
  } catch (err) {
    logger.error({ error: err.message, sessionId: req.params.id }, 'Failed to execute command');
    return serverError(res, err.message);
  }
});

/**
 * GET /api/v3/terminal/sessions/:id/commands
 * Poll for commands (supports ?after=cmdId for incremental fetch)
 */
router.get('/sessions/:id/commands', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const afterId = parseInt(req.query.after) || 0;
    const limit = parseInt(req.query.limit) || 50;

    const commands = await getCommands(sessionId, { limit, afterId });
    return success(res, commands);
  } catch (err) {
    logger.error({ error: err.message, sessionId: req.params.id }, 'Failed to get commands');
    return serverError(res, err.message);
  }
});

// ============================================================
// Command Approval
// ============================================================

/**
 * GET /api/v3/terminal/commands/pending
 * List pending commands across the user's active sessions (owner monitors all).
 * Powers the inline approval bar above the AI chat input.
 */
router.get('/commands/pending', async (req, res) => {
  try {
    const isOwner = req.user?.role === 'owner';
    const pending = await listPendingCommands({
      userId: req.user.id,
      allUsers: isOwner,
    });
    return success(res, pending);
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to list pending commands');
    return serverError(res, err.message);
  }
});

/**
 * POST /api/v3/terminal/commands/:id/approve
 * Approve and execute a dangerous command
 */
router.post('/commands/:id/approve', async (req, res) => {
  try {
    const commandId = parseInt(req.params.id);
    const result = await approveCommand(commandId, req.user.id);
    return success(res, result);
  } catch (err) {
    logger.error({ error: err.message, commandId: req.params.id }, 'Failed to approve command');
    if (err.message.includes('not found') || err.message.includes('not pending')) {
      return badRequest(res, err.message);
    }
    return serverError(res, err.message);
  }
});

/**
 * POST /api/v3/terminal/commands/:id/reject
 * Reject a dangerous command
 */
router.post('/commands/:id/reject', async (req, res) => {
  try {
    const commandId = parseInt(req.params.id);
    const result = await rejectCommand(commandId, req.user.id);
    return success(res, result);
  } catch (err) {
    logger.error({ error: err.message, commandId: req.params.id }, 'Failed to reject command');
    if (err.message.includes('not found') || err.message.includes('not pending')) {
      return badRequest(res, err.message);
    }
    return serverError(res, err.message);
  }
});

// ============================================================
// Quick session (auto-create + execute)
// ============================================================

/**
 * POST /api/v3/terminal/execute
 * Quick execute: auto-creates session if needed, then runs command
 * Convenience endpoint for simple use cases
 */
router.post('/execute', async (req, res) => {
  try {
    const { command, source, agentName } = req.body;

    if (!command || typeof command !== 'string') {
      return badRequest(res, 'command is required');
    }

    const session = await getOrCreateSession(req.user.id);
    const result = await executeCommand(session.id, command.trim(), {
      source: source || 'user',
      agentName: agentName || null,
    });

    if (result.needsApproval) {
      return success(res, {
        needsApproval: true,
        sessionId: session.id,
        commandId: result.command.id,
        command: result.command.command,
        riskLevel: result.command.risk_level,
        message: 'Command requires approval before execution',
      });
    }

    return success(res, {
      needsApproval: false,
      sessionId: session.id,
      command: result.command,
    });
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to quick-execute');
    return serverError(res, err.message);
  }
});

export default router;
