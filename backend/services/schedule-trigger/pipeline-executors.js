// schedule-trigger/pipeline-executors.js — Pipeline automation action executors
// Ticket #75053: ticket_routing, agent_health_check, dora_metrics, failure_alerting

import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { sendToTopic } from '../TelegramService.js';
import { getPipelineConfig } from '../pipeline-config.js';

const LOG_PREFIX = '[PipelineAutomation]';

// ─── Ticket Auto-Routing ────────────────────────────────────────────────────
// Trigger: row_create on Tickets table
// Logic: assigns unassigned tickets to agents based on ticket type

// Type → agent mapping (Space 11 defaults)
const TYPE_TO_AGENT_MAP = {
  // bug → Developer Ralph (strongest debugger)
  bug: 'DEV_RALPH',
  // task → Developer (general)
  task: 'DEVELOPER',
  // frontend task → Frontend
  frontend: 'FRONTEND',
  // docs → Document Agent
  docs: 'DOCUMENT_AGENT',
  documentation: 'DOCUMENT_AGENT',
  // architecture → Architect
  architecture: 'ARCHITECT',
  spike: 'ARCHITECT',
  // testing → Test Runner
  test: 'TEST_RUNNER',
  testing: 'TEST_RUNNER',
  // widget → Widget Developer
  widget: 'WIDGET_DEVELOPER',
};

/**
 * Route a ticket to the appropriate agent based on type/title keywords.
 * Called as a row_create trigger on the Tickets table.
 *
 * @param {Object} config - action_config from automation record
 * @param {Object} rowData - the ticket row data
 * @param {number} rowId - the ticket row ID
 * @returns {Promise<Object>}
 */
