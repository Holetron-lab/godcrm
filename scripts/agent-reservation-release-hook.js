#!/usr/bin/env node
/**
 * ADR-0181 — Stop hook: release this loop's write-reservations at turn end.
 *
 * Wired into the spawned `claude` process via:
 *   --settings '{"hooks":{"Stop":[{"hooks":[
 *     {"type":"command","command":"node /abs/path/to/scripts/agent-reservation-release-hook.js"}
 *   ]}]}}'
 *
 * WHY THIS EXISTS
 * reservations.js keys the soft-lock by `holder_session`, but every chat turn
 * runs as its OWN headless `claude -p` worker with a fresh session UUID while
 * the agent identity is unchanged. Acquire renews on `holder_session =
 * EXCLUDED.holder_session`, so the next turn of the SAME agent arrives under a
 * different UUID, fails that predicate, and gets soft-DENIED by its own
 * reservation — up to a full TTL (600 s) of dead time per file. The release
 * fast-path was written for exactly this (see releaseWriteReservation's
 * "a Stop hook can call this at turn end") but was never wired up.
 *
 * Contract (Claude Code hooks):
 *   stdin  → JSON: { session_id, transcript_path, cwd, hook_event_name, ... }
 *   stdout → nothing (a Stop hook that emits no JSON simply lets the turn end)
 *   exit   → ALWAYS 0. A non-zero Stop hook can block the turn from ending;
 *            this one must never do that.
 *
 * Unlike agent-permission-hook.js this hook is NOT zero-dep: it talks to the
 * DB directly through the sanctioned reservations module rather than over
 * HTTP, because agent-permissions exposes no release route and adding one
 * would need a Ring-0 restart to take effect. TTL stays the backstop, so a
 * failure here degrades to today's behaviour rather than breaking anything.
 */

const HOOK_BUDGET_MS = 2000;

function logStderr(msg, extra) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), hook: 'agent-reservation-release', msg, ...extra });
    process.stderr.write(line + '\n');
  } catch { /* ignore */ }
}

// Hard ceiling: whatever happens (hung pool, unreachable DB), the turn ends.
const bail = setTimeout(() => {
  logStderr('budget exceeded — leaving reservations to TTL');
  process.exit(0);
}, HOOK_BUDGET_MS);
bail.unref();

async function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

async function main() {
  const raw = await readStdin();
  let sessionId = null;
  try {
    sessionId = JSON.parse(raw)?.session_id || null;
  } catch {
    logStderr('bad stdin JSON', { rawLen: raw.length });
  }
  const { releaseSessionReservations, purgeExpiredReservations } =
    await import('../backend/services/agent-permissions/reservations.js');

  // No session id (malformed payload) → nothing of mine to release, but the
  // expired-row sweep below still runs: it needs no identity.
  if (sessionId) {
    const released = await releaseSessionReservations({ holderSession: sessionId });
    if (released > 0) {
      logStderr('released', { sessionId, released });
    }
  }

  // Hygiene: rows left behind by loops that died without a Stop hook (crash,
  // kill, pre-hook worker) would otherwise sit until nothing ever deletes them
  // — expiry makes them harmless but not absent. Decision-neutral, so it runs
  // unconditionally; failures are swallowed inside the module.
  const purged = await purgeExpiredReservations();
  if (purged > 0) {
    logStderr('purged expired', { purged });
  }

  try {
    const { closeDatabase } = await import('../backend/database/connection.js');
    closeDatabase();
  } catch { /* pool teardown is best-effort */ }
}

main()
  .catch((err) => logStderr('hook crashed', { err: String(err?.message || err) }))
  .finally(() => process.exit(0));
