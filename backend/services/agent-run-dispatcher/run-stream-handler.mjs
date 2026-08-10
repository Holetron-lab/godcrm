/**
 * ADR-0030 Phase 4 — Stream handler for `claude --print` runner.
 *
 * Spawns `scripts/run-claude-on-ticket.sh` (or override via
 * RUN_CLAUDE_SCRIPT_OVERRIDE for tests) as a child process, pipes the prompt
 * to its stdin, and consumes line-buffered NDJSON events from stdout.
 *
 * Responsibilities:
 *   - Spawn child with workspace + ticket id args.
 *   - Pipe `prompt` to stdin and close immediately.
 *   - Parse stdout line-by-line; each well-formed JSON line → onEvent(evt).
 *     Malformed lines are logged at debug + dropped (claude can occasionally
 *     emit non-JSON warnings on stderr; stdout is supposed to be NDJSON).
 *   - Heartbeat: every 15s, regardless of stdout traffic, fire onHeartbeat.
 *     This keeps `run_last_event_at` fresh so Phase 6 stall detection won't
 *     mark a quiet but live run as stuck.
 *   - Hard timeout: 30 min default (overridable via opts.timeoutMs for
 *     tests). On timeout: SIGTERM, then SIGKILL after 5s grace; return
 *     finalStatus='timeout'.
 *   - stderr is captured to a bounded buffer (last 4KB) and surfaced as
 *     lastError on failure.
 *
 * Returns a summary object — caller decides how to translate into ticket
 * state mutations.
 *
 * @see ADR-0030 §3.7 (stream handler), §6 (Phase 4 deliverables).
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'run_stream_handler' });

const DEFAULT_SCRIPT_PATH = '/root/production/business-crm/scripts/run-claude-on-ticket.sh';
// ADR-0042 Task 4 — renamed from DEFAULT_TIMEOUT_MS to DEFAULT_BACKSTOP_MS.
// Wall-clock hard guard (4 hours). The smart-liveness FSM (ADR-0042) does
// the real per-state / per-tool stall detection upstream; this is just the
// last-resort backstop for catastrophic cases where the FSM misclassifies.
// The legacy 30-min cap moved to per-state `idle_idle_ms` etc. in DEFAULT_CONFIG.
export const DEFAULT_BACKSTOP_MS = 4 * 60 * 60 * 1000;
// ADR-0042 Task 6 — single warn entry at this fraction of the backstop.
// Default 0.75 → 3h with the default 4h backstop. Operators tune via
// `_workflow_config.backstop_warn_ratio`; the dispatcher resolves and
// forwards via `backstopWarnRatio` so this constant is the floor only.
export const DEFAULT_BACKSTOP_WARN_RATIO = 0.75;
const DEFAULT_HEARTBEAT_MS = 15 * 1000;    // 15s heartbeat cadence
const SIGKILL_GRACE_MS = 5 * 1000;         // 5s after SIGTERM before SIGKILL
const STDERR_TAIL_BYTES = 4 * 1024;        // keep last 4KB of stderr

// ADR-0042 Task 4 — heuristic translator gate. When the runner script
// upgrades to `--output-format=stream-json` (ADR-0030 Phase 10), set
// AGENT_STREAM_FORMAT=stream-json and the translator becomes a passthrough.
// Default 'legacy' — translation runs.
const STREAM_FORMAT = (process.env.AGENT_STREAM_FORMAT || 'legacy').toLowerCase();

// Tool-use markers in legacy `output.content` text. Conservative regex —
// matches the canonical Claude tool-use opener. The translator only needs
// `name` to drive the FSM; `input`/`id` are best-effort.
// REPLACE-AT-ADR-0030-PHASE-10
const TOOL_USE_NAME_RE = /(?:"name"\s*:\s*"([A-Za-z_][\w]*(?:__[A-Za-z_][\w]*)*)"\s*,\s*"input"|tool_use[^\n]*?\bname\s*[=:]\s*"?([A-Za-z_][\w]*(?:__[A-Za-z_][\w]*)*)"?)/;

function resolveScriptPath() {
  return process.env.RUN_CLAUDE_SCRIPT_OVERRIDE || DEFAULT_SCRIPT_PATH;
}

/**
 * ADR-0042 Task 4 — heuristic translator: legacy NDJSON event → an event
 * shape the FSM (`state-machine.js#transition`) understands.
 *
 * Today's runner emits `info|output|result|error` lines (see
 * `scripts/run-claude-on-ticket.sh`). The FSM speaks Anthropic stream-json
 * (`message_start`, `content_block_start`, `tool_use`, `tool_result`,
 * `message_stop`, `error`). This shim bridges the two while we wait for
 * ADR-0030 Phase 10 to upgrade the runner to native stream-json.
 *
 * Mapping:
 *   - `info`   → null (skipped, just heartbeat fodder)
 *   - `output` → `{type:'message_start'}` (model started talking).
 *                If the content text contains a tool_use marker, ALSO
 *                a synthetic `{type:'tool_use', name, ...}` is returned
 *                instead. This is the "best we can do" until Phase 10
 *                — false positives are tolerated (cost: an extra
 *                `tool_active` flicker that the next message_stop clears).
 *   - `result` → `{type:'message_stop'}`
 *   - `error`  → `{type:'error', ...}`
 *   - anything else / null / non-object → null (FSM skips)
 *
 * Pure function. No throw on malformed input.
 *
 * @param {object|null|undefined} legacyEvent
 * @returns {object|null} translated event or null to skip
 */