async function executeTicketRouting(config, rowData, rowId) {
  try {
    const spaceId = config.space_id || 11;
    const pipelineConfig = getPipelineConfig(spaceId);

    // Skip if already assigned
    if (rowData.assigned_to) {
      return { success: true, skipped: true, reason: 'Ticket already has assigned_to' };
    }

    // Determine agent from type option ID or title keywords
    let agentKey = null;

    // 1. Try type-based routing via config map
    const typeRouting = config.type_routing || {};
    const ticketType = rowData.type || rowData.ticket_type;
    if (ticketType && typeRouting[String(ticketType)]) {
      agentKey = typeRouting[String(ticketType)];
    }

    // 2. Fallback: keyword matching on title
    if (!agentKey && rowData.what) {
      const title = String(rowData.what).toLowerCase();
      for (const [keyword, agent] of Object.entries(TYPE_TO_AGENT_MAP)) {
        if (title.includes(keyword)) {
          agentKey = agent;
          break;
        }
      }
    }

    // 3. Default agent
    if (!agentKey) {
      agentKey = config.default_agent || 'DEV_RALPH';
    }

    // Resolve agent key to user ID
    const agentUserId = pipelineConfig.AGENT_USERS[agentKey];
    if (!agentUserId) {
      return { success: false, error: `Unknown agent key: ${agentKey}` };
    }

    // Update the ticket with assigned_to and state → assigned
    const data = typeof rowData === 'string' ? JSON.parse(rowData) : { ...rowData };
    data.assigned_to = agentUserId;
    data.state = pipelineConfig.STATE.ASSIGNED;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );

    apiLogger.info(
      { rowId, agentKey, agentUserId },
      `${LOG_PREFIX} Ticket routed to ${agentKey} (userId: ${agentUserId})`
    );

    return { success: true, routed_to: agentKey, agent_user_id: agentUserId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Agent Health Check ─────────────────────────────────────────────────────
// Trigger: schedule (every 30 min)
// Logic: check each agent's last activity, flag dead agents

/**
 * Check agent health by scanning recent activity.
 * Agents with no activity in the threshold period are flagged as dead.
 *
 * @param {Object} config - action_config
 * @param {Object} contextData - schedule context
 * @returns {Promise<Object>}
 */
async function executeAgentHealthCheck(config, contextData) {
  try {
    const thresholdMs = (config.threshold_hours || 2) * 60 * 60 * 1000;
    const now = Date.now();

    // Use agent_jobs table for reliable health check (no LIKE on JSON text)
    const agents = await dbAll(
      `SELECT DISTINCT agent_user_id, agent_name FROM agent_jobs
       WHERE agent_user_id IS NOT NULL
       GROUP BY agent_user_id, agent_name`,
      []
    );

    const deadAgents = [];
    const healthyAgents = [];

    for (const agent of agents) {
      // Find most recent completed/processing job
      const recentJob = await dbGet(
        `SELECT id, agent_name, status, completed_at, started_at, created_at
         FROM agent_jobs
         WHERE agent_user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [agent.agent_user_id]
      );

      if (!recentJob) continue;

      const lastTime = new Date(recentJob.completed_at || recentJob.started_at || recentJob.created_at).getTime();
      const timeSinceActivity = now - lastTime;

      if (timeSinceActivity > thresholdMs) {
        deadAgents.push({
          id: agent.agent_user_id,
          name: agent.agent_name,
          last_activity: recentJob.completed_at || recentJob.started_at || recentJob.created_at,
          hours_since: Math.round(timeSinceActivity / (60 * 60 * 1000) * 10) / 10,
        });
      } else {
        healthyAgents.push({ id: agent.agent_user_id, name: agent.agent_name });
      }
    }

    // Send alert if dead agents found
    if (deadAgents.length > 0 && config.notify !== false) {
      const agentList = deadAgents
        .map(a => `  - ${a.name}: last seen ${a.hours_since}h ago`)
        .join('\n');

      const message =
        `⚠️ *Agent Health Check*\n\n` +
        `🔴 *${deadAgents.length} dead agent(s) detected:*\n${agentList}\n\n` +
        `✅ ${healthyAgents.length} agent(s) healthy\n` +
        `⏰ Threshold: ${config.threshold_hours || 2}h`;

      await sendToTopic(config.topic || 'notifications', message);
    }

    apiLogger.info(
      { dead: deadAgents.length, healthy: healthyAgents.length },
      `${LOG_PREFIX} Agent health check complete`
    );

    return {
      success: true,
      dead_agents: deadAgents,
      healthy_agents: healthyAgents.length,
      total_checked: agents.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── DORA Metrics ───────────────────────────────────────────────────────────
// Trigger: schedule (daily at 23:00)
// Logic: calculate deployment frequency, lead time, change failure rate, MTTR

/**
 * Calculate DORA metrics from ticket and activity data.
 *
 * @param {Object} config - action_config
 * @param {Object} contextData - schedule context
 * @returns {Promise<Object>}
 */
async function executeDoraMetrics(config, contextData) {
  try {
    const spaceId = config.space_id || 11;
    const pipelineConfig = getPipelineConfig(spaceId);
    const ticketsTableId = pipelineConfig.TICKETS_TABLE_ID;
    const activityTableId = pipelineConfig.AGENT_ACTIVITY_TABLE_ID;

    const periodDays = config.period_days || 1;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Deployment Frequency — tickets moved to DONE in period
    const doneTickets = await dbAll(
      `SELECT id, data, updated_at FROM table_rows
       WHERE table_id = ? AND updated_at >= ?
       ORDER BY updated_at DESC`,
      [ticketsTableId, since]
    );

    const completedTickets = doneTickets.filter(t => {
      const d = typeof t.data === 'string' ? JSON.parse(t.data) : t.data;
      return d.state === pipelineConfig.STATE.DONE;
    });
    const deploymentFrequency = completedTickets.length;

    // 2. Lead Time — avg time from created_at to state=done
    let totalLeadTimeMs = 0;
    let leadTimeCount = 0;
    for (const ticket of completedTickets) {
      const d = typeof ticket.data === 'string' ? JSON.parse(ticket.data) : ticket.data;
      const createdDate = d.created_date || d.created_at;
      const completedDate = d.completed_date || ticket.updated_at;
      if (createdDate && completedDate) {
        totalLeadTimeMs += new Date(completedDate).getTime() - new Date(createdDate).getTime();
        leadTimeCount++;
      }
    }
    const avgLeadTimeHours = leadTimeCount > 0
      ? Math.round(totalLeadTimeMs / leadTimeCount / (60 * 60 * 1000) * 10) / 10
      : 0;

    // 3. Change Failure Rate — from agent_jobs table (reliable)
    const jobStats = await dbGet(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM agent_jobs
       WHERE created_at >= ?`,
      [since]
    );

    let totalActivities = Number(jobStats?.total || 0);
    let failedActivities = Number(jobStats?.failed || 0);
    const changeFailureRate = totalActivities > 0
      ? Math.round(failedActivities / totalActivities * 100 * 10) / 10
      : 0;

    // 4. MTTR — avg duration of failed jobs (started_at → completed_at)
    const mttrResult = await dbGet(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_minutes
       FROM agent_jobs
       WHERE status = 'failed' AND completed_at IS NOT NULL AND started_at IS NOT NULL
         AND created_at >= ?`,
      [since]
    );
    const mttrMinutes = Math.round((Number(mttrResult?.avg_minutes) || 0) * 10) / 10;

    const metrics = {
      period_days: periodDays,
      deployment_frequency: deploymentFrequency,
      avg_lead_time_hours: avgLeadTimeHours,
      change_failure_rate_pct: changeFailureRate,
      mttr_minutes: mttrMinutes,
      total_activities: totalActivities,
      failed_activities: failedActivities,
      calculated_at: new Date().toISOString(),
    };

    // Send report
    if (config.notify !== false) {
      const message =
        `📊 *DORA Metrics Report* (${periodDays}d)\n\n` +
        `🚀 Deployment Frequency: *${deploymentFrequency}* tickets done\n` +
        `⏱ Avg Lead Time: *${avgLeadTimeHours}h*\n` +
        `💥 Change Failure Rate: *${changeFailureRate}%*\n` +
        `🔧 MTTR: *${mttrMinutes} min*\n\n` +
        `📈 Total activities: ${totalActivities} | Failed: ${failedActivities}`;

      await sendToTopic(config.topic || 'notifications', message);
    }

    apiLogger.info({ metrics }, `${LOG_PREFIX} DORA metrics calculated`);

    return { success: true, metrics };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Failure Alerting ───────────────────────────────────────────────────────
// Trigger: schedule (every 15 min)
// Logic: check recent failure rate, alert if above threshold

/**
 * Check recent failure rate and send alert if above threshold.
 *
 * @param {Object} config - action_config
 * @param {Object} contextData - schedule context
 * @returns {Promise<Object>}
 */
async function executeFailureAlerting(config, contextData) {
  try {
    const windowMinutes = config.window_minutes || 30;
    const thresholdPct = config.threshold_pct || 30;
    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    // Use agent_jobs for reliable failure tracking
    const recentJobs = await dbAll(
      `SELECT id, agent_name, agent_user_id, status, error_message
       FROM agent_jobs
       WHERE created_at >= ?`,
      [since]
    );

    let total = recentJobs.length;
    let failures = 0;
    const failureDetails = [];

    for (const job of recentJobs) {
      if (job.status === 'failed') {
        failures++;
        failureDetails.push({
          job_id: job.id,
          agent_name: job.agent_name,
          error: job.error_message || 'unknown',
        });
      }
    }

    const failureRate = total > 0 ? Math.round(failures / total * 100 * 10) / 10 : 0;
    const isAboveThreshold = failureRate >= thresholdPct && total >= (config.min_sample || 3);

    if (isAboveThreshold) {
      // Group failures by agent name
      const byAgent = {};
      for (const f of failureDetails) {
        const key = f.agent_name || 'unknown';
        if (!byAgent[key]) byAgent[key] = 0;
        byAgent[key]++;
      }

      const agentBreakdown = Object.entries(byAgent)
        .map(([name, count]) => `  ${name}: ${count} failures`)
        .join('\n');

      const message =
        `🚨 *Failure Rate Alert*\n\n` +
        `Rate: *${failureRate}%* (threshold: ${thresholdPct}%)\n` +
        `Window: last ${windowMinutes} min\n` +
        `Failed: ${failures}/${total} jobs\n\n` +
        `*By agent:*\n${agentBreakdown}`;

      await sendToTopic(config.topic || 'notifications', message);

      apiLogger.warn(
        { failureRate, failures, total, threshold: thresholdPct },
        `${LOG_PREFIX} Failure rate alert triggered`
      );
    }

    return {
      success: true,
      failure_rate_pct: failureRate,
      failures,
      total,
      alert_triggered: isAboveThreshold,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export {
  executeTicketRouting,
  executeAgentHealthCheck,
  executeDoraMetrics,
  executeFailureAlerting,
};
