/**
 * Autopilot Dashboard Controller
 *
 * GET /autopilot/dashboard — Aggregated view of agent status, job pipeline, throughput.
 * POST /autopilot/jobs/:id/cancel — Cancel a running job
 * POST /autopilot/jobs/:id/reassign — Reassign a job to another agent
 */

import { Router } from 'express';
import { dbAll, dbGet, isPostgres } from '../../../database/connection.js';
import { success, error, notFound, badRequest } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import AgentJobService from '../../../services/AgentJobService.js';

const router = Router();

/**
 * GET /autopilot/dashboard — Main dashboard payload
 *
 * Returns:
 * - agents: list of agents with current job info
 * - pipeline: { backlog, in_progress, review, done, failed } counts
 * - recentJobs: last 50 jobs with status/timing
 * - throughput: completed/failed counts for last 24h, 7d
 * - errors: recent failed jobs with error details
 */
router.get('/autopilot/dashboard', async (req, res) => {
  try {
    const now = isPostgres() ? 'NOW()' : "datetime('now')";
    const interval24h = isPostgres()
      ? `NOW() - INTERVAL '24 hours'`
      : "datetime('now', '-24 hours')";
    const interval7d = isPostgres()
      ? `NOW() - INTERVAL '7 days'`
      : "datetime('now', '-7 days')";

    // Run all queries in parallel
    const [
      pipelineCounts,
      activeJobs,
      recentJobs,
      throughput24h,
      throughput7d,
      recentErrors,
      agentStats,
    ] = await Promise.all([
      // 1. Pipeline counts by status
      dbAll(`
        SELECT status, COUNT(*)::int as count
        FROM agent_jobs
        GROUP BY status
      `),

      // 2. Currently active (processing) jobs with agent info
      dbAll(`
        SELECT
          aj.id, aj.job_id, aj.agent_name, aj.agent_user_id, aj.agent_row_id,
          aj.status, aj.created_at, aj.started_at, aj.timeout_at,
          aj.attempts, aj.max_attempts, aj.conversation_id,
          aj.context
        FROM agent_jobs aj
        WHERE aj.status IN ('pending', 'processing')
        ORDER BY aj.created_at ASC
      `),

      // 3. Recent 50 jobs (all statuses)
      dbAll(
        isPostgres()
          ? `SELECT id, job_id, agent_name, agent_user_id, status,
                    created_at, started_at, completed_at, attempts, error_message,
                    conversation_id
             FROM agent_jobs
             ORDER BY created_at DESC
             LIMIT $1`
          : `SELECT id, job_id, agent_name, agent_user_id, status,
                    created_at, started_at, completed_at, attempts, error_message,
                    conversation_id
             FROM agent_jobs
             ORDER BY created_at DESC
             LIMIT ?`,
        [50]
      ),

      // 4. Throughput last 24h
      dbAll(`
        SELECT status, COUNT(*)::int as count
        FROM agent_jobs
        WHERE created_at >= ${interval24h}
        GROUP BY status
      `),

      // 5. Throughput last 7d
      dbAll(`
        SELECT status, COUNT(*)::int as count
        FROM agent_jobs
        WHERE created_at >= ${interval7d}
        GROUP BY status
      `),

      // 6. Recent errors (last 20 failed jobs)
      dbAll(
        isPostgres()
          ? `SELECT id, job_id, agent_name, agent_user_id, error_message,
                    created_at, completed_at, attempts, conversation_id
             FROM agent_jobs
             WHERE status = 'failed'
             ORDER BY completed_at DESC NULLS LAST
             LIMIT $1`
          : `SELECT id, job_id, agent_name, agent_user_id, error_message,
                    created_at, completed_at, attempts, conversation_id
             FROM agent_jobs
             WHERE status = 'failed'
             ORDER BY completed_at DESC
             LIMIT ?`,
        [20]
      ),

      // 7. Per-agent stats (last 7 days)
      dbAll(`
        SELECT
          agent_name,
          agent_user_id,
          COUNT(*)::int as total_jobs,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
          COUNT(*) FILTER (WHERE status = 'processing')::int as active,
          COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 1) as avg_duration_sec
        FROM agent_jobs
        WHERE created_at >= ${interval7d}
        GROUP BY agent_name, agent_user_id
        ORDER BY total_jobs DESC
      `),
    ]);

    // Build pipeline summary
    const pipeline = { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const row of pipelineCounts) {
      if (pipeline[row.status] !== undefined) {
        pipeline[row.status] = row.count;
      }
    }

    // Build throughput summaries
    const buildThroughput = (rows) => {
      const t = { total: 0, completed: 0, failed: 0, cancelled: 0, pending: 0, processing: 0 };
      for (const row of rows) {
        t[row.status] = row.count || 0;
        t.total += row.count || 0;
      }
      return t;
    };

    return success(res, {
      pipeline,
      agents: agentStats,
      activeJobs,
      recentJobs,
      throughput: {
        last_24h: buildThroughput(throughput24h),
        last_7d: buildThroughput(throughput7d),
      },
      errors: recentErrors,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching autopilot dashboard');
    return error(res, 'AUTOPILOT_DASHBOARD_ERROR', err.message, 500);
  }
});

/**
 * POST /autopilot/jobs/:id/cancel — Cancel a job (delegates to AgentJobService)
 */
router.post('/autopilot/jobs/:id/cancel', async (req, res) => {
  try {
    const result = await AgentJobService.cancelJob(Number(req.params.id));
    if (!result.success) {
      return badRequest(res, result.error);
    }
    return success(res, { message: 'Job cancelled', job_id: Number(req.params.id) });
  } catch (err) {
    apiLogger.error({ err }, 'Error cancelling job from autopilot');
    return error(res, 'AUTOPILOT_CANCEL_ERROR', err.message, 500);
  }
});

export default router;
