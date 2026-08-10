/**
 * AgentJobService — Lifecycle Module
 *
 * cancelJob, recoverStuckJobs, setShuttingDown, isShuttingDown,
 * and internal helpers for startup recovery.
 */

import { dbGet, dbRun, dbAll, isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { saveStepMessage } from '../AgentLoopService.js';
import { setConversationProcessing } from '../chat/agent-execution-shared.js';
import { resolveAgentUser } from '../agent-users.js';
import { getJob, getStalledJobs } from './query.js';
import { createAndDispatchJob } from './create.js';
import {
  updateJobStatus,
  failJob,
  safeParse,
  JOB_STATUS,
  TICKETS_TABLE_ID,
  TICKET_STATE,
  MAX_RESTART_RETRIES,
  MAX_JOB_RESTART_RETRIES,
  MAX_RECOVERY_REDISPATCH,
} from './shared.js';

// ─── PID LIVENESS CHECK ─────────────────────────────────────────
/**
 * Check if a process with given PID is still alive.
 * Uses kill(pid, 0) which checks existence without sending a signal.
 */
function _isPidAlive(pid) {
  try {
    process.kill(pid, 0); // Signal 0 = check existence only
    return true;
  } catch {
    return false; // ESRCH = no such process
  }
}

// ─── SHUTDOWN STATE ──────────────────────────────────────────────
// FIX-A: Race condition guard. During graceful shutdown, server.js marks jobs
// as failed with a recovery marker. Without this flag, processJobLocally()'s
// catch block runs concurrently and overwrites the marker with the real error,
// causing recoverStuckJobs() Phase 0 to miss these jobs on restart.
let _isShuttingDown = false;

/**
 * Signal that graceful shutdown has begun.
 * Called from server.js BEFORE killing child processes / marking jobs.
 * Once set, processJobLocally() catch blocks will NOT overwrite error_message.
 */
export function setShuttingDown() {
  _isShuttingDown = true;
}

/**
 * Check if shutdown is in progress (for external callers).
 */
export function isShuttingDown() {
  return _isShuttingDown;
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  // Kill the worker process tree (including MCP children) if running
  if (job.worker_pid) {
    try {
      // Kill entire process group (negative PID) to catch MCP sub-processes
      process.kill(-job.worker_pid, 'SIGTERM');
    } catch {
      // Process group may not exist — try direct kill
      try { process.kill(job.worker_pid, 'SIGTERM'); } catch { /* already dead */ }
    }
    // Schedule SIGKILL for stubborn processes
    setTimeout(() => {
      try { process.kill(-job.worker_pid, 'SIGKILL'); } catch { /* already dead */ }
    }, 5000).unref();
  }

  await updateJobStatus(jobId, JOB_STATUS.CANCELLED);
  await setConversationProcessing(job.conversation_id, false);

  return { success: true };
}

// ─── SENTINEL CONSUMPTION (T-146479) ────────────────────────────

/**
 * Mark a graceful-shutdown sentinel row as "consumed" so Phase 0 of
 * recoverStuckJobs will NOT pick it up on subsequent restarts.
 *
 * Mutates BOTH error_message AND result_metadata to break the OR-joined
 * WHERE clause in Phase 0 (see `gracefulJobs` query). Without this, every
 * restart re-finds the same rows and re-dispatches / re-spams the chats.
 */
async function _consumeSentinelMarker(jobId, reason) {
  // Replace result_metadata wholesale with a fresh marker — strips the
  // shutdown_recovery=true flag and any stale fields. We don't try to
  // preserve the original shutdown_at; it's redundant with completed_at.
  const consumedMetadata = JSON.stringify({
    shutdown_recovery: false,
    sentinel_consumed_at: new Date().toISOString(),
    sentinel_consume_reason: reason,
  });
  await dbRun(
    isPostgres()
      ? `UPDATE agent_jobs SET error_message = $1, result_metadata = $2 WHERE id = $3`
      : `UPDATE agent_jobs SET error_message = ?, result_metadata = ? WHERE id = ?`,
    [`Auto-recovery consumed (${reason})`, consumedMetadata, jobId]
  );
}

// ─── STARTUP RECOVERY ───────────────────────────────────────────

/**
 * Reset a ticket back to BACKLOG so AgentWorkerService re-picks it up.
 * Called when the associated agent_job was killed by a server restart.
 *
 * @param {number} conversationId - Conversation bound to the ticket
 * @param {string} reason - Why the ticket is being reset
 * @returns {Promise<{reset: boolean, ticketId?: number}>}
 */
async function resetBoundTicketToBacklog(conversationId, reason) {
  try {
    // Find the conversation's bound ticket
    const conv = await dbGet(
      isPostgres()
        ? `SELECT type, bound_table_id, bound_row_id FROM conversations WHERE id = $1`
        : `SELECT type, bound_table_id, bound_row_id FROM conversations WHERE id = ?`,
      [conversationId]
    );

    // Only reset ticket_chat conversations (created by AgentWorkerService)
    if (conv?.type !== 'ticket_chat' || !conv.bound_row_id) {
      return { reset: false };
    }

    const ticketRow = await dbGet(
      isPostgres()
        ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`
        : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
      [conv.bound_row_id, TICKETS_TABLE_ID]
    );

    if (!ticketRow) return { reset: false };

    const ticketData = safeParse(ticketRow.data, {});
    const currentState = parseInt(ticketData.state, 10);

    // Only reset if ticket is in REVIEW or IN_PROGRESS (not already done/backlog)
    if (currentState !== TICKET_STATE.REVIEW && currentState !== TICKET_STATE.IN_PROGRESS) {
      return { reset: false };
    }

    // Check restart count — don't retry forever
    const restartCount = (ticketData._restart_count || 0) + 1;
    if (restartCount > MAX_RESTART_RETRIES) {
      apiLogger.warn({
        ticket_id: ticketRow.id,
        restartCount,
      }, 'AgentJobService: Ticket exceeded max restart retries — leaving in current state');
      return { reset: false };
    }

    // Reset ticket to BACKLOG with restart metadata
    const updatedData = {
      ...ticketData,
      state: TICKET_STATE.BACKLOG,
      _restart_count: restartCount,
      _last_restart: new Date().toISOString(),
      _restart_reason: reason,
    };

    await dbRun(
      isPostgres()
        ? `UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2`
        : `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(updatedData), ticketRow.id]
    );

    apiLogger.info({
      ticket_id: ticketRow.id,
      restart_count: restartCount,
      previous_state: currentState,
    }, 'AgentJobService: Reset ticket to backlog for auto-retry after restart');

    return { reset: true, ticketId: ticketRow.id };
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'AgentJobService: Failed to reset bound ticket');
    return { reset: false };
  }
}

