#!/usr/bin/env node
// A stand-in for the `codex` binary, used by `agent-permission-hook.codex.db.test.js` through the
// REAL `executeCodexCli` adapter (CODEX_CLI_BIN points here). It speaks exactly the slice of the
// Codex CLI surface the adapter and the hook rely on:
//   * `exec - --json ... -o <file>` and the `-c hooks.PreToolUse=[{..., command="node <hook>"}]`
//     TOML the adapter passes; the prompt arrives on stdin and is ignored.
//   * The PreToolUse protocol as probed on this box (cli-providers.js, 2026-09-07): the hook
//     command runs with the tool call as JSON on stdin and the CLI's env; a `deny` JSON on stdout
//     blocks the tool ("Tool call blocked by PreToolUse hook: <reason>"), EMPTY stdout lets it run.
//   * JSONL events `item.started` / `item.completed` (mcp_tool_call, agent_message) and
//     `turn.completed`, the final message in the `-o` file.
// The "tool" it tries to call writes the file named by FAKE_TOOL_MARKER — so a test can tell
// whether the call really ran or was really blocked, which no inspection of hook JSON can show.
// No model, no network: the final message is FAKE_CLI_REPLY (default: a valid Neo16 evaluation).

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const outFile = argv[argv.indexOf('-o') + 1];
const hookToml = argv.filter((a, i) => argv[i - 1] === '-c' && a.startsWith('hooks.PreToolUse=')).pop() ?? '';
const hookCommandMatch = hookToml.match(/command=("(?:[^"\\]|\\.)*")/);
const hookCommand = hookCommandMatch ? JSON.parse(hookCommandMatch[1]) : null;

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const toolCall = { tool_name: 'mcp__godcrm__add_table_row', tool_input: { table_id: 1, data: { from: 'fake-codex' } } };

// Drain stdin (the prompt) like the real CLI would, then act.
let drained = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { drained += c; });
process.stdin.on('end', () => {
  emit({ type: 'item.started', item: { id: 'call_1', type: 'mcp_tool_call', server: 'godcrm', tool: 'add_table_row', arguments: toolCall.tool_input } });

  let decision = { allowed: true, reason: null, hookStderr: '' };
  if (hookCommand) {
    const hook = spawnSync('sh', ['-c', hookCommand], {
      input: JSON.stringify({ session_id: 'fake-codex-session', hook_event_name: 'PreToolUse', cwd: process.cwd(), ...toolCall }),
      env: process.env, encoding: 'utf8', timeout: 10_000,
    });
    const out = (hook.stdout || '').trim();
    decision.hookStderr = hook.stderr || '';
    if (out) {
      try {
        const parsed = JSON.parse(out);
        if (parsed?.hookSpecificOutput?.permissionDecision === 'deny') {
          decision = { allowed: false, reason: parsed.hookSpecificOutput.permissionDecisionReason || '', hookStderr: decision.hookStderr };
        }
      } catch { /* non-JSON stdout: the real CLI logs "PreToolUse Failed" and proceeds */ }
    }
  }

  if (decision.allowed) {
    if (process.env.FAKE_TOOL_MARKER) writeFileSync(process.env.FAKE_TOOL_MARKER, JSON.stringify({ ran: true, at: new Date().toISOString(), hookStderr: decision.hookStderr }));
    emit({ type: 'item.completed', item: { id: 'call_1', type: 'mcp_tool_call', result: { ok: true } } });
  } else {
    emit({ type: 'item.completed', item: { id: 'call_1', type: 'mcp_tool_call', error: `Tool call blocked by PreToolUse hook: ${decision.reason}` } });
  }

  const reply = process.env.FAKE_CLI_REPLY || JSON.stringify({
    intent: { name: 'ask_time', confidence: 0.9 }, npc_response: 'She is free on Thursday at two.', feedback: [], grammar_errors: [], vocabulary: [],
  });
  emit({ type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text: reply } });
  if (outFile) writeFileSync(outFile, reply);
  emit({ type: 'turn.completed', usage: { input_tokens: drained.length, output_tokens: reply.length, cached_input_tokens: 0 } });
  process.exit(0);
});
