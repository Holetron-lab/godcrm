/**
 * Ops profiles (diagnostics / local-qa) — HTTP surface of the broker.
 *
 * Two routers, mounted like the connectors pair in server.js:
 *
 *  - `opsGateRouter` (mounted at /api/v3/ops BEFORE `authenticate`): the agent
 *    transport. Authenticated by the ops gate token the CLI provider minted at
 *    spawn (services/ops/opsGate.js), never by a user JWT.
 *      POST /run     {action, job_id, candidate_sha, suite_id?}  → executor report
 *      GET  /grant   → the caller's live grants (summary only)
 *
 *  - default export (mounted at /api/v3 behind `authenticate`): grant lifecycle
 *    for the space owner / space admin. Issuance resolves everything the
 *    executor trusts from server state; the body only names the target.
 *      POST   /ops/grants          issue
 *      GET    /ops/grants?space_id list
 *      DELETE /ops/grants/:id      revoke
 *      GET    /ops/runs?space_id   audit
 *      GET    /ops/runs/:id/log    bounded QA log (owner only, never the agent)
 *      GET    /ops/executor?space_id  executor trust status
 *      POST   /ops/reap            broker-death cleanup
 */

import express from 'express';
import { browserGateRouter } from './ops-browser.js';
import { z } from 'zod';
import { dbGet, dbAll, safeJsonParse } from '../../database/connection.js';
import { checkUserAccessViaTableV2 } from '../../services/space/access.js';
import { verifyOpsGateToken } from '../../services/ops/opsGate.js';
import {
  OpsDenied, issueGrant, revokeGrant, grantSummary, runCheck, verifyExecutor, reapOpsWorkers, readRunLog,
} from '../../services/ops/opsBroker.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const log = apiLogger.child({ module: 'ops_api' });

const positiveInt = z.coerce.number().int().positive().max(2147483647);

// ─── Agent transport (gate token) ───────────────────────────────────

export const opsGateRouter = express.Router();
opsGateRouter.use(express.json({ limit: '4kb' }));
opsGateRouter.use(browserGateRouter);

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

function denied(res, err) {
  if (err instanceof OpsDenied) {
    return res.status(err.status).json({ success: false, error: { code: 'OPS_DENIED', reason: err.reason } });
  }
  log.error({ err }, 'ops broker failure');
  return res.status(500).json({ success: false, error: { code: 'OPS_BROKER_ERROR', reason: 'internal' } });
}

opsGateRouter.post('/run', async (req, res) => {
  const claims = gateClaims(req, res);
  if (!claims) return;
  try {
    const report = await runCheck({ claims, body: req.body });
    return success(res, report);
  } catch (err) {
    return denied(res, err);
  }
});

opsGateRouter.get('/grant', async (req, res) => {
  const claims = gateClaims(req, res);
  if (!claims) return;
  const rows = await dbAll(
    `SELECT * FROM ops_grants WHERE agent_id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > now()
      ORDER BY id DESC`,
    [claims.agent_id, claims.space_id]
  );
  return success(res, { agent_id: claims.agent_id, space_id: claims.space_id, grants: rows.map(grantSummary) });
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

/** Owner or admin of `spaceId`, else responds and returns false. */
async function requireSpaceAdmin(req, res, spaceId) {
  if (!req.user?.id) { forbidden(res, 'Authentication required'); return false; }
  const parsed = positiveInt.safeParse(spaceId);
  if (!parsed.success) { badRequest(res, 'space_id must be a positive integer'); return false; }
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
  profile: z.enum(['diagnostics', 'local-qa']),
  actions: z.array(z.string().max(40)).max(16).optional(),
  suite_ids: z.array(z.string().max(64)).max(16).optional(),
  repo: z.string().min(1).max(512).refine((p) => p.startsWith('/'), 'absolute path'),
  ttl_seconds: z.number().int().positive().max(3600).optional(),
}).strict();

router.post('/ops/grants', async (req, res) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 'BAD_REQUEST', 'invalid grant request', 400, parsed.error.flatten());
  const body = parsed.data;
  if (!(await requireSpaceAdmin(req, res, body.space_id))) return;
  try {
    const row = await issueGrant({
      actorUserId: req.user.id, spaceId: body.space_id, agentId: body.agent_id, jobId: body.job_id,
      profile: body.profile, actions: body.actions, suiteIds: body.suite_ids, repo: body.repo, ttlSeconds: body.ttl_seconds,
    });
    return created(res, { grant: row });
  } catch (err) {
    return denied(res, err);
  }
});

router.get('/ops/grants', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res, req.query.space_id))) return;
  const rows = await dbAll(`SELECT * FROM ops_grants WHERE space_id = ? ORDER BY id DESC LIMIT 200`, [Number(req.query.space_id)]);
  return success(res, { grants: rows });
});

router.delete('/ops/grants/:id', async (req, res) => {
  const id = positiveInt.safeParse(req.params.id);
  if (!id.success) return badRequest(res, 'invalid id');
  const grant = await dbGet(`SELECT * FROM ops_grants WHERE id = ?`, [id.data]);
  if (!grant) return notFound(res, 'Grant');
  if (!(await requireSpaceAdmin(req, res, grant.space_id))) return;
  const row = await revokeGrant(id.data, req.user.id);
  log.info({ grant_id: id.data, actor: req.user.id }, 'ops grant revoked');
  return success(res, { grant: row || grant, revoked: true });
});

router.get('/ops/runs', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res, req.query.space_id))) return;
  const rows = await dbAll(
    `SELECT id, grant_id, agent_id, job_id, action, suite_id, status, exit_code, container, executor_sha256,
            started_at, finished_at, result
       FROM ops_runs WHERE space_id = ? ORDER BY id DESC LIMIT 200`,
    [Number(req.query.space_id)]
  );
  return success(res, { runs: rows });
});

router.get('/ops/runs/:id/log', async (req, res) => {
  const id = positiveInt.safeParse(req.params.id);
  if (!id.success) return badRequest(res, 'invalid id');
  const run = await dbGet(`SELECT id, space_id, artifacts, status FROM ops_runs WHERE id = ?`, [id.data]);
  if (!run) return notFound(res, 'Run');
  if (!(await requireSpaceAdmin(req, res, run.space_id))) return;
  const logText = readRunLog(run.artifacts);
  if (!logText) return notFound(res, 'Log');
  return success(res, { run_id: run.id, status: run.status, ...logText });
});

router.get('/ops/executor', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res, req.query.space_id))) return;
  const status = { ...verifyExecutor() };
  delete status.entry; // the trusted entry path stays server-side
  return success(res, status);
});

router.post('/ops/reap', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res, req.body?.space_id))) return;
  return success(res, await reapOpsWorkers());
});

export default router;