// REPLACE-AT-ADR-0030-PHASE-10
export function eventTranslator(legacyEvent) {
  if (!legacyEvent || typeof legacyEvent !== 'object') return null;
  if (typeof legacyEvent.type !== 'string') return null;

  // When the runner is upgraded to stream-json, env-flip becomes a passthrough.
  if (STREAM_FORMAT === 'stream-json') {
    // REPLACE-AT-ADR-0030-PHASE-10
    return legacyEvent;
  }

  const t = legacyEvent.type;

  // REPLACE-AT-ADR-0030-PHASE-10
  if (t === 'output') {
    // Inspect content for a tool_use marker. Only string content is searched;
    // anything else degrades to a plain message_start.
    const content = typeof legacyEvent.content === 'string' ? legacyEvent.content : '';
    if (content) {
      const m = TOOL_USE_NAME_RE.exec(content);
      if (m) {
        const name = m[1] || m[2] || null;
        if (name) {
          return {
            type: 'tool_use',
            name,
            id: null,
            input: null,
          };
        }
      }
    }
    return { type: 'message_start' };
  }

  // REPLACE-AT-ADR-0030-PHASE-10
  if (t === 'result') {
    return { type: 'message_stop' };
  }

  // REPLACE-AT-ADR-0030-PHASE-10
  if (t === 'error') {
    return {
      type: 'error',
      message: typeof legacyEvent.message === 'string' ? legacyEvent.message : '',
    };
  }

  // info / unknown / non-meaningful: skip.
  return null;
}

// One-shot warn flag: legacy mode prints a single banner per dispatcher
// process so operators know translation is active without log spam.
let _legacyWarnPrinted = false;
export function warnLegacyOnce() {
  if (STREAM_FORMAT !== 'legacy') return;
  if (_legacyWarnPrinted) return;
  _legacyWarnPrinted = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[ADR-0042] AGENT_STREAM_FORMAT=legacy — heuristic eventTranslator active. ' +
    'Set AGENT_STREAM_FORMAT=stream-json after ADR-0030 Phase 10 lands.'
  );
}

// Test-only reset of the warn-once latch. Not exported via default export.
export function _resetLegacyWarnForTest() {
  _legacyWarnPrinted = false;
}

/**
 * Append to a bounded tail buffer (last N bytes only).
 */
function appendTail(prev, chunk, maxBytes) {
  const merged = prev + chunk;
  if (merged.length <= maxBytes) return merged;
  return merged.slice(merged.length - maxBytes);
}

