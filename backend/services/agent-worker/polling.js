// agent-worker/polling.js — Lifecycle, polling, ticket discovery, cleanup, and status
import { dbAll, isPostgres, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import ChainHandoffService, { STATE } from '../ChainHandoffService.js';
import {
  TICKETS_TABLE_ID,
  POLL_INTERVAL_MS,
  MAX_CONCURRENT,
  EXECUTION_TIMEOUT_MS,
  AGENT_USER_IDS,
  AGENT_SLUGS,
  normalizeAgentId,
} from './constants.js';
import { executeTicket } from './execution.js';

// ===== SERVICE =====

const AgentWorkerService = {
  _interval: null,
  _activeJobs: new Map(), // ticket_id → { agentId, startedAt, promise }
  _started: false,

  // ----- LIFECYCLE -----

  /**
   * Start the polling loop.
   */
  async start() {
    if (this._started) {
      apiLogger.warn('AgentWorker: Already started, ignoring duplicate start()');
      return;
    }
    this._started = true;

    // Recover stuck tickets from previous crash/restart
    await this._recoverStuckTickets();

    this._interval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    apiLogger.info({
      pollIntervalMs: POLL_INTERVAL_MS,
      maxConcurrent: MAX_CONCURRENT,
      timeoutMs: EXECUTION_TIMEOUT_MS,
    }, 'AgentWorker: Started');
  },

  /**
   * Stop the polling loop and wait for active jobs to finish.
   */
  async stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._started = false;

    // Wait for active jobs (with timeout)
    if (this._activeJobs.size > 0) {
      apiLogger.info({ activeJobs: this._activeJobs.size }, 'AgentWorker: Stopping, waiting for active jobs');
      const promises = Array.from(this._activeJobs.values()).map(j => j.promise);
      await Promise.allSettled(promises);
    }

    apiLogger.info('AgentWorker: Stopped');
  },

  // ----- POLLING -----

  /**
   * Single poll iteration: find ready tickets and execute them.
   */
  async poll() {
    try {
      // Clean up dead jobs (exceeded timeout)
      await this._cleanupDeadJobs();

      if (this._activeJobs.size >= MAX_CONCURRENT) return;

      const tickets = await this.findReadyTickets();
      if (tickets.length === 0) return;

      for (const ticket of tickets) {
        if (this._activeJobs.has(ticket.id)) continue;
        if (this._activeJobs.size >= MAX_CONCURRENT) break;

        // Fire-and-forget — track via activeJobs
        const promise = executeTicket(ticket, this._activeJobs).catch(err => {
          apiLogger.error({ err, ticket_id: ticket.id }, 'AgentWorker: Unhandled error in executeTicket');
        });

        const ticketData = safeJsonParse(ticket.data, {});
        this._activeJobs.set(ticket.id, {
          agentId: ticketData.assigned_to,
          startedAt: Date.now(),
          promise,
        });
      }
    } catch (err) {
      apiLogger.error({ err }, 'AgentWorker: Poll error');
    }
  },

  /**
   * Find tickets ready for agent pickup.
   */
  async findReadyTickets() {
    // Build a single IN list of quoted strings covering both integer IDs and slugs.
    const allKnownValues = [
      ...AGENT_USER_IDS.map(id => String(id)),
      ...AGENT_SLUGS,
    ];
    const inList = allKnownValues.map(v => `'${v}'`).join(',');

    const rows = await dbAll(
      isPostgres()
        ? `SELECT id, data, created_at FROM table_rows
           WHERE table_id = $1
             AND (data->>'state')::int IN (${STATE.BACKLOG}, ${STATE.ASSIGNED})
             AND data->>'assigned_to' IN (${inList})
           ORDER BY created_at ASC
           LIMIT 5`
        : `SELECT id, data, created_at FROM table_rows
           WHERE table_id = ?
             AND CAST(json_extract(data, '$.state') AS INTEGER) IN (${STATE.BACKLOG}, ${STATE.ASSIGNED})
             AND json_extract(data, '$.assigned_to') IN (${inList})
           ORDER BY created_at ASC
           LIMIT 5`,
      [TICKETS_TABLE_ID]
    );

    return rows;
  },

  // ----- INTERNAL -----

  /**
   * Clean up jobs that exceeded the execution timeout.
   */
  async _cleanupDeadJobs() {
    const now = Date.now();
    for (const [ticketId, job] of this._activeJobs) {
      if (now - job.startedAt > EXECUTION_TIMEOUT_MS) {
        apiLogger.warn({
          ticket_id: ticketId,
          agentId: job.agentId,
          elapsed_ms: now - job.startedAt,
        }, 'AgentWorker: Dead job detected, resetting to backlog');
        this._activeJobs.delete(ticketId);
        // Reset ticket back to backlog so it can be retried
        try {
          await ChainHandoffService.updateTicketStatus({
            ticket_id: ticketId,
            new_state: STATE.BACKLOG,
            agent_id: job.agentId,
            notes: `Timeout after ${Math.round((now - job.startedAt) / 60000)}m — reset to backlog`,
          });
        } catch (err) {
          apiLogger.error({ err, ticket_id: ticketId }, 'AgentWorker: Failed to reset timed-out ticket');
        }
      }
    }
  },

  /**
   * Recover tickets stuck in in_progress state from a previous server crash/restart.
   */
  async _recoverStuckTickets() {
    try {
      // Match both integer IDs and string slugs — same logic as findReadyTickets()
      const allKnownValues = [
        ...AGENT_USER_IDS.map(id => String(id)),
        ...AGENT_SLUGS,
      ];
      const inList = allKnownValues.map(v => `'${v}'`).join(',');
      const stuckTickets = await dbAll(
        isPostgres()
          ? `SELECT id, data FROM table_rows
             WHERE table_id = $1
               AND (data->>'state')::int = ${STATE.IN_PROGRESS}
               AND data->>'assigned_to' IN (${inList})`
          : `SELECT id, data FROM table_rows
             WHERE table_id = ?
               AND CAST(json_extract(data, '$.state') AS INTEGER) = ${STATE.IN_PROGRESS}
               AND json_extract(data, '$.assigned_to') IN (${inList})`,
        [TICKETS_TABLE_ID]
      );

      if (stuckTickets.length > 0) {
        apiLogger.info({ count: stuckTickets.length }, 'AgentWorker: Found stuck in_progress tickets — recovering');
        for (const ticket of stuckTickets) {
          const ticketData = safeJsonParse(ticket.data, {});
          // Normalise slug → integer so updateTicketStatus receives a valid agent ID
          const agentId = normalizeAgentId(ticketData.assigned_to);
          await ChainHandoffService.updateTicketStatus({
            ticket_id: ticket.id,
            new_state: STATE.BACKLOG,
            agent_id: agentId,
            notes: 'AgentWorker: Recovered stuck ticket after server restart',
          });
          apiLogger.info({ ticket_id: ticket.id }, 'AgentWorker: Recovered stuck ticket');
        }
      }
    } catch (err) {
      apiLogger.error({ err }, 'AgentWorker: Failed to recover stuck tickets');
    }
  },

  // ----- STATUS -----

  /**
   * Get current worker status (for monitoring endpoint).
   */
  getStatus() {
    const jobs = [];
    for (const [ticketId, job] of this._activeJobs) {
      jobs.push({
        ticket_id: ticketId,
        agent_id: job.agentId,
        agent_name: ChainHandoffService.getAgentName(job.agentId),
        started_at: new Date(job.startedAt).toISOString(),
        elapsed_ms: Date.now() - job.startedAt,
      });
    }

    return {
      started: this._started,
      config: {
        poll_interval_ms: POLL_INTERVAL_MS,
        max_concurrent: MAX_CONCURRENT,
        execution_timeout_ms: EXECUTION_TIMEOUT_MS,
      },
      active_jobs: jobs,
      active_count: jobs.length,
    };
  },
};

export default AgentWorkerService;
export { AgentWorkerService };
