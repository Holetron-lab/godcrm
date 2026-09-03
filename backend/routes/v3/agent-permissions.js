/**
 * ADR-0053 Phase C2 — internal permission-check endpoint.
 *
 * The PreToolUse hook (scripts/agent-permission-hook.js) is a one-shot
 * subprocess Claude CLI spawns for every tool call. It cannot hold an
 * in-memory cache of `_command_policies` itself, so it POSTs here to a
 * long-lived godcrm process that does.
 *
 * Mount in server.js:
 *   app.use('/api/v3/agent-permissions', agentPermissionsRouter);
 *
 * Authentication is INTRA-PROCESS: the hook runs inside a `claude` subprocess
 * spawned from this same Node process, so it inherits AGENT_PERMS_TOKEN from
 * env. Anyone with shell on the host could mint a request, but at that point
 * they already own the host — the audit row still gets written.
 *
 * Endpoints:
 *   POST /check    — resolve + audit one (tool_name, tool_input) request
 *   GET  /audit    — owner-only: recent decisions for the audit UI (C4)
 *   GET  /health   — health beacon (resolver cache state)
 */

import express from 'express';
import { randomBytes } from 'node:crypto';
import resolver from '../../services/agent-permissions/resolver.js';
import { gateWrite } from '../../services/agent-permissions/reservations.js';
import { authenticate } from '../../middleware/auth.js';
import { dbGet, dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, badRequest, forbidden, error } from '../../utils/response.js';
import { requireOwnerRole } from './system/helpers.js';

const log = apiLogger.child({ module: 'agent_permissions_api' });

const router = express.Router();

// ─── Internal-token middleware ─────────────────────────────────────────
// The token is generated once at module load and put on process.env so any
// claude subprocess inherits it. NOT exposed via /health.
const INTERNAL_TOKEN = (() => {
  if (!process.env.AGENT_PERMS_TOKEN) {
    process.env.AGENT_PERMS_TOKEN = randomBytes(24).toString('hex');
  }
  return process.env.AGENT_PERMS_TOKEN;
})();

function requireInternalToken(req, res, next) {
  const hdr = req.headers['x-agent-perms-token'];
  if (hdr !== INTERNAL_TOKEN) {
    return forbidden(res, 'Invalid internal token.');
  }
  return next();
}

// ─── POST /check — main hook endpoint ──────────────────────────────────
router.post('/check', requireInternalToken, express.json({ limit: '64kb' }), async (req, res) => {
  const { tool_name, tool_input, agent_id, space_id, session_id, wp_id } = req.body || {};
  if (!tool_name || typeof tool_name !== 'string') {
    return badRequest(res, 'tool_name is required (string).');
  }

  try {
    const decision = await resolver.resolve({
      tool_name,
      tool_input: tool_input || {},
      agent_id: agent_id ?? null,
      space_id: space_id ?? null,
    });

    // ADR-0181 post-allow stage: only when policy allowed and only for
    // file-mutation tools. gateWrite is fully fail-open (returns null on any
    // error → keep the policy allow). It never touches PermissionResolver.
    let effective = decision;
    if (decision.decision === 'allow') {
      const reservation = await gateWrite({
        toolName: tool_name,
        toolInput: tool_input || {},
        holderSession: session_id ?? null,
        wpId: wp_id ?? null,
        agentId: agent_id ?? null,
        spaceId: space_id ?? null,
      });
      if (reservation) effective = reservation; // soft-deny; else null → unchanged
    }

    // Audit asynchronously — don't block the response on it.
    setImmediate(() => {
      resolver.writeAudit({
        agent_id: agent_id ?? null,
        space_id: space_id ?? null,
        tool_name,
        command: typeof tool_input?.command === 'string'
          ? tool_input.command
          : (typeof tool_input?.file_path === 'string' ? tool_input.file_path : null),
        decision: decision.decision,
        matched_rule_id: decision.matched_rule_id,
        matched_source: decision.matched_source,
        reason: decision.reason,
      });
    });

    return success(res, effective);
  } catch (err) {
    log.error({ err, tool_name }, '/check: resolver threw — fail-open allow');
    // Fail-open: never let resolver crash block tool execution.
    return success(res, {
      decision: 'allow',
      reason: 'Resolver error — fail-open.',
      matched_source: 'default-allow',
      matched_rule_id: null,
    });
  }
});