/**
 * Spawn the runner script, stream events, return summary on exit.
 *
 * @param {object} opts
 * @param {number|string} opts.ticketId
 * @param {string} opts.workspacePath
 * @param {string} opts.prompt
 * @param {number|string} opts.agentId
 * @param {(evt: object) => void} [opts.onEvent]
 *   Fires for every well-formed NDJSON line. Audit + content capture wires
 *   here. Errors thrown by the callback are caught + warned, never bubble.
 * @param {(evt: object) => void} [opts.onMeaningfulEvent]
 *   ADR-150 P0: fires AFTER `onEvent` for every well-formed NDJSON line.
 *   The dispatcher hooks this to bump `run_last_event_at` (the
 *   meaningful-event freshness signal that drives stall detection) — split
 *   from the timer-based heartbeat (`onHeartbeat`) so a quiet-but-live
 *   process and a chatty-but-meaningful process can be told apart.
 * @param {(beat: { tickedAt: string, lastEventAt: string|null }) => void} [opts.onHeartbeat]
 *   Fires every `heartbeatMs` regardless of stdout traffic. The dispatcher
 *   hooks this to bump `run_last_heartbeat_at` only — heartbeat MUST NOT
 *   bump `run_last_event_at` (ADR-150 P0 bug fix).
 * @param {(spawned: { pid: number, child: import('node:child_process').ChildProcess }) => void} [opts.onSpawn]
 *   Fires synchronously once the child process has been spawned. The
 *   dispatcher uses this to record the PID into `_activeAttempts` so Phase 6
 *   stall detection can SIGTERM a hung runner from a later tick. Best-effort:
 *   exceptions thrown by the callback are caught + warned, never bubble.
 * @param {number} [opts.backstopMs]
 *   Wall-clock hard guard. On expiry: SIGTERM the process group, then
 *   SIGKILL after grace; the returned summary has
 *   `finalStatus='timeout'` AND `terminalReason='backstop'`. Default 4h.
 * @param {number} [opts.timeoutMs]
 *   DEPRECATED alias for `backstopMs`, retained for one release.
 *   Kept so callers that haven't migrated still work.
 * @param {number} [opts.backstopWarnRatio]
 *   ADR-0042 Task 6 — fraction of `backstopMs` at which `onBackstopWarn`
 *   fires exactly once per run. Defaults to `DEFAULT_BACKSTOP_WARN_RATIO`
 *   (0.75 → 3h at 4h backstop). Out-of-range values (≤0 or ≥1) silently
 *   fall back to the default; the warn never overlaps the kill.
 * @param {(warn: { at: string, elapsedMs: number, ratio: number, thresholdMs: number, backstopMs: number }) => void} [opts.onBackstopWarn]
 *   ADR-0042 Task 6 — fires ONCE per run when wall-clock elapsed crosses
 *   `backstopMs * backstopWarnRatio`. The dispatcher hooks this to write
 *   `data.run_backstop_warned_at` and append a `backstop_warn` audit row,
 *   so operators see "agent has been live for 3h" before the 4h kill.
 *   Per-run idempotency is enforced inside the runner; DB-level
 *   idempotency lives in the dispatcher hook.
 * @param {number} [opts.heartbeatMs]
 * @returns {Promise<{ exitCode: number|null, finalStatus: 'success'|'failed'|'timeout', terminalReason?: string, durationMs: number, eventCount: number, lastError?: string }>}
 */
