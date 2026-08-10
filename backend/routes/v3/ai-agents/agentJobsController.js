/**
 * Agent Jobs Controller
 * Strategy B: Asynchronous agent dispatch via job queue
 * See AgentJobService.js, Migration 034
 *
 * GET /agents/jobs/:id, GET /agents/jobs/uuid/:uuid, GET /agents/jobs
 * POST /agents/jobs/:id/result, POST /agents/jobs/:id/cancel
 * POST /agents/jobs/claim, POST /agents/jobs/:id/heartbeat
 */

import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.js';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import AgentJobService from '../../../services/AgentJobService.js';

const router = Router();

/**
 * GET /agents/jobs/:id — Get job status
 * Returns current status and result of an agent job.
 */
router.get('/agents/jobs/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const job = await AgentJobService.getJob(Number(id));
    if (!job) {
      return notFound(res, 'Job not found');
    }
    return success(res, job);
  } catch (err) {
    apiLogger.error({ err }, 'Error getting agent job');
    return error(res, 'GET_JOB_ERROR', err.message, 500);
  }
});

/**
 * GET /agents/jobs/uuid/:uuid — Get job by UUID
 */
router.get('/agents/jobs/uuid/:uuid', authenticate, async (req, res) => {
  try {
    const job = await AgentJobService.getJobByUuid(req.params.uuid);
    if (!job) {
      return notFound(res, 'Job not found');
    }
    return success(res, job);
  } catch (err) {
    apiLogger.error({ err }, 'Error getting agent job by UUID');
    return error(res, 'GET_JOB_ERROR', err.message, 500);
  }
});

/**
 * GET /agents/jobs — List jobs (with optional filters)
 * Query params: conversation_id, status, limit
 */
router.get('/agents/jobs', authenticate, async (req, res) => {
  try {
    const { conversation_id, status, limit = 200 } = req.query;
    let jobs;

    if (conversation_id) {
      jobs = await AgentJobService.getJobsForConversation(Number(conversation_id));
    } else if (status === 'pending') {
      jobs = await AgentJobService.getPendingJobs(Number(limit));
    } else if (status === 'stalled') {
      jobs = await AgentJobService.getStalledJobs();
    } else {
      jobs = await dbAll(
        `SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT $1`,
        [Number(limit)]
      );
    }

    return success(res, jobs);
  } catch (err) {
    apiLogger.error({ err }, 'Error listing agent jobs');
    return error(res, 'LIST_JOBS_ERROR', err.message, 500);
  }
});

/**
 * POST /agents/jobs/:id/result — Webhook: Submit job result
 * Called by external Claude Code sessions or workers.
 *
 * Body: { result_message, metadata? }
 */
router.post('/agents/jobs/:id/result', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { result_message, metadata = {} } = req.body;

    if (!result_message) {
      return badRequest(res, 'result_message is required');
    }

    const result = await AgentJobService.handleWebhookResult(Number(id), result_message, metadata);

    if (!result.success) {
      return badRequest(res, result.error);
    }

    return success(res, { message: 'Job result received', job_id: Number(id) });
  } catch (err) {
    apiLogger.error({ err }, 'Error handling job webhook result');
    return error(res, 'WEBHOOK_RESULT_ERROR', err.message, 500);
  }
});

/**
 * POST /agents/jobs/:id/cancel — Cancel a running job
 */
router.post('/agents/jobs/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await AgentJobService.cancelJob(Number(id));

    if (!result.success) {
      return badRequest(res, result.error);
    }

    return success(res, { message: 'Job cancelled', job_id: Number(id) });
  } catch (err) {
    apiLogger.error({ err }, 'Error cancelling agent job');
    return error(res, 'CANCEL_JOB_ERROR', err.message, 500);
  }
});

/**
 * POST /agents/jobs/claim — Remote worker claims next pending job
 * Uses FOR UPDATE SKIP LOCKED to prevent double-pickup.
 *
 * Body: { worker_id: string, agent_names?: string[] }
 * Returns: claimed job or null
 */
router.post('/agents/jobs/claim', authenticate, async (req, res) => {
  try {
    const { worker_id, agent_names } = req.body;

    if (!worker_id) {
      return badRequest(res, 'worker_id is required');
    }

    // Find and claim next pending job atomically
    let claimedJob;
    {
      const agentFilter = agent_names?.length
        ? `AND agent_name = ANY($1::text[])`
        : '';
      const params = agent_names?.length ? [agent_names] : [];
      const paramOffset = params.length;

      claimedJob = await dbGet(`
        UPDATE agent_jobs
        SET status = 'processing',
            worker_id = $${paramOffset + 1},
            heartbeat_at = NOW(),
            started_at = NOW(),
            attempts = attempts + 1
        WHERE id = (
          SELECT id FROM agent_jobs
          WHERE status = 'pending'
          ${agentFilter}
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `, [...params, worker_id]);
    }

    return success(res, { job: claimedJob || null });
  } catch (err) {
    apiLogger.error({ err }, 'Error claiming agent job');
    return error(res, 'CLAIM_JOB_ERROR', err.message, 500);
  }
});

/**
 * POST /agents/jobs/:id/heartbeat — Worker sends heartbeat for active job
 * Body: { worker_id: string }
 */
router.post('/agents/jobs/:id/heartbeat', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { worker_id } = req.body;

    const result = await dbRun(
      `UPDATE agent_jobs SET heartbeat_at = NOW() WHERE id = $1 AND worker_id = $2 AND status = 'processing'`,
      [Number(id), worker_id]
    );

    return success(res, { updated: result.changes > 0 });
  } catch (err) {
    apiLogger.error({ err }, 'Error updating job heartbeat');
    return error(res, 'HEARTBEAT_ERROR', err.message, 500);
  }
});

export default router;
