/**
 * AgentJobService — Watchdog Module
 *
 * Periodically checks for stalled jobs (processing but past timeout)
 * and cleans them up. Also detects orphaned conversations where
 * is_processing=true but no active job exists.
 *
 * Runs on a configurable interval (default: 60s).
 */

import { apiLogger } from '../../utils/logger.js';
import { setConversationProcessing, isSyncActive } from '../chat/agent-execution-shared.js';
import { saveStepMessage } from '../AgentLoopService.js';
import { getStalledJobs } from './query.js';
import { failJob } from './shared.js';
import { dbAll, isPostgres } from '../../database/connection.js';

const WATCHDOG_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
let _watchdogTimer = null;

/**
 * Start the periodic watchdog.
 * Safe to call multiple times — only one timer will run.
 */
export function startJobWatchdog() {
  if (_watchdogTimer) return; // Already running

  apiLogger.info({ intervalMs: WATCHDOG_INTERVAL_MS }, 'AgentJobService: Starting job watchdog');

  _watchdogTimer = setInterval(async () => {
    try {
      await _watchdogTick();
    } catch (err) {
      apiLogger.error({ err }, 'AgentJobService: Watchdog tick failed');
    }
  }, WATCHDOG_INTERVAL_MS);

  // Don't prevent process exit
  _watchdogTimer.unref();
}

/**
 * Stop the watchdog timer.
 */
export function stopJobWatchdog() {
  if (_watchdogTimer) {
    clearInterval(_watchdogTimer);
    _watchdogTimer = null;
    apiLogger.info('AgentJobService: Job watchdog stopped');
  }
}

/**
 * Single watchdog iteration.
 * Exported for tests (regular operation drives it via the setInterval above).
 */
export async function _watchdogTick() {
  let cleaned = 0;
  let orphaned = 0;

  // 1. Find stalled jobs (processing but past timeout_at)
  const stalledJobs = await getStalledJobs();

  if (stalledJobs && stalledJobs.length > 0) {
    for (const job of stalledJobs) {
      try {
        // Kill worker process if still alive
        if (job.worker_pid) {
          try { process.kill(job.worker_pid, 'SIGTERM'); } catch { /* already dead */ }
          setTimeout(() => {
            try { process.kill(job.worker_pid, 'SIGKILL'); } catch { /* already dead */ }
          }, 3000).unref();
        }

        await failJob(job.id, 'Job timed out (watchdog cleanup)');
        await setConversationProcessing(job.conversation_id, false);

        // Notify user in chat
        await saveStepMessage(job.conversation_id, {
          content: `⏱️ Агент "${job.agent_name || 'AI Agent'}" превысил лимит времени и был остановлен. Отправьте сообщение чтобы продолжить.`,
          contentType: 'text', role: 'assistant',
          senderType: 'system',
        });

        cleaned++;
        apiLogger.warn({
          jobId: job.id, conversationId: job.conversation_id,
          agentName: job.agent_name, startedAt: job.started_at,
        }, 'AgentJobService: Watchdog cleaned up stalled job');
      } catch (err) {
        apiLogger.error({ err, jobId: job.id }, 'AgentJobService: Watchdog failed to clean stalled job');
      }
    }
  }

  // 2. Find orphaned conversations (is_processing=true, no active job)
  const orphanedConversations = await dbAll(
    isPostgres()
      ? `SELECT c.id, c.processing_agent_name
         FROM conversations c
         WHERE c.is_processing = true
           AND NOT EXISTS (
             SELECT 1 FROM agent_jobs aj
             WHERE aj.conversation_id = c.id
               AND aj.status IN ('pending', 'processing')
           )
           AND c.updated_at < NOW() - INTERVAL '2 minutes'`
      : `SELECT c.id, c.processing_agent_name
         FROM conversations c
         WHERE c.is_processing = 1
           AND NOT EXISTS (
             SELECT 1 FROM agent_jobs aj
             WHERE aj.conversation_id = c.id
               AND aj.status IN ('pending', 'processing')
           )
           AND c.updated_at < datetime('now', '-2 minutes')`
  );

  if (orphanedConversations && orphanedConversations.length > 0) {
    for (const conv of orphanedConversations) {
      try {
        // Sync agents (POST /chat, /run) hold is_processing directly without an
        // agent_jobs row, so they always match the orphan query. Skip any that are
        // still LIVE in this process — a single long blocking call (no intermediate
        // saveStepMessage) leaves updated_at stale but the agent is very much alive.
        // isSyncActive auto-expires entries past SYNC_ACTIVITY_MAX_MS, so a genuinely
        // hung agent is still reaped and a chat can never wedge permanently.
        if (isSyncActive(conv.id)) {
          apiLogger.debug({ conversationId: conv.id }, 'AgentJobService: Watchdog skipped live sync conversation');
          continue;
        }

        await setConversationProcessing(conv.id, false);

        await saveStepMessage(conv.id, {
          content: `⚠️ Агент "${conv.processing_agent_name || 'AI Agent'}" перестал отвечать. Чат разблокирован — можно продолжить.`,
          contentType: 'text', role: 'assistant',
          senderType: 'system',
        });

        orphaned++;
        apiLogger.warn({ conversationId: conv.id }, 'AgentJobService: Watchdog cleared orphaned conversation');
      } catch (err) {
        apiLogger.error({ err, conversationId: conv.id }, 'AgentJobService: Watchdog failed to clear orphaned conversation');
      }
    }
  }

  if (cleaned > 0 || orphaned > 0) {
    apiLogger.info({ cleaned, orphaned }, 'AgentJobService: Watchdog tick completed with cleanups');
  }
}
