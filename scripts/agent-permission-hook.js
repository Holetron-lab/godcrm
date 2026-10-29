#!/usr/bin/env node
/**
 * ADR-0053 Phase C2 — PreToolUse permission hook for spawned Claude CLI.
 *
 * Wired into the spawned `claude` process via:
 *   --settings '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[
 *     {"type":"command","command":"node /abs/path/to/scripts/agent-permission-hook.js"}
 *   ]}]}}'
 *
 * Contract (Claude Code hooks):
 *   stdin  → JSON: { session_id, transcript_path, cwd, hook_event_name,
 *                    tool_name, tool_input }
 *   stdout → JSON: { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                    permissionDecision: "allow"|"deny"|"ask",
 *                    permissionDecisionReason: "..." } }
 *   exit code 0 in all normal paths; exit 2 reserved for hard "fail-closed"
 *   transport errors (which we DO NOT want — see fail-open below).
 *
 * Pipeline:
 *   1. Parse stdin JSON. Bad input → fail-open allow + stderr log.
 *   2. Check CRITICAL_DENIES locally (zero deps, can't be bypassed even if
 *      the server is down). Match → deny.
 *   3. POST to localhost godcrm /api/v3/agent-permissions/check with the
 *      AGENT_PERMS_TOKEN inherited from parent env. 500ms timeout.
 *      Network/timeout error → fail-open allow + stderr log.
 *   4. Emit hookSpecificOutput JSON, exit 0.
 *
 * Why fail-open: this hook gates a long-lived background worker. A flaky
 * resolver shouldn't break Notion migrations or the Marketing kickoff.
 * CRITICAL_DENIES already covers the cases where failing closed matters,
 * and they're enforced before the network call. The server-side resolver
 * also keeps an audit trail of every decision — denials remain visible.
 *
 * Fail-CLOSED mode (opt-in per spawn): AGENT_PERMS_FAIL_CLOSED=1 in the child
 * env turns every degraded path above (bad stdin, no token, resolver
 * unreachable / non-2xx / timeout, uncaught error) into a deny. Set by the
 * launcher for runs whose agent must never gain a tool through an outage —
 * Neo16 NPC turns (backend/modules/neo16/learning/agentRun.js) are the first.
 * Fleet workers keep the documented fail-open default.
 *
 * AGENT_ID / SPACE_ID context: cli-providers.js Phase C3 will set them as
 * env vars when spawning claude. Until C3 lands, both are null and the
 * resolver falls through to global-scope rules only (which is fine — the
 * default-allow + CRITICAL_DENIES cover the safety floor).
 */

// IMPORTANT: keep this file zero-dep beyond Node core. We don't want a hook
// crash because of a stale node_modules in a worktree.

import { matchCriticalDeny } from '../backend/services/agent-permissions/critical-denies.js';

const HOOK_TIMEOUT_MS = 500;
const CHECK_URL = process.env.AGENT_PERMS_CHECK_URL || 'http://127.0.0.1:5000/api/v3/agent-permissions/check';
const TOKEN = process.env.AGENT_PERMS_TOKEN || '';
const AGENT_ID = process.env.AGENT_ID ? Number(process.env.AGENT_ID) : null;
const SPACE_ID = process.env.SPACE_ID ? Number(process.env.SPACE_ID) : null;

