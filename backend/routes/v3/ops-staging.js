/**
 * Staging channel — HTTP surface of services/ops/stagingExecutionBroker.js.
 *
 * Two routers, mounted like routes/v3/ops.js:
 *
 *  - `stagingGateRouter` (mounted at /api/v3/ops BEFORE `authenticate`): the
 *    agent transport, authenticated by the ops gate token minted at spawn.
 *      POST /staging/preflight  {action, job_id, candidate_sha} → sanitized report
 *      GET  /staging/grant      → the caller's live staging grants (summary)
 *
 *  - default export (mounted at /api/v3 behind `authenticate`): grant lifecycle
 *    and audit for the owner / admin of the staging space.
 *      POST   /ops/staging/grants        issue (agent_id, job_id, candidate_sha)
 *      GET    /ops/staging/grants        list
 *      DELETE /ops/staging/grants/:id    revoke
 *      GET    /ops/staging/runs          receipts (allow + deny)
 *      GET    /ops/staging/leases        lease history / live lease
 *      GET    /ops/staging/executor      executor trust status
 *      POST   /ops/staging/reap          broker-death cleanup
 */

import express from 'express';
import { z } from 'zod';
import { dbGet, dbAll, safeJsonParse } from '../../database/connection.js';
import { checkUserAccessViaTableV2 } from '../../services/space/access.js';
import { verifyOpsGateToken } from '../../services/ops/opsGate.js';
import { OpsDenied } from '../../services/ops/opsBroker.js';
import {
  issueStagingGrant, revokeStagingGrant, stagingGrantSummary, runStagingPreflight,
  verifyStagingExecutor, reapStagingChannel, stagingConfig,
} from '../../services/ops/stagingExecutionBroker.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const log = apiLogger.child({ module: 'staging_api' });
const positiveInt = z.coerce.number().int().positive().max(2147483647);

function denied(res, err) {
  if (err instanceof OpsDenied) {
    return res.status(err.status).json({ success: false, error: { code: 'OPS_DENIED', reason: err.reason } });
  }
  log.error({ err }, 'staging broker failure');
  return res.status(500).json({ success: false, error: { code: 'OPS_BROKER_ERROR', reason: 'internal' } });
}

// ─── Agent transport (gate token) ───────────────────────────────────

export const stagingGateRouter = express.Router();
stagingGateRouter.use(express.json({ limit: '2kb' }));

function gateClaims(req, res) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  try {
    return verifyOpsGateToken(token);
  } catch {
    res.status(401).json({ success: false, error: { code: 'OPS_GATE_UNAUTHORIZED', message: 'invalid gate token' } });
    return null;
  }
}

stagingGateRouter.post('/staging/preflight', async (req, res) => {
  const claims = gateClaims(req, res);
  if (!claims) return;
  try {
    return success(res, await runStagingPreflight({ claims, body: req.body }));
  } catch (err) {
    return denied(res, err);
  }
});

stagingGateRouter.get('/staging/grant', async (req, res) => {
  const claims = gateClaims(req, res);
  if (!claims) return;
  const rows = await dbAll(
    `SELECT * FROM ops_staging_grants WHERE agent_id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > now()
      ORDER BY id DESC`,
    [claims.agent_id, claims.space_id]
  );
  return success(res, { agent_id: claims.agent_id, space_id: claims.space_id, grants: rows.map(stagingGrantSummary) });
});

// ─── Owner / space-admin surface ────────────────────────────────────

const router = express.Router();

async function spaceRoleOf(userId, space) {
  if (space.owner_id === userId) return 'owner';
  const accessControl = safeJsonParse(space.access_control, null);
  if (!accessControl?.enabled || !accessControl.users_table_id) return null;
  const { accessLevel } = await checkUserAccessViaTableV2(userId, accessControl);
  return accessLevel;
}

