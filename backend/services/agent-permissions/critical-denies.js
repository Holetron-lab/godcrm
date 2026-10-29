/**
 * ADR-0053 Phase C1 — code-level CRITICAL_DENIES.
 *
 * These patterns are immutable: not editable via API, never overridden by any
 * DB rule, never bypassed by `--dangerously-skip-permissions`. They guard the
 * cases where a single mistaken tool-call could destroy the cluster:
 *
 *   - filesystem nukes (rm -rf /)
 *   - fork bombs (resource exhaustion)
 *   - irreversible DB ops (DROP DATABASE)
 *   - irreversible git ops (force-push to main)
 *   - PROD restarts (kills the very process the hook runs in)
 *   - PROD-only writes (`make prod`, edits to dist/ or .env on the PROD host)
 *   - direct PROD DB access from a dev shell
 *
 * Matched against either `tool_name` alone (for MCP-style tools) or
 * `tool_name:command-or-path` (for Bash / Edit / Write). The hook builds the
 * subject string once and runs all patterns against it.
 *
 * NEVER edit a deny pattern out of this file to "unblock" an agent. If an
 * agent legitimately needs to run something here, the answer is a human
 * running it, not a deny removal.
 *
 * Making a pattern MORE PRECISE is a different thing and is allowed: a rule
 * that refuses commands it was never meant to cover trains agents to route
 * around the guard, which costs more safety than it buys. Precision work must
 * arrive with tests that pin both halves — what is still refused, and what is
 * now correctly permitted (see __tests__/critical-denies.test.js).
 */

import { literalDocumentCommand } from './literal-document.js';

/**
 * pm2 subcommands that only READ state. None of them can stop, restart or
 * otherwise disturb a process, so a command containing one must never be
 * refused — no matter what else the shell line mentions.
 */
export const PM2_READ_ONLY_SUBCOMMANDS = Object.freeze([
  'list', 'ls', 'l', 'status', 'jlist', 'prettylist',
  'describe', 'desc', 'show', 'info', 'env', 'id',
  'logs', 'log', 'monit', 'report', 'ping', 'pid', 'inspect',
]);

/**
 * pm2 subcommands that MUTATE process state. These are refused when they can
 * reach the godcrm process — which is the very worker this agent runs inside.
 */
export const PM2_MUTATING_SUBCOMMANDS = Object.freeze([
  'restart', 'reload', 'gracefulreload', 'stop', 'delete', 'del',
  'kill', 'update', 'scale', 'resurrect', 'sendsignal',
  'startorrestart', 'startorreload', 'startorgracefulreload',
]);

/**
 * `pm2 kill` and `pm2 update` act on the DAEMON, not on a named app: they take
 * godcrm down without ever naming it. Refused whether or not a target follows.
 */
const PM2_DAEMON_WIDE = Object.freeze(['kill', 'update']);

/**
 * Split a shell line into command segments on the separators that start a new
 * command: `;` `&&` `||` `|` `&` and newlines. Deliberately naive — quoting and
 * here-docs are not parsed. That is the safe direction: an unsplit segment is a
 * LONGER string, so a mutating pm2 call stays inside it and is still caught.
 */
