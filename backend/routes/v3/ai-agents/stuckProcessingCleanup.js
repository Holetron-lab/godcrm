/**
 * Stuck Processing Cleanup
 * Periodic safety net: clears is_processing flags stuck for >30 minutes.
 *
 * BUG-504/BUG-41441: increased from 60s to 1800s to match Claude CLI timeout (30 min)
 * Ticket #36708: original safety net for permanent stuck states
 *
 * FIX-C: REMOVED premature is_processing clearing on startup.
 * Previously an IIFE cleared ALL is_processing flags before recoverStuckJobs()
 * ran in server.js, which interfered with job recovery (Phase 0 and Phase 1
 * need is_processing to still be set to identify which conversations had active
 * jobs). The clearing now happens ONLY in recoverStuckJobs() Phase 3, which
 * properly checks for orphaned conversations with no corresponding agent_job.
 * The processing_started_at column migration is handled elsewhere.
 */

import { dbRun, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

/**
 * Start the periodic cleanup interval.
 * Runs every 60 seconds, clears conversations stuck in processing for >30min.
 */
export function startStuckProcessingCleanup() {
  setInterval(async () => {
    try {
      // BUG-41441: Find conversations stuck in processing for >30min, save timeout message, then clear
      const stuckConversations = await dbAll(
        isPostgres()
          ? `SELECT id, processing_agent_name FROM conversations
             WHERE is_processing = true AND processing_started_at < NOW() - INTERVAL '30 minutes'`
          : `SELECT id, processing_agent_name FROM conversations
             WHERE is_processing = 1 AND processing_started_at < datetime('now', '-1800 seconds')`
      );

      if (stuckConversations && stuckConversations.length > 0) {
        for (const conv of stuckConversations) {
          // Save a system message so the user sees feedback about the timeout
          try {
            const agentLabel = conv.processing_agent_name || 'AI Agent';
            await dbRun(
              isPostgres()
                ? `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at)
                   VALUES ($1, 'system', 'system', $2, 'system', NOW(), NOW())`
                : `INSERT INTO messages (conversation_id, sender_type, role, content, content_type, created_at, updated_at)
                   VALUES (?, 'system', 'system', ?, 'system', datetime('now'), datetime('now'))`,
              [conv.id, `Agent "${agentLabel}" processing timed out after 30 minutes. The task was too complex or the connection was lost. You can try sending your message again.`]
            );
          } catch (msgErr) {
            apiLogger.debug({ err: msgErr, conversationId: conv.id }, 'Ticket #36708: Failed to save timeout message');
          }
        }

        // ADR-093 Task 8: clear processing_agent_id and processing_agent_name
        const result = await dbRun(
          isPostgres()
            ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW()
               WHERE is_processing = true AND processing_started_at < NOW() - INTERVAL '30 minutes'`
            : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now')
               WHERE is_processing = 1 AND processing_started_at < datetime('now', '-1800 seconds')`
        );
        if (result?.changes > 0) {
          apiLogger.warn({ count: result.changes }, 'BUG-41441: Cleared stuck is_processing flags (>30min timeout)');
        }
      }
    } catch (err) {
      // Silently ignore if column doesn't exist yet
    }
  }, 60000);
}
