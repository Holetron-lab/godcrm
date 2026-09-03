/**
 * ADR-0181 — Agent Write-Reservations (advisory concurrent-loop soft-lock).
 *
 * Evaluated as a POST-ALLOW stage inside the ADR-0053 /check route handler
 * (backend/routes/v3/agent-permissions.js). Two reservation CLASSES:
 *   - file-mutation tools (Edit/Write/MultiEdit/NotebookEdit) → per-file key.
 *   - ADR-0181-A: Bash *git-write* commands → one synthetic per-tree key
 *     (`::git-index::`) modelling the shared .git index/HEAD/refs mutex.
 * Everything else (read-only git, non-git Bash, Read, MCP) is untouched.
 *
 * Semantics:
 *   - Fresh path, or the SAME holder_session re-touching it (multi-file WP
 *     turn) → acquire/renew → ALLOW.
 *   - Path held live by a DIFFERENT holder_session → soft DENY carrying the
 *     holder + expiry, so the second loop defers / re-reads and converges
 *     instead of co-authoring.
 *   - Stale reservation (expires_at < now()) → transparently stolen on the
 *     next acquire (dead-loop self-release; no manual unlock ever needed).
 *
 * FAIL-OPEN (non-negotiable — this is what "advisory" means): any error in
 * this stage returns null → the caller keeps the policy ALLOW. The guard
 * reduces collision probability for a 2-3 loop fleet; it is NOT a correctness
 * barrier and must never block or kill a live loop.
 */

import { dbAll, dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'agent_write_reservations' });

// File-mutation tools that carry a target path. Bash/Read/MCP are NOT here →
// they skip the reservation stage entirely (ADR-0181 AC#6).
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// TTL default 10 min — long enough to cover a multi-file WP turn, short enough
// that a crashed loop's reservation frees fast. Tunable via env.
const DEFAULT_TTL_SECONDS = Number(process.env.AGENT_WRITE_RESERVATION_TTL_SECONDS) || 600;

// ── ADR-0181-A — git-index critical-section mutex ─────────────────────────
// One synthetic key per git tree. A Bash `git`-*write* contends on it
// regardless of which files it touches, because `git add`/`git commit` race on
// the tree's shared `.git` index / HEAD / refs — not on any single file. The
// `::`-prefixed sentinel can never collide with a normalizeReservationPath()
// output (real keys are repo-relative and never start with ':') — see AC#4.
export const GIT_INDEX_KEY = '::git-index::';

// Short dedicated TTL for the git-index key, separate from the 10-min file TTL:
// a commit is near-instant, but the pre-push guard / a large tree can add a few
// seconds. Steal-if-expired self-heals a crashed committer fast. Env-tunable.
const GIT_INDEX_TTL_SECONDS = Number(process.env.AGENT_GIT_INDEX_RESERVATION_TTL_SECONDS) || 60;

