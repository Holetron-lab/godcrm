/**
 * SSE stream, reset-processing, and stop agent routes.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, error, badRequest,
  requireAuth, getJobsForConversation, cancelJob,
} from './chatShared.js';
import { getContextUsage } from '../../../services/agent-job/liveContextUsage.js';
// T-148528 (WP-B): /stop must also reach dispatcher-managed runs (ADR-0030
// path) — the legacy `cancelJob` only covers `agent_jobs` rows.
import { abortRunByConversation as abortDispatcherRunByConversation } from '../../../services/agent-run-dispatcher/index.js';
// ADR-0057-A WP-B: live push of `_inflight_runs` deltas (pause/resume/done)
// to subscribed chat streams. Falls back silently to the per-poll snapshot
// from messageController.js when the bus is unavailable.
import { subscribeInflight } from '../../../services/inflight/notifyBus.js';

export default function registerStreamRoutes(router) {

  // GET /conversations/:id/stream - Server-Sent Events stream
  router.get('/conversations/:id/stream', requireAuth, (req, res) => {
    const { id } = req.params;
    let lastMessageId = parseInt(req.query.after) || 0;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`event: connected\ndata: {"conversationId": ${id}}\n\n`);

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch (_) {}
    }, 15000);

    // ADR-0057-A WP-B — subscribe to chat_inflight pg_notify bus and fan
    // payloads scoped to this conversation out to the client. Idempotent
    // unsubscribe on close prevents EventEmitter listener leaks.
    const convIdNum = Number(id);
    const unsubscribeInflight = subscribeInflight((payload) => {
      if (!payload || Number(payload.conversation_id) !== convIdNum) return;
      try {
        res.write(`event: inflight\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        apiLogger.debug({ err: err.message, conversationId: id }, 'SSE inflight write failed (client gone)');
      }
    });

    let lastPollTime = new Date().toISOString();

    const poller = setInterval(async () => {
      try {
        const pollStart = new Date().toISOString();

        const newMessages = await dbAll(
          isPostgres()
            ? `SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 50`
            : `SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 50`,
          [id, lastMessageId]
        );

        const newMessageIds = new Set(newMessages.map(m => m.id));
        const updatedStatusMessages = await dbAll(
          isPostgres()
            ? `SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.content_type = 'agent_status' AND m.updated_at > $2 AND m.id <= $3 ORDER BY m.id ASC LIMIT 10`
            : `SELECT m.*, u.name as sender_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.content_type = 'agent_status' AND m.updated_at > ? AND m.id <= ? ORDER BY m.id ASC LIMIT 10`,
          [id, lastPollTime, lastMessageId]
        );

        for (const msg of updatedStatusMessages) {
          if (newMessageIds.has(msg.id)) continue;
          const parsed = {
            ...msg, contentType: msg.content_type || 'text', senderType: msg.sender_type || 'human',
            toolResults: msg.tool_results ? safeJsonParse(msg.tool_results) : null,
            mentions: safeJsonParse(msg.mentions) || [], attachments: safeJsonParse(msg.attachments) || [],
            timestamp: msg.created_at, metadata: safeJsonParse(msg.metadata) || {},
          };
          res.write(`event: message_updated\ndata: ${JSON.stringify(parsed)}\n\n`);
        }

        for (const msg of newMessages) {
          const parsed = {
            ...msg, contentType: msg.content_type || 'text', senderType: msg.sender_type || 'human',
            toolResults: msg.tool_results ? safeJsonParse(msg.tool_results) : null,
            mentions: safeJsonParse(msg.mentions) || [], attachments: safeJsonParse(msg.attachments) || [],
            metadata: safeJsonParse(msg.metadata) || {}, timestamp: msg.created_at,
          };
          res.write(`event: message\ndata: ${JSON.stringify(parsed)}\n\n`);
          lastMessageId = msg.id;
        }

        lastPollTime = pollStart;

        const conv = await dbGet(
          isPostgres()
            ? `SELECT is_processing, processing_agent_name, processing_agent_id, processing_started_at FROM conversations WHERE id = $1`
            : `SELECT is_processing, processing_agent_name, processing_agent_id, processing_started_at FROM conversations WHERE id = ?`,
          [id]
        );

        if (conv) {
          const statusPayload = {
            is_processing: conv.is_processing ? true : false,
            processing_agent_name: conv.processing_agent_name || null,
            processing_agent_id: conv.processing_agent_id || null,
            processing_started_at: conv.processing_started_at || null,
          };

          // Attach live context usage if available
          const ctxUsage = getContextUsage(Number(id));
          if (ctxUsage) {
            statusPayload.context_usage = {
              prompt_tokens: ctxUsage.prompt_tokens,
              completion_tokens: ctxUsage.completion_tokens,
              total_tokens: ctxUsage.total_tokens,
              context_window: ctxUsage.context_window,
              model: ctxUsage.model,
              iteration: ctxUsage.iteration,
              max_iterations: ctxUsage.max_iterations,
            };
          }

          res.write(`event: status\ndata: ${JSON.stringify(statusPayload)}\n\n`);
        }
      } catch (err) {
        apiLogger.error({ err, conversationId: id }, 'SSE stream error');
      }
    }, 500);

    req.on('close', () => {
      clearInterval(poller);
      clearInterval(heartbeat);
      try { unsubscribeInflight(); } catch (_) {}
      apiLogger.debug({ conversationId: id }, 'SSE stream closed');
    });
  });

  // POST /conversations/:id/reset-processing
  router.post('/conversations/:id/reset-processing', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await dbRun(
        isPostgres()
          ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`
          : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now') WHERE id = ?`,
        [id]
      );
      apiLogger.info({ conversationId: id, userId: req.user?.id }, 'Ticket #36708: Processing state manually reset by user');
      return success(res, { reset: true });
    } catch (err) {
      apiLogger.error({ err }, 'Error resetting processing state');
      return error(res, 'RESET_PROCESSING_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/stop - Stop active agent
  //
  // T-148528 (WP-B): two paths can hold a live agent for this conversation:
  //   1. `agent_jobs` row (legacy chat / Claude Code via processJobLocally)
  //      → killed by `cancelJob(jobId)` (SIGTERM → 5s → SIGKILL on worker_pid).
  //   2. ADR-0030 dispatcher run on a bound ticket → no agent_jobs row exists,
  //      so we ALSO call `abortDispatcherRunByConversation(convId)` which
  //      looks up `conversations.bound_row_id` and signals the live child
  //      tracked in `_activeAttempts`.
  // Both legs run unconditionally and best-effort — either may be a no-op.
  router.post('/conversations/:id/stop', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      // Always attempt the dispatcher leg first — it's idempotent and the
      // common case for ticket-bound chats (where no agent_jobs row exists).
      let dispatcherResult = { aborted: false, reason: 'not_invoked' };
      try {
        dispatcherResult = await abortDispatcherRunByConversation(Number(id), { reason: 'user_stop' });
      } catch (dispErr) {
        apiLogger.warn({ err: dispErr.message, conversationId: id }, 'T-148528: dispatcher abort threw (non-blocking)');
      }

      const jobs = await getJobsForConversation(Number(id));
      const activeJob = jobs?.find(j => j.status === 'processing' || j.status === 'pending');

      if (!activeJob) {
        // No legacy job. Still flip processing state so the UI unblocks
        // even when only the dispatcher leg fired (or neither did, in which
        // case this is the original behaviour).
        await dbRun(
          isPostgres()
            ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE id = $1`
            : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now') WHERE id = ?`,
          [id]
        );
        apiLogger.info({ conversationId: id, dispatcherAborted: dispatcherResult.aborted, dispatcherTicketId: dispatcherResult.ticket_id ?? null, userId: req.user?.id }, 'T-148528: /stop — no legacy job, dispatcher leg reported');
        return success(res, {
          stopped: true,
          job_id: null,
          dispatcher_aborted: dispatcherResult.aborted,
          dispatcher_ticket_id: dispatcherResult.ticket_id ?? null,
          message: dispatcherResult.aborted
            ? 'Dispatcher run aborted, processing state reset'
            : 'No active job, processing state reset',
        });
      }

      const result = await cancelJob(activeJob.id);
      if (!result.success) return badRequest(res, result.error);

      apiLogger.info({
        conversationId: id, jobId: activeJob.id, agentName: activeJob.agent_name,
        dispatcherAborted: dispatcherResult.aborted, dispatcherTicketId: dispatcherResult.ticket_id ?? null,
        userId: req.user?.id,
      }, 'T-148528: /stop — agent stopped by user');
      return success(res, {
        stopped: true,
        job_id: activeJob.id,
        agent_name: activeJob.agent_name,
        dispatcher_aborted: dispatcherResult.aborted,
        dispatcher_ticket_id: dispatcherResult.ticket_id ?? null,
      });
    } catch (err) {
      apiLogger.error({ err }, 'Error stopping agent');
      return error(res, 'STOP_AGENT_ERROR', err.message, 500);
    }
  });
}