export async function runStreamHandler(opts) {
  const {
    ticketId,
    workspacePath,
    prompt,
    agentId,
    onEvent,
    onMeaningfulEvent,
    onHeartbeat,
    onSpawn,
    onBackstopWarn,
    backstopMs,
    timeoutMs,
    backstopWarnRatio,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
  } = opts;
  // backstopMs is the canonical name; timeoutMs is a deprecated alias kept
  // one release per ADR-150 P0 brief. Caller-supplied backstopMs wins.
  const effectiveBackstopMs =
    typeof backstopMs === 'number' && Number.isFinite(backstopMs) && backstopMs > 0
      ? backstopMs
      : (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
          ? timeoutMs
          : DEFAULT_BACKSTOP_MS);

  if (ticketId == null) throw new Error('runStreamHandler: ticketId required');
  if (!workspacePath) throw new Error('runStreamHandler: workspacePath required');
  if (typeof prompt !== 'string') throw new Error('runStreamHandler: prompt must be a string');

  const scriptPath = resolveScriptPath();
  const args = [
    '--ticket-id', String(ticketId),
    '--workspace', workspacePath,
    '--agent-id', String(agentId ?? ''),
  ];

  log.debug(
    { ticket_id: ticketId, scriptPath, workspacePath, agent_id: agentId, backstopMs: effectiveBackstopMs, heartbeatMs },
    'spawning runner'
  );

  const startedAt = Date.now();
  let eventCount = 0;
  let lastEventAt = null;
  let stderrTail = '';
  let finalStatus = 'failed';
  let exitCode = null;
  let timedOut = false;

  // Spawn the child in its OWN process group via detached:true so we can
  // signal the entire group on timeout (SIGTERM/SIGKILL to -pgid). Without
  // this, the bash runner's grandchildren (e.g. `sleep`, `claude`) inherit
  // the parent's group and a kill on the bash PID alone leaves them
  // running — keeping the stdio pipe open and preventing 'close' from
  // firing until those grandchildren naturally exit.
  const child = spawn(scriptPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workspacePath,
    env: process.env,
    detached: true,
  });
  // We do NOT call `child.unref()` — we explicitly want to wait for it.
  const childPgid = child.pid; // == pgid because detached:true

  // ADR-0030 Phase 6: surface the PID to the dispatcher so stall detection
  // (Tick Part A) can SIGTERM a runaway runner from a later tick. Wrapped
  // in try/catch — a buggy onSpawn must NEVER take the runner down.
  if (typeof onSpawn === 'function') {
    try {
      onSpawn({ pid: child.pid, child });
    } catch (cbErr) {
      log.warn({ err: cbErr.message, ticket_id: ticketId }, 'onSpawn callback threw');
    }
  }

  // Write prompt to stdin then close — runner reads via `cat`.
  try {
    child.stdin.write(prompt);
  } catch (err) {
    log.warn({ err: err.message, ticket_id: ticketId }, 'failed to write prompt to runner stdin');
  }
  try {
    child.stdin.end();
  } catch { /* already closed */ }

  // Line-by-line stdout consumer. NDJSON: one JSON object per line.
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      log.debug({ ticket_id: ticketId, line: trimmed.slice(0, 200) }, 'dropped non-JSON stdout line');
      return;
    }
    eventCount++;
    lastEventAt = new Date().toISOString();
    try {
      onEvent?.(evt);
    } catch (cbErr) {
      log.warn({ err: cbErr.message, ticket_id: ticketId }, 'onEvent callback threw');
    }
    // ADR-150 P0: meaningful-event callback fires AFTER onEvent so the
    // dispatcher's `bumpLastEventAt` write is the LAST observable side
    // effect of a line. Independent try/catch — onEvent's failure must not
    // block the freshness bump.
    try {
      onMeaningfulEvent?.(evt);
    } catch (cbErr) {
      log.warn({ err: cbErr.message, ticket_id: ticketId }, 'onMeaningfulEvent callback threw');
    }
  });

  // stderr → bounded tail + warn log per chunk.
  child.stderr.on('data', (buf) => {
    const chunk = buf.toString('utf8');
    stderrTail = appendTail(stderrTail, chunk, STDERR_TAIL_BYTES);
    // Avoid log floods — only warn on first kilobyte.
    if (stderrTail.length <= 1024) {
      log.warn({ ticket_id: ticketId, stderr: chunk.slice(0, 500) }, 'runner stderr');
    }
  });

  // Heartbeat — fires regardless of stdout traffic.
  const heartbeatTimer = setInterval(() => {
    try {
      onHeartbeat?.({
        tickedAt: new Date().toISOString(),
        lastEventAt,
      });
    } catch (hbErr) {
      log.warn({ err: hbErr.message, ticket_id: ticketId }, 'onHeartbeat callback threw');
    }
  }, heartbeatMs);
  heartbeatTimer.unref?.();

  // Hard timeout — SIGTERM the whole process group, then SIGKILL the group
  // after grace. process.kill(-pgid, sig) sends to the group leader's
  // entire group, which catches all bash grandchildren.
  let killTimer = null;
  const killGroup = (sig) => {
    try { process.kill(-childPgid, sig); } catch {
      // Group may already be gone; fall back to per-PID kill.
      try { child.kill(sig); } catch { /* dead */ }
    }
  };
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    log.warn({ ticket_id: ticketId, backstopMs: effectiveBackstopMs }, 'runner exceeded backstop — sending SIGTERM to group');
    killGroup('SIGTERM');
    killTimer = setTimeout(() => {
      log.warn({ ticket_id: ticketId }, 'runner did not exit after SIGTERM grace — sending SIGKILL to group');
      killGroup('SIGKILL');
    }, SIGKILL_GRACE_MS);
    killTimer.unref?.();
  }, effectiveBackstopMs);
  timeoutTimer.unref?.();

  // ADR-0042 Task 6 — backstop-warn timer. Fires ONCE at
  // `effectiveBackstopMs * effectiveWarnRatio`. Per-run idempotency: the
  // closure is invoked at most once because `setTimeout` is single-shot.
  // We don't bother latching here — the timer is cleared in the same
  // `clearTimeout(...)` block that clears `timeoutTimer`.
  const ratioCandidate = typeof backstopWarnRatio === 'number'
    && Number.isFinite(backstopWarnRatio)
    && backstopWarnRatio > 0
    && backstopWarnRatio < 1
    ? backstopWarnRatio
    : DEFAULT_BACKSTOP_WARN_RATIO;
  const warnDelayMs = Math.floor(effectiveBackstopMs * ratioCandidate);
  let warnTimer = null;
  if (typeof onBackstopWarn === 'function' && warnDelayMs > 0 && warnDelayMs < effectiveBackstopMs) {
    warnTimer = setTimeout(() => {
      try {
        onBackstopWarn({
          at: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          ratio: ratioCandidate,
          thresholdMs: warnDelayMs,
          backstopMs: effectiveBackstopMs,
        });
      } catch (cbErr) {
        log.warn({ err: cbErr.message, ticket_id: ticketId }, 'onBackstopWarn callback threw');
      }
    }, warnDelayMs);
    warnTimer.unref?.();
  }

  // Wait for child to exit. We rely on 'close' (not 'exit') because 'close'
  // only fires after stdio streams have drained — guarantees we've consumed
  // every NDJSON line before resolving.
  const exitInfo = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', (err) => {
      // Spawn errors (e.g. ENOENT on script path) — treat as failed exit.
      stderrTail = appendTail(stderrTail, `spawn_error: ${err.message}\n`, STDERR_TAIL_BYTES);
      resolve({ code: -1, signal: null, spawnError: err });
    });
  });

  clearInterval(heartbeatTimer);
  clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  if (warnTimer) clearTimeout(warnTimer);
  rl.close();

  exitCode = exitInfo.code;
  if (timedOut) {
    finalStatus = 'timeout';
  } else if (exitInfo.code === 0) {
    finalStatus = 'success';
  } else {
    finalStatus = 'failed';
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    exitCode,
    finalStatus,
    durationMs,
    eventCount,
  };
  // ADR-150 P0: distinguish backstop kills from other failures so the
  // dispatcher can record `run_terminal_reason='backstop'` (vs `timeout`).
  if (timedOut) {
    summary.terminalReason = 'backstop';
  }
  if (finalStatus !== 'success' && stderrTail) {
    summary.lastError = stderrTail.slice(-500);
  } else if (exitInfo.spawnError) {
    summary.lastError = exitInfo.spawnError.message;
  }

  log.info(
    { ticket_id: ticketId, ...summary },
    'runner finished'
  );
  return summary;
}

export default {
  runStreamHandler,
  eventTranslator,
  warnLegacyOnce,
  DEFAULT_BACKSTOP_MS,
  DEFAULT_BACKSTOP_WARN_RATIO,
};