// Which CLI is calling us. cli-providers.js sets AGENT_HOOK_DIALECT=codex when
// it spawns `codex exec`; unset (or anything else) means Claude Code.
//
// Codex CLI 0.153.x implements the same PreToolUse wire contract, with one
// asymmetry probed on this box (2026-09-07, gpt-6-astra, --approve-for-me):
//   deny  → honoured verbatim for BOTH shell (tool_name "Bash") and MCP tools
//           ("mcp__godcrm__*"): "Tool call blocked by PreToolUse hook: <reason>"
//   allow → NOT understood. Codex logs "PreToolUse Failed" and falls through
//           to its own approval flow, i.e. our explicit allow degrades to
//           fail-open noise on every single tool call.
//   empty stdout → "PreToolUse Completed", tool proceeds. This is the clean
//           way to say "no objection" to Codex.
// Kimi Code 2.3.x supports the same deny JSON and silent allow. Never gate this
// shared hook on KIMI_CRM_MANAGED: Claude/Codex do not set that Kimi-only marker.
const DIALECT = (process.env.AGENT_HOOK_DIALECT || 'claude').toLowerCase();
const FAIL_CLOSED = /^(1|true|yes)$/i.test(process.env.AGENT_PERMS_FAIL_CLOSED || '');

/** A degraded path: allow by default (fleet), deny when the launcher asked for fail-closed. */
function degraded(reason) {
  return emit(FAIL_CLOSED ? 'deny' : 'allow', `hook: ${reason} — ${FAIL_CLOSED ? 'fail-closed' : 'fail-open'}`);
}

function emit(decision, reason) {
  if (DIALECT === 'codex' || DIALECT === 'kimi') {
    if (decision === 'allow') {
      // Silence = approved. Emitting the allow JSON here would make Codex log
      // "PreToolUse Failed" for every call and hide real hook breakage.
      process.exit(0);
    }
    // 'ask' has no meaning in a headless run — there is no human to ask, and
    // Codex would treat the unknown decision as a hook failure and proceed.
    // Deny it explicitly so an "ask" rule cannot silently become an allow.
    const codexReason = decision === 'ask'
      ? `${reason || 'policy requires approval'} (ask → deny: headless ${DIALECT} run, no approver)`
      : (reason || '');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: codexReason,
      },
    }));
    process.exit(0);
  }

  // Claude Code hook output schema (PreToolUse).
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision, // 'allow' | 'deny' | 'ask'
      permissionDecisionReason: reason || '',
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function logStderr(msg, extra) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), hook: 'agent-permission', msg, ...extra });
    process.stderr.write(line + '\n');
  } catch { /* ignore */ }
}

async function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

async function postCheck(payload) {
  // Use global fetch (Node 18+). Abort on timeout.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HOOK_TIMEOUT_MS);
  try {
    const r = await fetch(CHECK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-perms-token': TOKEN,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      logStderr('check endpoint non-2xx', { status: r.status });
      return null;
    }
    const j = await r.json();
    // success() wraps data: { success: true, data: {...} }
    return j?.data || j;
  } catch (err) {
    logStderr('check endpoint failed', { err: String(err?.message || err) });
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    logStderr('bad stdin JSON', { rawLen: raw.length });
    return degraded('bad stdin');
  }

  const toolName = String(input.tool_name || '');
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  // 1. Code-level CRITICAL_DENIES (defense-in-depth before any network call).
  const crit = matchCriticalDeny(toolName, toolInput);
  if (crit) {
    return emit('deny', crit.reason);
  }

  // 2. DB rules via local server.
  if (!TOKEN) {
    // No token in env → can't even authenticate to local server.
    return degraded('AGENT_PERMS_TOKEN unset');
  }

  const resp = await postCheck({
    tool_name: toolName,
    tool_input: toolInput,
    cwd: input.cwd || process.cwd(),
    agent_id: AGENT_ID,
    space_id: SPACE_ID,
    session_id: input.session_id || null, // ADR-0181: per-loop holder identity for write-reservations
    wp_id: process.env.WP_ID || null,     // ADR-0181: optional work-package tag (session_id alone suffices)
  });

  if (!resp || !resp.decision) {
    return degraded('resolver unreachable');
  }

  return emit(resp.decision, resp.reason || '');
}

main().catch((err) => {
  logStderr('hook crashed', { err: String(err?.message || err), stack: err?.stack });
  // Fleet default: a crash must not become a deny. Fail-closed launchers get the deny.
  degraded('uncaught error');
});