/**
 * Try to automatically re-dispatch a failed/pending job after server restart.
 * Uses the stored context (message_content, agent config) to create a new job.
 *
 * Tracks _restart_count in conversation metadata to prevent infinite restart loops.
 *
 * @param {Object} job - The failed job row (must include context, agent_row_id, etc.)
 * @returns {Promise<boolean>} true if successfully re-dispatched
 */
async function _tryRedispatchJob(job) {
  try {
    const context = safeParse(job.context, {});
    const messageContent = context.message_content;

    // Can't re-dispatch without the original message
    if (!messageContent) {
      apiLogger.warn({ jobId: job.id }, 'AgentJobService: Cannot re-dispatch — no message_content in context');
      return false;
    }

    // ADR-0057 WP-A: serialize recovery per source-job-id with an advisory lock.
    // pg_try_advisory_xact_lock returns false when another transaction already
    // holds the lock for the same hash — we abort cleanly. The lock auto-releases
    // at commit/rollback. SQLite path skips the lock (no parallel servers there).
    if (isPostgres()) {
      const lockKey = `agent_recover:${job.id}`;
      const lockRow = await dbGet(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [lockKey]);
      if (!lockRow?.locked) {
        apiLogger.info({ jobId: job.id }, 'AgentJobService: recovery advisory lock busy — peer is redispatching, skipping');
        return false;
      }
    }

    // Check restart count to prevent infinite loops (stored in settings JSONB)
    const conv = await dbGet(
      isPostgres()
        ? `SELECT id, settings FROM conversations WHERE id = $1`
        : `SELECT id, settings FROM conversations WHERE id = ?`,
      [job.conversation_id]
    );
    if (!conv) {
      if (isPostgres()) await dbGet(`SELECT pg_advisory_unlock(hashtext($1))`, [`agent_recover:${job.id}`]);
      return false;
    }

    const convSettings = safeParse(conv.settings, {});

    // Reset restart count if last restart was more than 10 minutes ago
    // This prevents accumulation during development/debugging with frequent restarts
    const lastRestart = convSettings._last_restart ? new Date(convSettings._last_restart) : null;
    const RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const baseCount = (lastRestart && (Date.now() - lastRestart.getTime()) > RESTART_WINDOW_MS)
      ? 0 // reset — enough time has passed since last restart
      : (convSettings._job_restart_count || 0);
    const restartCount = baseCount + 1;

    if (restartCount > MAX_JOB_RESTART_RETRIES) {
      apiLogger.warn({
        conversationId: job.conversation_id, restartCount, lastRestart: convSettings._last_restart,
      }, 'AgentJobService: Exceeded max restart retries for conversation — user must resend');
      if (isPostgres()) await dbGet(`SELECT pg_advisory_unlock(hashtext($1))`, [`agent_recover:${job.id}`]);
      return false;
    }

    // Update conversation restart metadata in settings
    const updatedSettings = { ...convSettings, _job_restart_count: restartCount, _last_restart: new Date().toISOString() };
    await dbRun(
      isPostgres()
        ? `UPDATE conversations SET settings = $1 WHERE id = $2`
        : `UPDATE conversations SET settings = ? WHERE id = ?`,
      [JSON.stringify(updatedSettings), job.conversation_id]
    );

    // Resolve the agent user
    const agentResolution = await resolveAgentUser(job.agent_row_id || job.agent_name);
    if (!agentResolution) {
      apiLogger.warn({ jobId: job.id, agentRowId: job.agent_row_id }, 'AgentJobService: Cannot resolve agent for re-dispatch');
      if (isPostgres()) await dbGet(`SELECT pg_advisory_unlock(hashtext($1))`, [`agent_recover:${job.id}`]);
      return false;
    }

    const agent = agentResolution.user;

    // Save system message about auto-resume
    await saveStepMessage(job.conversation_id, {
      content: `🔄 Agent "${job.agent_name || 'AI Agent'}" was interrupted by a server restart. Automatically resuming... (attempt ${restartCount}/${MAX_JOB_RESTART_RETRIES})`,
      contentType: 'system', role: 'system', senderType: 'system',
    });

    // Build continuation message so agent knows to continue, not restart from scratch
    // The conversation history (loaded by processJobLocally) already contains previous work,
    // but the agent needs an explicit instruction to continue rather than re-do everything.
    const continuationMessage = [
      `[SYSTEM CONTINUATION — Server restart recovery, attempt ${restartCount}/${MAX_JOB_RESTART_RETRIES}]`,
      `You were previously working on a task but were interrupted by a server restart.`,
      `Your previous responses and progress are visible in the conversation history above.`,
      `IMPORTANT: Continue from where you left off. Do NOT repeat work you already completed.`,
      `If you're unsure where you stopped, review your last messages in the conversation history.`,
      ``,
      `Original request:`,
      messageContent,
    ].join('\n');

    // Re-dispatch with stored context
    const options = {
      agent_mode: context.agent_mode || 'agent',
      thinking_enabled: context.thinking_enabled || false,
      attachments: context.attachments || [],
      attachmentBaseUrl: context.attachmentBaseUrl || '',
    };

    // ADR-0057 WP-A: lineage on the new row anchors it to the source-job's
    // recovery chain. `recovered_from_job_id` is the ORIGINAL job (chain root,
    // not the immediate predecessor) so the unique partial index serializes
    // ALL retries against the same source. `restart_attempt` is monotonic
    // (no need to track previous attempts for the index — restartCount IS the
    // per-conversation counter and is unique within a chain).
    const recoveredFromJobId = job.recovered_from_job_id || job.id;
    const result = await createAndDispatchJob({
      conversationId: job.conversation_id,
      agent,
      triggeredByUserId: job.trigger_user_id,
      messageContent: continuationMessage,
      options,
      triggerMessageId: job.trigger_message_id,
      recoveredFromJobId,
      restartAttempt: restartCount,
    });

    if (isPostgres()) await dbGet(`SELECT pg_advisory_unlock(hashtext($1))`, [`agent_recover:${job.id}`]);

    if (result?.skipped) {
      apiLogger.info({ oldJobId: job.id, reason: result.reason }, 'AgentJobService: redispatch idempotent — peer already started');
      return false;
    }

    apiLogger.info({
      oldJobId: job.id, conversationId: job.conversation_id,
      agentName: job.agent_name, attempt: restartCount,
      recoveredFromJobId, restartAttempt: restartCount,
    }, 'AgentJobService: Successfully re-dispatched job after restart');

    return true;
  } catch (err) {
    apiLogger.error({ err, jobId: job.id }, 'AgentJobService: Failed to re-dispatch job');
    try { if (isPostgres()) await dbGet(`SELECT pg_advisory_unlock(hashtext($1))`, [`agent_recover:${job.id}`]); } catch { /* lock may not be held */ }
    return false;
  }
}

