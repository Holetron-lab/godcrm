/**
 * @swagger
 * tags:
 *   - name: AgentVersions
 *     description: ADR-0007-S G1-data — agent_versions registry (mint / promote / retire)
 */

/**
 * Agent Versions API Routes — ADR-0007-S G1-data write path.
 *
 * Thin HTTP surface over AgentVersionService.js (the canonical handlers; the
 * orphan kebab `agent-versions/` build was dropped during consolidation). This
 * is the API G2 (`@agent-smith`) calls to self-host versioned `@smith-*`
 * agents: mint a revision, promote a winner, retire, list lineage, resolve the
 * current active revision.
 *
 * The single-active-per-agent invariant is enforced at the service/DB layer
 * (migration 073 partial unique index) — these routes are a transport shell and
 * add no scoring/promotion logic (that stays Genesis-lock-clean: G6 promotion
 * is LLM-rerank via search-rerank, ADR-0007-S §6.1, not a hand-tuned scorer).
 *
 * Mounted at /api/v3 (the router declares two base paths, so it cannot mount
 * under a single /agent-versions prefix). Full paths:
 *   GET    /api/v3/agents/:agentRowId/versions         list lineage (newest first)
 *   GET    /api/v3/agents/:agentRowId/versions/active  current active revision
 *   POST   /api/v3/agents/:agentRowId/versions         mint a revision
 *   GET    /api/v3/agent-versions/:id                  fetch one revision
 *   POST   /api/v3/agent-versions/:id/promote          promote → active (atomic)
 *   POST   /api/v3/agent-versions/:id/retire           retire (idempotent)
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, notFound, badRequest, error } from '../../utils/response.js';
import {
  mintAgentVersion,
  promoteAgentVersion,
  retireAgentVersion,
  getAgentVersion,
  listAgentVersions,
  getActiveVersion,
} from '../../services/AgentVersionService.js';

const router = Router();

// Map a service Error.code to an HTTP response. Keeps error semantics in one
// place so every handler maps the same tagged errors consistently.
function mapServiceError(res, err, fallbackCode) {
  switch (err.code) {
    case 'VALIDATION':
      return badRequest(res, err.message, 'VALIDATION');
    case 'AGENT_NOT_FOUND':
    case 'VERSION_NOT_FOUND':
      return notFound(res, err.message);
    case 'NOT_AN_AGENT':
      return error(res, 'NOT_AN_AGENT', err.message, 422);
    default:
      apiLogger.error({ err }, `[agent-versions] ${fallbackCode}`);
      return error(res, fallbackCode, err.message, 500);
  }
}

/**
 * GET /agents/:agentRowId/versions — list all revisions of an agent (newest first).
 */
router.get('/agents/:agentRowId/versions', authenticate, async (req, res) => {
  try {
    const agentRowId = Number(req.params.agentRowId);
    if (!Number.isInteger(agentRowId)) return badRequest(res, 'agentRowId must be an integer');
    const rows = await listAgentVersions(agentRowId);
    return success(res, rows);
  } catch (err) {
    return mapServiceError(res, err, 'LIST_VERSIONS_ERROR');
  }
});

/**
 * GET /agents/:agentRowId/versions/active — the current active revision, or 404.
 */
router.get('/agents/:agentRowId/versions/active', authenticate, async (req, res) => {
  try {
    const agentRowId = Number(req.params.agentRowId);
    if (!Number.isInteger(agentRowId)) return badRequest(res, 'agentRowId must be an integer');
    const row = await getActiveVersion(agentRowId);
    if (!row) return notFound(res, 'No active version for this agent');
    return success(res, row);
  } catch (err) {
    return mapServiceError(res, err, 'GET_ACTIVE_VERSION_ERROR');
  }
});

/**
 * POST /agents/:agentRowId/versions — mint a new revision.
 * Body: { agentSlug?, prompt?, config?, rubricScore?, trafficPct?, parentVersion?, activate? }
 * Genesis (first revision) is active by default; later mints are draft unless activate:true.
 */
router.post('/agents/:agentRowId/versions', authenticate, async (req, res) => {
  try {
    const agentRowId = Number(req.params.agentRowId);
    if (!Number.isInteger(agentRowId)) return badRequest(res, 'agentRowId must be an integer');
    const body = req.body || {};
    const row = await mintAgentVersion({
      agentRowId,
      agentSlug: body.agentSlug,
      prompt: body.prompt,
      config: body.config,
      rubricScore: body.rubricScore,
      trafficPct: body.trafficPct,
      parentVersion: body.parentVersion,
      activate: body.activate,
      createdBy: req.user?.id ?? body.createdBy ?? null,
    });
    return created(res, row);
  } catch (err) {
    return mapServiceError(res, err, 'MINT_VERSION_ERROR');
  }
});

/**
 * GET /agent-versions/:id — fetch a single revision.
 */
router.get('/agent-versions/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');
    const row = await getAgentVersion(id);
    if (!row) return notFound(res, 'Agent version not found');
    return success(res, row);
  } catch (err) {
    return mapServiceError(res, err, 'GET_VERSION_ERROR');
  }
});

/**
 * POST /agent-versions/:id/promote — promote this revision to active.
 * Atomically retires the prior active revision (single-active invariant).
 */
router.post('/agent-versions/:id/promote', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');
    const row = await promoteAgentVersion(id);
    return success(res, row);
  } catch (err) {
    return mapServiceError(res, err, 'PROMOTE_VERSION_ERROR');
  }
});

/**
 * POST /agent-versions/:id/retire — retire this revision (idempotent).
 */
router.post('/agent-versions/:id/retire', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');
    const row = await retireAgentVersion(id);
    if (!row) return notFound(res, 'Agent version not found');
    return success(res, row);
  } catch (err) {
    return mapServiceError(res, err, 'RETIRE_VERSION_ERROR');
  }
});

export default router;