/** Owner or admin of the configured staging space, else responds and returns false. */
async function requireStagingAdmin(req, res, spaceId) {
  if (!req.user?.id) { forbidden(res, 'Authentication required'); return false; }
  const parsed = positiveInt.safeParse(spaceId);
  if (!parsed.success) { badRequest(res, 'space_id must be a positive integer'); return false; }
  if (parsed.data !== stagingConfig().spaceId) { forbidden(res, 'Not the staging space'); return false; }
  const space = await dbGet('SELECT id, owner_id, access_control FROM spaces WHERE id = ?', [parsed.data]);
  if (!space) { notFound(res, 'Space'); return false; }
  const role = await spaceRoleOf(req.user.id, space);
  if (role !== 'owner' && role !== 'admin') { forbidden(res, 'Space owner or admin only'); return false; }
  return true;
}

const issueSchema = z.object({
  space_id: positiveInt,
  agent_id: positiveInt,
  job_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  candidate_sha: z.string().regex(/^[0-9a-f]{40}$/),
  ttl_seconds: z.number().int().positive().max(3600).optional(),
}).strict();

router.post('/ops/staging/grants', async (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 'BAD_REQUEST', 'invalid grant request', 400, parsed.error.flatten());
  const body = parsed.data;
  if (!(await requireStagingAdmin(req, res, body.space_id))) return;
  try {
    const row = await issueStagingGrant({
      actorUserId: req.user.id, spaceId: body.space_id, agentId: body.agent_id, jobId: body.job_id,
      candidateSha: body.candidate_sha, ttlSeconds: body.ttl_seconds,
    });
    return created(res, { grant: row });
  } catch (err) {
    return denied(res, err);
  }
});

router.get('/ops/staging/grants', async (req, res) => {
  if (!(await requireStagingAdmin(req, res, req.query.space_id))) return;
  const rows = await dbAll(`SELECT * FROM ops_staging_grants WHERE space_id = ? ORDER BY id DESC LIMIT 200`, [Number(req.query.space_id)]);
  return success(res, { grants: rows });
});

router.delete('/ops/staging/grants/:id', async (req, res) => {
  const id = positiveInt.safeParse(req.params.id);
  if (!id.success) return badRequest(res, 'invalid id');
  const grant = await dbGet(`SELECT * FROM ops_staging_grants WHERE id = ?`, [id.data]);
  if (!grant) return notFound(res, 'Grant');
  if (!(await requireStagingAdmin(req, res, grant.space_id))) return;
  const row = await revokeStagingGrant(id.data, req.user.id);
  log.info({ grant_id: id.data, actor: req.user.id }, 'staging grant revoked');
  return success(res, { grant: row || grant, revoked: true });
});

router.get('/ops/staging/runs', async (req, res) => {
  if (!(await requireStagingAdmin(req, res, req.query.space_id))) return;
  const rows = await dbAll(
    `SELECT id, grant_id, agent_id, job_id, action, decision, reason, status, exit_code, candidate_sha,
            executor_sha256, log_sha256, started_at, finished_at, result
       FROM ops_staging_runs WHERE space_id = ? ORDER BY id DESC LIMIT 200`,
    [Number(req.query.space_id)]
  );
  return success(res, { runs: rows });
});

router.get('/ops/staging/leases', async (req, res) => {
  if (!(await requireStagingAdmin(req, res, req.query.space_id))) return;
  const rows = await dbAll(
    `SELECT id, grant_id, run_id, job_id, agent_id, purpose, holder_pid, writers, acquired_at, heartbeat_at,
            expires_at, released_at, release_reason
       FROM ops_staging_leases WHERE space_id = ? ORDER BY id DESC LIMIT 200`,
    [Number(req.query.space_id)]
  );
  return success(res, { leases: rows }); // holder_token never leaves the broker
});

router.get('/ops/staging/executor', async (req, res) => {
  if (!(await requireStagingAdmin(req, res, req.query.space_id))) return;
  const status = { ...verifyStagingExecutor() };
  delete status.socket; // transport location stays server-side
  return success(res, status);
});

router.post('/ops/staging/reap', async (req, res) => {
  if (!(await requireStagingAdmin(req, res, req.body?.space_id))) return;
  return success(res, await reapStagingChannel());
});

export default router;