/**
 * Recover stuck jobs on server startup.
 *
 * When pm2/server restarts, any in-flight jobs (status='processing') were killed
 * mid-execution. This function:
 *   1. Marks all 'processing' jobs as 'failed' (they can't be resumed)
 *   2. Clears is_processing on their conversations (unblocks the chat UI)
 *   3. Resets bound tickets to BACKLOG so AgentWorkerService re-dispatches them
 *   4. Saves a system message about the restart
 *
 * Should be called once during server startup, BEFORE AgentWorkerService.start().
 */
export async function recoverStuckJobs() {
  try {
    let ticketsReset = 0;
    let chatsRedispatched = 0;
    let pendingRecovered = 0;
    let syncConversationsFixed = 0;
    let gracefulRecovered = 0;
    let sentinelsConsumed = 0;
    let totalRedispatched = 0; // Global counter — limits CLI spawns across all phases

    // ── Phase 0: Recover gracefully-shutdown jobs ─────────────────────
    // Jobs marked as failed by graceful shutdown have clean context and should be recovered first.
    // Since we no longer kill CLI processes on shutdown, some may still be alive — check PID first.
    // FIX-D: Check BOTH error_message text AND result_metadata JSON flag for reliability.
    const gracefulJobs = await dbAll(
      isPostgres()
        ? `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, started_at, worker_pid,
                  recovered_from_job_id
           FROM agent_jobs
           WHERE status = 'failed'
             AND (error_message = 'Graceful shutdown — will auto-recover on restart'
                  OR result_metadata::text LIKE '%"shutdown_recovery":true%'
                  OR result_metadata::text LIKE '%"shutdown_recovery": true%')`
        : `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, started_at, worker_pid,
                  recovered_from_job_id
           FROM agent_jobs
           WHERE status = 'failed'
             AND (error_message = 'Graceful shutdown — will auto-recover on restart'
                  OR result_metadata LIKE '%"shutdown_recovery":true%'
                  OR result_metadata LIKE '%"shutdown_recovery": true%')`
    );

    let stillAliveCount = 0;
    if (gracefulJobs && gracefulJobs.length > 0) {
      apiLogger.info({ count: gracefulJobs.length }, 'AgentJobService: Found gracefully-shutdown jobs — recovering');
      for (const job of gracefulJobs) {
        try {
          // Check if the CLI process is still alive (we no longer kill them on shutdown)
          if (job.worker_pid && _isPidAlive(job.worker_pid)) {
            // Process survived the restart — set it back to processing, don't re-dispatch.
            // updateJobStatus flips status away from 'failed' so Phase 0 won't re-match this row.
            await updateJobStatus(job.id, JOB_STATUS.PROCESSING);
            await setConversationProcessing(job.conversation_id, true);
            stillAliveCount++;
            apiLogger.info({
              jobId: job.id, pid: job.worker_pid, agentName: job.agent_name,
            }, 'AgentJobService: CLI process still alive after restart — resuming job');
            continue;
          }

          await setConversationProcessing(job.conversation_id, false);

          // Try ticket reset first
          const ticketResult = await resetBoundTicketToBacklog(
            job.conversation_id,
            'Graceful shutdown — auto-recovering'
          );

          let consumeReason;
          if (ticketResult.reset) {
            ticketsReset++;
            consumeReason = `ticket-reset (ticket ${ticketResult.ticketId})`;
            await saveStepMessage(job.conversation_id, {
              content: `🔄 Agent "${job.agent_name || 'AI Agent'}" was interrupted by a server restart. Automatically resuming...`,
              contentType: 'system', role: 'system', senderType: 'system',
            });
          } else if (totalRedispatched < MAX_RECOVERY_REDISPATCH) {
            const redispatched = await _tryRedispatchJob(job);
            if (redispatched) {
              gracefulRecovered++;
              totalRedispatched++;
              consumeReason = 'redispatched';
            } else {
              consumeReason = 'redispatch-failed';
              await saveStepMessage(job.conversation_id, {
                content: `⚠️ Agent "${job.agent_name || 'AI Agent'}" was interrupted by a server restart. Please send your message again to continue.`,
                contentType: 'system', role: 'system', senderType: 'system',
              });
            }
          } else {
            consumeReason = 'recovery-cap-reached';
          }

          // T-146479: Consume the sentinel marker so Phase 0 will NOT pick this row
          // up on the next restart. Without this, every restart re-finds the same
          // jobs and re-dispatches / re-spams them — accumulating zombie chats.
          await _consumeSentinelMarker(job.id, consumeReason);
          sentinelsConsumed++;

          apiLogger.info({
            jobId: job.id, conversationId: job.conversation_id,
            agentName: job.agent_name, ticketReset: ticketResult.reset,
            consumeReason,
          }, 'AgentJobService: Recovered graceful-shutdown job');
        } catch (jobErr) {
          apiLogger.error({ err: jobErr, jobId: job.id }, 'AgentJobService: Failed to recover graceful-shutdown job');
        }
      }
    }

    // ── Phase 1: Recover stuck 'processing' jobs ──────────────────────
    const stuckJobs = await dbAll(
      isPostgres()
        ? `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, started_at, worker_pid,
                  recovered_from_job_id
           FROM agent_jobs WHERE status = 'processing'`
        : `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, started_at, worker_pid,
                  recovered_from_job_id
           FROM agent_jobs WHERE status = 'processing'`
    );

    if (stuckJobs && stuckJobs.length > 0) {
      apiLogger.warn({ count: stuckJobs.length }, 'AgentJobService: Found stuck processing jobs — recovering');

      for (const job of stuckJobs) {
        try {
          // Check if CLI process is still alive — if so, leave it running
          if (job.worker_pid && _isPidAlive(job.worker_pid)) {
            stillAliveCount++;
            apiLogger.info({
              jobId: job.id, pid: job.worker_pid, agentName: job.agent_name,
            }, 'AgentJobService: Processing job still has alive PID — leaving it');
            continue;
          }

          // Mark old job as failed
          await failJob(job.id, 'Server restarted while job was processing');

          // Clear conversation processing state
          await setConversationProcessing(job.conversation_id, false);

          // Try ticket reset first (for ticket_chat conversations)
          const ticketResult = await resetBoundTicketToBacklog(
            job.conversation_id,
            'Server restarted while agent was processing'
          );

          if (ticketResult.reset) {
            ticketsReset++;
            await saveStepMessage(job.conversation_id, {
              content: `⚠️ Agent "${job.agent_name || 'AI Agent'}" was interrupted by a server restart. Task will be automatically re-dispatched.`,
              contentType: 'system', role: 'system', senderType: 'system',
            });
          } else if (totalRedispatched < MAX_RECOVERY_REDISPATCH) {
            // Regular conversation — try to auto re-dispatch (within limit)
            const redispatched = await _tryRedispatchJob(job);
            if (redispatched) {
              chatsRedispatched++;
              totalRedispatched++;
            } else {
              // Fallback: tell user to resend (only if re-dispatch impossible)
              await saveStepMessage(job.conversation_id, {
                content: `⚠️ Agent "${job.agent_name || 'AI Agent'}" was interrupted by a server restart. Please send your message again.`,
                contentType: 'system', role: 'system', senderType: 'system',
              });
            }
          }

          apiLogger.info({
            jobId: job.id, jobUuid: job.job_id,
            conversationId: job.conversation_id,
            agentName: job.agent_name,
            ticketReset: ticketResult.reset,
            ticketId: ticketResult.ticketId,
          }, 'AgentJobService: Recovered stuck job');
        } catch (jobErr) {
          apiLogger.error({ err: jobErr, jobId: job.id }, 'AgentJobService: Failed to recover stuck job');
        }
      }
    } else {
      apiLogger.info('AgentJobService: No stuck processing jobs found on startup');
    }

    // ── Phase 2: Recover pending jobs (not yet timed out → re-dispatch) ──
    const pendingJobs = await dbAll(
      isPostgres()
        ? `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, recovered_from_job_id
           FROM agent_jobs WHERE status = 'pending' AND timeout_at >= NOW()`
        : `SELECT id, job_id, conversation_id, agent_name, agent_row_id, agent_user_id,
                  context, trigger_message_id, trigger_user_id, recovered_from_job_id
           FROM agent_jobs WHERE status = 'pending' AND timeout_at >= datetime('now')`
    );

    if (pendingJobs && pendingJobs.length > 0) {
      apiLogger.info({ count: pendingJobs.length }, 'AgentJobService: Found pending jobs to re-dispatch');
      for (const job of pendingJobs) {
        try {
          // Cancel old pending job
          await failJob(job.id, 'Server restarted — re-dispatching');
          await setConversationProcessing(job.conversation_id, false);
          if (totalRedispatched < MAX_RECOVERY_REDISPATCH) {
            const redispatched = await _tryRedispatchJob(job);
            if (redispatched) {
              pendingRecovered++;
              totalRedispatched++;
            }
          }
        } catch (jobErr) {
          apiLogger.error({ err: jobErr, jobId: job.id }, 'AgentJobService: Failed to recover pending job');
        }
      }
    }

    // Also clean up truly stalled pending jobs (past timeout)
    const stalledPending = await dbAll(
      isPostgres()
        ? `SELECT id, job_id, conversation_id, agent_name FROM agent_jobs WHERE status = 'pending' AND timeout_at < NOW()`
        : `SELECT id, job_id, conversation_id, agent_name FROM agent_jobs WHERE status = 'pending' AND timeout_at < datetime('now')`
    );

    if (stalledPending && stalledPending.length > 0) {
      for (const job of stalledPending) {
        await failJob(job.id, 'Job timed out in pending state');
        await setConversationProcessing(job.conversation_id, false);
        apiLogger.info({ jobId: job.id }, 'AgentJobService: Cleaned up timed-out pending job');
      }
    }

    // ── Phase 3: Fix orphaned sync-agent conversations ────────────────
    // Conversations where is_processing=true but NO corresponding agent_job exists
    // This happens when non-claude-code (sync) agents crash mid-execution
    const orphanedConversations = await dbAll(
      isPostgres()
        ? `SELECT c.id, c.processing_agent_name
           FROM conversations c
           WHERE c.is_processing = true
             AND NOT EXISTS (
               SELECT 1 FROM agent_jobs aj
               WHERE aj.conversation_id = c.id
                 AND aj.status IN ('pending', 'processing')
             )`
        : `SELECT c.id, c.processing_agent_name
           FROM conversations c
           WHERE c.is_processing = 1
             AND NOT EXISTS (
               SELECT 1 FROM agent_jobs aj
               WHERE aj.conversation_id = c.id
                 AND aj.status IN ('pending', 'processing')
             )`
    );

    if (orphanedConversations && orphanedConversations.length > 0) {
      apiLogger.warn({ count: orphanedConversations.length }, 'AgentJobService: Found orphaned sync-agent conversations — clearing is_processing');
      for (const conv of orphanedConversations) {
        try {
          await setConversationProcessing(conv.id, false);
          await saveStepMessage(conv.id, {
            content: `⚠️ Agent "${conv.processing_agent_name || 'AI Agent'}" was interrupted by a server restart. Chat has been unlocked — you can continue.`,
            contentType: 'system', role: 'system', senderType: 'system',
          });
          syncConversationsFixed++;
        } catch (err) {
          apiLogger.error({ err, conversationId: conv.id }, 'AgentJobService: Failed to clear orphaned conversation');
        }
      }
    }

    const total = (gracefulJobs?.length || 0) + (stuckJobs?.length || 0) + (pendingJobs?.length || 0) + (stalledPending?.length || 0) + syncConversationsFixed;
    apiLogger.info({
      total, stillAliveCount, gracefulRecovered, ticketsReset, chatsRedispatched, pendingRecovered, syncConversationsFixed,
      sentinelsConsumed,
      totalRedispatched, maxRecoveryRedispatch: MAX_RECOVERY_REDISPATCH,
    }, 'AgentJobService: Startup recovery complete');

    return { recovered: total, stillAliveCount, gracefulRecovered, ticketsReset, chatsRedispatched, pendingRecovered, syncConversationsFixed, sentinelsConsumed };
  } catch (err) {
    apiLogger.error({ err }, 'AgentJobService: Startup recovery failed');
    return { recovered: 0, ticketsReset: 0, error: err.message };
  }
}
