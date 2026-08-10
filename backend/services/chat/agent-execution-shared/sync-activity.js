/**
 * Live sync-agent activity registry (in-process).
 *
 * Sync agents (POST /chat, POST /run via agentChatController / agentExecutionController)
 * set conversations.is_processing = true DIRECTLY and never create an `agent_jobs`
 * row. The watchdog's orphan-reaper (services/agent-job/watchdog.js) therefore treats
 * every live sync agent as a candidate orphan, and the only thing protecting it is the
 * flat `updated_at < NOW() - 2 minutes` guard. A single long blocking call with no
 * intermediate saveStepMessage (Copilot CLI, a slow Anthropic/OpenAI request, a long
 * tool) lets `updated_at` go stale, so the watchdog prematurely clears the lock of a
 * still-working agent and posts «… перестал отвечать».
 *
 * Fix: while a sync agent is executing in THIS process we register its conversation
 * here. The watchdog skips reaping any conversation present in the registry — unless it
 * has been active longer than SYNC_ACTIVITY_MAX_MS (a genuinely-hung agent), in which
 * case it is reaped anyway so a chat can never wedge permanently.
 *
 * PM2 runs godcrm as `instances: 1, exec_mode: 'fork'` (ecosystem.config.cjs), so the
 * watchdog timer and the sync controllers live in the SAME process and share this Map.
 * On a process crash the Map is lost together with the agent, so the leaked DB lock is
 * correctly reaped on the next watchdog tick after restart.
 */

// Upper bound on how long a sync conversation is protected from the watchdog.
// Matches the 30-minute request socket timeout set in the sync controllers
// (BUG-504: req.socket.setTimeout(1800 * 1000)). Beyond this the agent is
// considered hung and the watchdog is allowed to reap it.
export const SYNC_ACTIVITY_MAX_MS = 30 * 60 * 1000;

/** Map<conversationId:number, startedAtMs:number> */
const _activeSync = new Map();

/**
 * Mark a conversation as actively processed by a sync agent in this process.
 * Idempotent: re-marking refreshes the start timestamp.
 * @param {number|string} conversationId
 */
export function markSyncActive(conversationId) {
  if (conversationId == null) return;
  _activeSync.set(Number(conversationId), Date.now());
}

/**
 * Clear the live mark for a conversation (call in finally on every exit path).
 * @param {number|string} conversationId
 */
export function markSyncInactive(conversationId) {
  if (conversationId == null) return;
  _activeSync.delete(Number(conversationId));
}

/**
 * Whether a conversation is currently being processed by a LIVE sync agent in
 * this process — i.e. registered and still within the max-age cap. A stale entry
 * (older than the cap) is treated as not-live AND evicted, so the watchdog reaps it.
 * @param {number|string} conversationId
 * @returns {boolean}
 */
export function isSyncActive(conversationId) {
  if (conversationId == null) return false;
  const startedAt = _activeSync.get(Number(conversationId));
  if (startedAt === undefined) return false;
  if (Date.now() - startedAt >= SYNC_ACTIVITY_MAX_MS) {
    _activeSync.delete(Number(conversationId));
    return false;
  }
  return true;
}

/** Test/diagnostics helper: number of live sync conversations. */
export function activeSyncCount() {
  return _activeSync.size;
}