function shellSegments(command) {
  return String(command).split(/(?:\|\||&&|[;\n|&]|\$\(|`)+/);
}

/**
 * True when this bash command contains a pm2 invocation that mutates process
 * state and can reach godcrm.
 *
 * Per segment: find `pm2` used as a command word, skip its leading flags, read
 * the subcommand, then decide.
 *   - read-only subcommand      → never denied
 *   - daemon-wide (kill)        → denied, target or not
 *   - mutating + godcrm/all     → denied
 *   - mutating + another app    → allowed (restarting deploy-bot is not fatal)
 *   - unknown subcommand        → allowed (matches the previous default-allow)
 */
export function deniesPm2Mutation(command) {
  for (const segment of shellSegments(command)) {
    // The pm2 token must start a word (optionally behind `sudo` and/or a path
    // such as /usr/bin/pm2), so `.pm2_env.restart_time` in a jq filter is not
    // mistaken for an invocation.
    const m = /(?:^|[\s"'])(?:sudo\s+(?:-\S+\s+)*)?(?:\S*\/)?pm2\b(.*)$/.exec(segment);
    if (!m) continue;

    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
    // Skip pm2's own leading flags (`pm2 --no-daemon restart godcrm`).
    let i = 0;
    while (i < tokens.length && tokens[i].startsWith('-')) i += 1;
    const sub = tokens[i];
    if (!sub) continue; // bare `pm2` — prints help

    const verb = sub.toLowerCase();
    if (PM2_READ_ONLY_SUBCOMMANDS.includes(verb)) continue;
    if (!PM2_MUTATING_SUBCOMMANDS.map((v) => v.toLowerCase()).includes(verb)) continue;

    if (PM2_DAEMON_WIDE.includes(verb)) return true;

    const rest = tokens.slice(i + 1);
    if (rest.length === 0) return true;                       // ambiguous → refuse
    if (rest.some((t) => /^(all|--all)$/i.test(t))) return true;
    if (rest.some((t) => /\bgodcrm\b/.test(t))) return true;
    // Also catch an ecosystem file, which restarts every app it declares.
    if (rest.some((t) => /ecosystem[^\s]*\.(c?js|json|ya?ml)$/i.test(t))) return true;
  }
  return false;
}

// Each entry: { id, subject, reason } plus EITHER `pattern` (RegExp) or `test`
// (predicate over the subject string, for rules a regex states badly).
// `subject` selects what string we test:
//   - 'bash'   → tool_input.command (Bash tool only)
//   - 'path'   → tool_input.file_path (Edit/Write)
//   - 'tool'   → tool_name itself (for catch-all by tool)
export const CRITICAL_DENIES = Object.freeze([
  // ── 1. Filesystem nukes ──────────────────────────────────────────────────
  {
    id: 'fs-rm-rf-root',
    subject: 'bash',
    // Matches: rm -rf / ; rm -rf /foo ; rm -rf ~ ; rm -rf ~/x ; rm -rf $HOME
    // Avoids matching rm -rf /tmp/foo by anchoring `/` to end-of-string or
    // requiring it to NOT be followed by `tmp/`, `home/`, etc — too brittle;
    // instead allow any `/` target except a clearly-safe subtree.
    pattern: /(^|[\s;&|])rm\s+(-[rRfv]+\s+)*(--no-preserve-root\s+)?(\/(\s|$|;|&)|\/(?!tmp\/|var\/log\/|var\/cache\/)[^\s]|\/\*|\/\.|\$HOME($|[\s/;&|])|~($|[\s/;&|]))/,
    reason: 'Refused: rm -rf targeting root, $HOME, or ~ — destroys the host.',
  },

  // ── 2. Fork bombs / resource exhaustion ──────────────────────────────────
  {
    id: 'fs-fork-bomb',
    subject: 'bash',
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'Refused: classic shell fork bomb (:(){ :|:& };:) — exhausts host.',
  },

  // ── 3. Irreversible DB ops ───────────────────────────────────────────────
  {
    id: 'db-drop-database',
    subject: 'bash',
    pattern: /\bDROP\s+DATABASE\b/i,
    reason: 'Refused: DROP DATABASE — destroys the godcrm_prod cluster.',
  },
  {
    id: 'db-drop-schema-cascade',
    subject: 'bash',
    pattern: /\bDROP\s+SCHEMA\s+\S+\s+CASCADE\b/i,
    reason: 'Refused: DROP SCHEMA … CASCADE — cluster-wide data loss.',
  },

  // ── 4. Irreversible git ops on main ──────────────────────────────────────
  {
    id: 'git-force-push-main',
    subject: 'bash',
    pattern: /\bgit\s+push\s+([^&|;]*\s)?(--force\b|-f\b|--force-with-lease\b).*\bmain\b/,
    reason: 'Refused: force-push to main — rewrites shared history.',
  },
  {
    id: 'git-push-mirror',
    subject: 'bash',
    pattern: /\bgit\s+push\s+([^&|;]*\s)?--mirror\b/,
    reason: 'Refused: git push --mirror — wipes remote refs.',
  },

  // ── 5. PROD process restarts (kills our own process group) ───────────────
  {
    id: 'pm2-restart-godcrm-prod',
    subject: 'bash',
    // Verb-anchored, per-segment. The old form was
    //   /\bpm2\s+(restart|reload|stop|delete|kill)\b.*\bgodcrm\b/
    // which tested the WHOLE command string: a read-only `pm2 jlist` chained
    // with anything that later said "godcrm" (a path, a grep, a second pm2
    // call) was refused as if it were a restart. Agents lost `pm2 jlist` /
    // `pm2 describe` in composite commands and fell back to parsing `pm2 list`.
    // It also let `pm2 kill` through whenever the word godcrm was absent —
    // and `pm2 kill` takes no target: it kills the daemon, godcrm included.
    // `pm2ReadOnly` splits on shell separators and classifies each pm2
    // invocation by its actual subcommand. See the helper for the verb lists.
    test: deniesPm2Mutation,
    reason: 'Refused: pm2 restart/reload/stop/delete/kill of godcrm — kills the worker that spawned this agent. Read-only pm2 (list, jlist, describe, logs, …) is allowed.',
  },
  {
    id: 'systemctl-godcrm',
    subject: 'bash',
    pattern: /\bsystemctl\s+(restart|reload|stop|disable)\b.*\b(godcrm|business-crm|nginx|postgresql)\b/,
    reason: 'Refused: systemctl restart of godcrm/nginx/postgres — service-level outage.',
  },

  // ── 6. PROD deploys & PROD-only writes ───────────────────────────────────
  {
    id: 'make-prod',
    subject: 'bash',
    pattern: /\bmake\s+prod\b/,
    reason: 'Refused: `make prod` rebuilds + restarts PROD — only humans run this.',
  },
  {
    id: 'edit-env',
    subject: 'path',
    pattern: /(^|\/)\.env(\.[a-z]+)?$/,
    reason: 'Refused: editing .env — secrets/keys belong in Settings → Secrets (vault).',
  },
  {
    id: 'edit-dist',
    subject: 'path',
    pattern: /(^|\/)dist\//,
    reason: 'Refused: editing dist/ — build artifact, regenerated by `npm run build`.',
  },

  // ── 7. Dependency mutation in deploy posture ─────────────────────────────
  {
    id: 'npm-install-production',
    subject: 'bash',
    pattern: /\bnpm\s+(install|i|ci)\b[^&|;]*--production\b/,
    reason: 'Refused: `npm install --production` — strips vite/plugin-react needed for build.',
  },

  // ── 8. Direct PROD DB access (use the API; never bypass with raw psql) ───
  {
    id: 'psql-prod-host',
    subject: 'bash',
    // `\b` doesn't match between space and `-` (both non-word), so use \s.
    pattern: /(^|[\s;&|])psql\b[^&|;]*(\s-h|--host[= ])\s*(109\.107\.184\.205|crm\.hltrn\.cc)\b/,
    reason: 'Refused: direct psql to PROD host — schema/data writes must go through /api/v3.',
  },
]);

/**
 * Build the test subject for a given (tool_name, tool_input) pair.
 * Returns one of `{ bash, path, tool }` keys → string to match.
 *
 * For tools we don't know how to read, we still expose `tool` so a
 * catch-all by tool name (e.g. mcp__claude_ai_*) can deny.
 */
export function buildSubjects(toolName, toolInput) {
  const subjects = { tool: String(toolName || '') };
  if (!toolInput || typeof toolInput !== 'object') return subjects;
  if (typeof toolInput.command === 'string') subjects.bash = toolInput.command;
  if (typeof toolInput.file_path === 'string') subjects.path = toolInput.file_path;
  return subjects;
}

/**
 * Test all CRITICAL_DENIES against a (tool_name, tool_input).
 * Returns the first match or null. Order matches the array above.
 *
 * @param {string} toolName
 * @param {object} toolInput
 * @returns {{ id: string, reason: string }|null}
 */
export function matchCriticalDeny(toolName, toolInput) {
  const subjects = buildSubjects(toolName, toolInput);
  // Only literal cat-to-document heredocs omit their inert body here.
  // Keep buildSubjects raw for server DB policies and audit.
  if (subjects.bash != null) subjects.bash = literalDocumentCommand(subjects.bash);
  for (const rule of CRITICAL_DENIES) {
    const subject = subjects[rule.subject];
    if (subject == null) continue;
    const hit = typeof rule.test === 'function'
      ? rule.test(subject)
      : rule.pattern.test(subject);
    if (hit) {
      return { id: rule.id, reason: rule.reason };
    }
  }
  return null;
}