// ─── GET /audit — owner-only audit feed (used by C4 UI) ────────────────
router.get('/audit', authenticate, async (req, res) => {
  if (!requireOwnerRole(req, res)) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const denyOnly = req.query.deny === 'true' || req.query.deny === '1';
  const agentId = req.query.agent_id ? parseInt(req.query.agent_id, 10) : null;
  const spaceId = req.query.space_id ? parseInt(req.query.space_id, 10) : null;

  const conds = [];
  const params = [];
  if (denyOnly) conds.push("decision = 'deny'");
  if (agentId != null) {
    params.push(agentId);
    conds.push(`agent_id = $${params.length}`);
  }
  if (spaceId != null) {
    params.push(spaceId);
    conds.push(`space_id = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  params.push(offset);

  try {
    const rows = await dbAll(
      `SELECT id, agent_id, space_id, tool_name, command, decision,
              matched_rule_id, matched_source, reason, ts
         FROM _command_audit
        ${where}
        ORDER BY ts DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return success(res, { rows, limit, offset });
  } catch (err) {
    log.error({ err }, '/audit: query failed');
    return error(res, 'AUDIT_QUERY_FAILED', 'Failed to load audit feed');
  }
});

// ─── POST /policies — owner-only: create a row in _command_policies ───
// Used by the terminal CommandApprovalDialog "Approve & Always Allow" button
// and by the future owner Settings UI. The pg_notify trigger handles cache
// eviction; the resolver picks it up on next request.
router.post('/policies', authenticate, express.json({ limit: '16kb' }), async (req, res) => {
  if (!requireOwnerRole(req, res)) return;

  const {
    scope,
    space_id,
    agent_id,
    tool_id,
    pattern,
    match_type = 'prefix',
    action,
    reason,
  } = req.body || {};

  if (scope !== 'global' && scope !== 'space') {
    return badRequest(res, "scope must be 'global' or 'space'.");
  }
  if (scope === 'space' && (space_id == null || Number.isNaN(Number(space_id)))) {
    return badRequest(res, 'space_id required when scope=space.');
  }
  if (scope === 'global' && space_id != null) {
    return badRequest(res, 'space_id must be null when scope=global.');
  }
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return badRequest(res, 'pattern is required (non-empty string).');
  }
  if (!['exact', 'prefix', 'regex'].includes(match_type)) {
    return badRequest(res, "match_type must be 'exact', 'prefix', or 'regex'.");
  }
  if (action !== 'allow' && action !== 'deny') {
    return badRequest(res, "action must be 'allow' or 'deny'.");
  }
  if (match_type === 'regex') {
    try { new RegExp(pattern); }
    catch { return badRequest(res, 'pattern is not a valid regex.'); }
  }

  try {
    const row = await dbGet(
      `INSERT INTO _command_policies
         (scope, space_id, agent_id, tool_id, pattern, match_type, action, actor, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, scope, space_id, agent_id, tool_id, pattern, match_type, action,
                 actor, reason, created_at, updated_at`,
      [
        scope,
        scope === 'space' ? Number(space_id) : null,
        agent_id != null ? Number(agent_id) : null,
        tool_id != null ? Number(tool_id) : null,
        pattern,
        match_type,
        action,
        req.user.id,
        reason ?? null,
      ]
    );
    return success(res, row);
  } catch (err) {
    log.error({ err }, '/policies: insert failed');
    return error(res, 'POLICY_INSERT_FAILED', 'Failed to create policy');
  }
});

// ─── GET /health — resolver state (owner-only; no token leak) ──────────
router.get('/health', authenticate, async (req, res) => {
  if (!requireOwnerRole(req, res)) return;
  return success(res, resolver.health());
});

export default router;