// git *write* verbs only. Read-only git (status/log/diff/show/rev-parse/
// branch --list/cat-file) is deliberately NOT matched — serializing reads would
// stall the fleet for nothing. Bias toward KNOWN write verbs, never a catch-all:
// a missed classification is fail-open by design (gateWrite → allow).
const GIT_WRITE_VERBS = 'commit|add|mv|rm|reset|stash|merge|rebase|cherry-pick|apply';
// Allow global options between `git` and the verb: `-C <path>`, `-c k=v`, long
// `--flag`s, short `-x`. `(?![\w-])` keeps `commit-tree`/`add-ons` from matching.
const GIT_GLOBAL_OPTS = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--?\S+))*`;
const GIT_WRITE_RE = new RegExp(
  String.raw`\bgit\b${GIT_GLOBAL_OPTS}\s+(?:${GIT_WRITE_VERBS})(?![\w-])`
);
// `git restore` is a write ONLY when it targets the index (--staged / -S);
// a bare `git restore <file>` is a working-tree op and is left ungated.
const GIT_RESTORE_STAGED_RE = new RegExp(
  String.raw`\bgit\b${GIT_GLOBAL_OPTS}\s+restore\b[^\n]*(?:--staged|\s-S\b)`
);

/**
 * True when a Bash command string invokes a git *write* subcommand that mutates
 * the shared index / HEAD / refs. Read-only git and non-git commands → false.
 * Deliberately biased toward known write verbs; a miss is fail-open (allow).
 * @param {unknown} command
 * @returns {boolean}
 */
export function isGitWriteCommand(command) {
  if (typeof command !== 'string' || !command.includes('git')) return false;
  return GIT_WRITE_RE.test(command) || GIT_RESTORE_STAGED_RE.test(command);
}

const BASE_TREE = '/root/production/business-crm/';
const DEPLOY_ARTIFACT = '/srv/godcrm/live/';
// Worktree prefix is NESTED inside BASE_TREE, so it must be stripped FIRST or
// the base-tree strip would leave `.claude/worktrees/agent-*/<p>` as the key.
const WORKTREE_RE = /^\/root\/production\/business-crm\/\.claude\/worktrees\/agent-[^/]+\//;

/**
 * Normalize an absolute file path to a tree/worktree-agnostic repo-relative
 * key, so two loops touching the same logical file collide regardless of which
 * tree or worktree they edit in (ADR-0181 "which tree is canonical").
 * @param {string} filePath
 * @returns {string|null} repo-relative key, or null if unusable
 */
export function normalizeReservationPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  let p = filePath.trim();
  if (!p) return null;

  if (WORKTREE_RE.test(p)) {
    p = p.replace(WORKTREE_RE, '');
  } else if (p.startsWith(BASE_TREE)) {
    p = p.slice(BASE_TREE.length);
  } else if (p.startsWith(DEPLOY_ARTIFACT)) {
    p = p.slice(DEPLOY_ARTIFACT.length);
  }
  // Strip any leading ./ or / so a relative path and its absolute form collapse.
  p = p.replace(/^\.?\/+/, '');
  return p || null;
}

/**
 * Extract the target path from a tool_input for a file-mutation tool.
 * @returns {string|null}
 */
function extractPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const raw = toolInput.file_path ?? toolInput.notebook_path ?? null;
  return typeof raw === 'string' ? raw : null;
}

/**
 * Atomic steal-if-expired-or-mine acquire (ON CONFLICT).
 * @returns {Promise<{granted: true} | {granted: false, holder: string|null, wpId: string|null, expiresAt: string|null}>}
 */
export async function acquireWriteReservation({
  filePath,
  holderSession,
  wpId = null,
  agentId = null,
  spaceId = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  const interval = `${Math.max(1, Math.floor(ttlSeconds))} seconds`;

  // dbGet returns the RETURNING row on insert/renew/steal, or undefined when
  // the ON CONFLICT WHERE filters the update out (someone else holds it live).
  const row = await dbGet(
    `INSERT INTO _agent_write_reservations
       (file_path, wp_id, holder_session, agent_id, space_id, expires_at)
     VALUES (?, ?, ?, ?, ?, now() + ?::interval)
     ON CONFLICT (file_path) DO UPDATE
       SET holder_session = EXCLUDED.holder_session,
           wp_id          = EXCLUDED.wp_id,
           agent_id       = EXCLUDED.agent_id,
           space_id       = EXCLUDED.space_id,
           renewed_at     = now(),
           expires_at     = EXCLUDED.expires_at
       WHERE _agent_write_reservations.holder_session = EXCLUDED.holder_session
          OR _agent_write_reservations.expires_at < now()
     RETURNING holder_session, wp_id, expires_at`,
    [filePath, wpId, holderSession, agentId, spaceId, interval]
  );

  if (row && row.holder_session === holderSession) {
    return { granted: true };
  }

  // Contested — read back the live holder for the deny reason.
  const cur = await dbGet(
    `SELECT holder_session, wp_id, expires_at
       FROM _agent_write_reservations WHERE file_path = ?`,
    [filePath]
  );
  return {
    granted: false,
    holder: cur?.holder_session ?? null,
    wpId: cur?.wp_id ?? null,
    expiresAt: cur?.expires_at ?? null,
  };
}

/**
 * Best-effort release (fast path — a Stop hook can call this at turn end).
 * TTL is the backstop; a missed release just expires. Never throws.
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function releaseWriteReservation({ filePath, holderSession }) {
  try {
    const key = normalizeReservationPath(filePath);
    if (!key || !holderSession) return false;
    const res = await dbGet(
      `DELETE FROM _agent_write_reservations
        WHERE file_path = ? AND holder_session = ? RETURNING file_path`,
      [key, holderSession]
    );
    return Boolean(res);
  } catch (err) {
    log.warn({ err: String(err?.message || err) }, 'releaseWriteReservation failed (ignored)');
    return false;
  }
}

/**
 * Release EVERY path held by one holder_session — the turn-end fast path.
 *
 * Why this exists: each chat turn runs as its own headless `claude -p` worker
 * with a FRESH session UUID, while the agent identity stays the same. Without
 * a turn-end release the reservation survives for the full TTL and the SAME
 * agent's next turn hits its own lock as if it were a foreign loop. The Stop
 * hook (scripts/agent-reservation-release-hook.js) calls this with the ending
 * session's id. TTL remains the backstop; a missed release just expires.
 *
 * @returns {Promise<number>} number of reservations released
 */
export async function releaseSessionReservations({ holderSession }) {
  try {
    if (!holderSession) return 0;
    const rows = await dbAll(
      `DELETE FROM _agent_write_reservations
        WHERE holder_session = ? RETURNING file_path`,
      [holderSession]
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    log.warn({ err: String(err?.message || err) }, 'releaseSessionReservations failed (ignored)');
    return 0;
  }
}

/**
 * Drop every already-expired reservation, regardless of holder.
 *
 * Purely hygienic: an expired row is transparently stolen by the next acquire
 * (see the ON CONFLICT predicate), so deleting it changes NO decision — it only
 * stops the table growing without bound. A live row can never be hit: the
 * predicate is `expires_at < now()` evaluated server-side, so a reservation
 * another loop acquires mid-statement is out of scope by construction.
 *
 * Called from the Stop hook so the table self-cleans at every turn end.
 *
 * @returns {Promise<number>} number of expired rows dropped
 */
export async function purgeExpiredReservations() {
  try {
    const rows = await dbAll(
      `DELETE FROM _agent_write_reservations WHERE expires_at < now() RETURNING file_path`
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch (err) {
    log.warn({ err: String(err?.message || err) }, 'purgeExpiredReservations failed (ignored)');
    return 0;
  }
}

/**
 * Read the current live holder of a normalized path (observability / tests).
 * @returns {Promise<object|null>}
 */
export async function checkReservation(filePath) {
  const key = normalizeReservationPath(filePath);
  if (!key) return null;
  const row = await dbGet(
    `SELECT file_path, holder_session, wp_id, agent_id, space_id, acquired_at, renewed_at, expires_at
       FROM _agent_write_reservations WHERE file_path = ?`,
    [key]
  );
  return row || null;
}

/**
 * The /check post-allow gate. Returns a soft-DENY decision object (same shape
 * as resolver.resolve) when a DIFFERENT live loop holds the path, otherwise
 * null (→ caller keeps the policy ALLOW). FULLY FAIL-OPEN.
 *
 * @returns {Promise<{decision:'deny', reason:string, matched_source:'reservation', matched_rule_id:null} | null>}
 */
export async function gateWrite({ toolName, toolInput, holderSession, wpId = null, agentId = null, spaceId = null }) {
  try {
    if (!holderSession) return null;                       // no holder identity → cannot reserve → allow

    // Resolve which reservation CLASS this tool contends on.
    //   - file-mutation tool → per-file key (ADR-0181).
    //   - Bash git-write     → the one per-tree git-index sentinel (ADR-0181-A).
    // Anything else (read-only git, non-git Bash, Read, MCP) → untouched.
    let key = null;
    let ttlSeconds = DEFAULT_TTL_SECONDS;
    let denyKind = 'file';
    if (WRITE_TOOLS.has(toolName)) {
      key = normalizeReservationPath(extractPath(toolInput));   // per-file mutex (AC#6)
    } else if (toolName === 'Bash' && isGitWriteCommand(toolInput?.command)) {
      key = GIT_INDEX_KEY;                                       // shared git-index mutex (AC#1)
      ttlSeconds = GIT_INDEX_TTL_SECONDS;
      denyKind = 'git';
    }
    if (!key) return null;                                 // non-mutation / non-git-write / no path → allow

    const result = await acquireWriteReservation({
      filePath: key, holderSession, wpId, agentId, spaceId, ttlSeconds,
    });
    if (result.granted) return null;                       // acquired/renewed my own → allow

    const until = result.expiresAt ? new Date(result.expiresAt).toISOString() : 'soon';
    const who = result.holder ? `${result.holder}${result.wpId ? `/${result.wpId}` : ''}` : 'another loop';
    log.info({ key, holder: result.holder, wpId: result.wpId, kind: denyKind }, 'write-reservation soft-deny');
    const reason = denyKind === 'git'
      ? `git index reserved by ${who} until ${until} — retry in a moment (ADR-0181-A advisory git-index mutex).`
      : `File reserved by ${who} until ${until} — defer & re-read (ADR-0181 advisory soft-lock).`;
    return {
      decision: 'deny',
      reason,
      matched_source: 'reservation',
      matched_rule_id: null,
    };
  } catch (err) {
    // Fail-open: reservation must never break a live worker (ADR-0181 AC#5).
    log.warn({ err: String(err?.message || err) }, 'gateWrite failed — fail-open allow');
    return null;
  }
}

export default { WRITE_TOOLS, normalizeReservationPath, acquireWriteReservation, releaseWriteReservation, releaseSessionReservations, purgeExpiredReservations, checkReservation, gateWrite };
