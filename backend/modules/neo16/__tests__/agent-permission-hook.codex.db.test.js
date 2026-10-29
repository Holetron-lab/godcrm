// Neo16 W2-S4 — reviewer condition 2 + fix-round P1 "deny-all when the permission API fails".
//
// `maxTurns: 1` protects claude-code only; for a codex NPC the tool guard is the agent's deny
// policy through the SHARED PreToolUse hook — and, since the fix round, the hook runs FAIL-CLOSED
// for NPC spawns (AGENT_PERMS_FAIL_CLOSED=1 from `permissionsFailClosed: true`): no token,
// resolver unreachable, non-2xx, timeout, crash, bad stdin → deny. AGENT_PERMS=bypass is refused
// for such a run by the adapter itself.
//
// Two layers of proof, both on godcrm_test with the REAL `/api/v3/agent-permissions/check` router
// on a throw-away local port (never Ring 0's :5000):
//   1. the real hook script as a child, in both dialects, decision by decision;
//   2. the REAL `executeCodexCli` adapter spawning a stand-in `codex` binary
//      (`fixtures/fake-codex-cli.mjs`) that implements the CLI's PreToolUse protocol — the hook
//      command the adapter wires, run with the tool call on stdin; a deny JSON blocks the tool,
//      silence lets it run. The "tool" writes a marker file, so whether the call RAN is observed
//      on disk, not inferred from hook JSON. No real model, no network.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbGet, dbAll, dbRun, getAdapter, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import resolver from '../../../services/agent-permissions/resolver.js';
import agentPermissionsRouter from '../../../routes/v3/agent-permissions.js';
import { executeCodexCli } from '../../../services/labs/ai-execution/cli-providers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const HOOK = join(REPO_ROOT, 'scripts', 'agent-permission-hook.js');
const FAKE_CODEX = join(HERE, 'fixtures', 'fake-codex-cli.mjs');
const SLOW = 30_000;

// Synthetic agent ids far above the registry; the policy row is what the resolver keys on.
const NPC_AGENT_ID = 1_900_000_000 + Math.floor(Math.random() * 1_000_000);
const OTHER_AGENT_ID = NPC_AGENT_ID + 1;
const SPACE_ID = 70;

let server;
let checkUrl;
let policyId;
const aux = []; // throw-away http servers for the degraded paths
const BAD_STDIN = Symbol('bad-stdin');
let closedPortUrl;
let n = 0;

function runHook(env, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    if (payload === BAD_STDIN) child.stdin.end('not json at all'); else child.stdin.end(JSON.stringify(payload));
  });
}
const listen = (handler) => new Promise((r) => { const s = http.createServer(handler); aux.push(s); s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}/check`)); });

beforeAll(async () => {
  await resetAdapter();
  const db = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(db.db).toMatch(/_test$/);
  expect([null, '127.0.0.1', '::1']).toContain(db.host);

  const ins = await dbRun(
    `INSERT INTO _command_policies (scope, space_id, agent_id, tool_id, pattern, match_type, action, reason)
     VALUES ('global', NULL, ?, NULL, '.', 'regex', 'deny', 'neo16 2c test: NPC agents call no tools')`,
    [NPC_AGENT_ID],
  );
  policyId = ins.lastInsertRowid;

  await resolver.init({ adapter: await getAdapter() });
  const app = express();
  app.use('/api/v3/agent-permissions', agentPermissionsRouter);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  checkUrl = `http://127.0.0.1:${server.address().port}/api/v3/agent-permissions/check`;
  // A port nobody listens on: bind, read the port, close.
  closedPortUrl = await new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(`http://127.0.0.1:${p}/check`)); }); });
}, SLOW);

afterAll(async () => {
  await new Promise((r) => (server ? server.close(r) : r()));
  for (const s of aux) await new Promise((r) => s.close(r));
  await resolver.shutdown();
  if (policyId) await dbRun('DELETE FROM _command_policies WHERE id = ?', [policyId]);
  await dbRun('DELETE FROM _command_audit WHERE agent_id IN (?, ?)', [NPC_AGENT_ID, OTHER_AGENT_ID]);
  await destroyAdapter();
}, SLOW);

const env = (agentId, extra = {}) => ({
  AGENT_HOOK_DIALECT: 'codex', AGENT_ID: String(agentId), SPACE_ID: String(SPACE_ID),
  AGENT_PERMS_CHECK_URL: checkUrl, AGENT_PERMS_TOKEN: process.env.AGENT_PERMS_TOKEN, ...extra,
});
const call = (tool_name, tool_input) => ({ session_id: 'neo16-2c', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: '/tmp' });
const decisionOf = (r) => JSON.parse(r.out).hookSpecificOutput;

describe('Neo16 2c — codex NPC tool call is blocked by the shared PreToolUse hook (hook as a child)', () => {
  it('the NPC agent (deny-all policy) → deny JSON for an MCP tool and for Bash; the decision is audited', async () => {
    expect(process.env.AGENT_PERMS_TOKEN).toBeTruthy(); // minted by the router module, inherited by the child like the adapter does
    const mcp = await runHook(env(NPC_AGENT_ID), call('mcp__godcrm__add_table_row', { table_id: 1, data: { x: 1 } }));
    expect(mcp.code).toBe(0);
    expect(decisionOf(mcp)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(decisionOf(mcp).permissionDecisionReason).toContain(`Denied by policy rule #${policyId}`);

    const bash = await runHook(env(NPC_AGENT_ID), call('Bash', { command: 'ls -la /tmp' }));
    expect(decisionOf(bash).permissionDecision).toBe('deny');

    await new Promise((r) => setTimeout(r, 200)); // audit is written off the request path
    const audit = await dbAll('SELECT tool_name, decision, matched_rule_id FROM _command_audit WHERE agent_id = ? ORDER BY id', [NPC_AGENT_ID]);
    expect(audit).toEqual([
      { tool_name: 'mcp__godcrm__add_table_row', decision: 'deny', matched_rule_id: policyId },
      { tool_name: 'Bash', decision: 'deny', matched_rule_id: policyId },
    ]);
  }, SLOW);

  it('an agent WITHOUT the policy gets silence (= allow in the codex dialect): the deny comes from the agent row, so NPC agents must carry it', async () => {
    const r = await runHook(env(OTHER_AGENT_ID), call('mcp__godcrm__add_table_row', { table_id: 1, data: {} }));
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
  }, SLOW);

  it('code-level CRITICAL_DENIES still come first, before any DB rule, for an agent without a policy', async () => {
    const r = await runHook(env(OTHER_AGENT_ID), call('Bash', { command: 'pm2 restart godcrm' }));
    expect(decisionOf(r).permissionDecision).toBe('deny');
    expect(decisionOf(r).permissionDecisionReason).not.toContain('policy rule'); // CRITICAL_DENIES, before any DB rule
  }, SLOW);
});

describe('Fix round P1 — AGENT_PERMS_FAIL_CLOSED=1 turns every degraded path into a deny (both dialects)', () => {
  const tool = call('mcp__godcrm__add_table_row', { table_id: 1, data: {} });
  const degraded = async (label, extraEnv, payload = tool) => {
    for (const dialect of ['codex', 'claude']) {
      const r = await runHook({ ...env(OTHER_AGENT_ID, extraEnv), AGENT_HOOK_DIALECT: dialect, AGENT_PERMS_FAIL_CLOSED: '1' }, payload);
      expect(r.code, `${label}/${dialect} exit`).toBe(0);
      expect(decisionOf(r), `${label}/${dialect}`).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('fail-closed') });
    }
  };

  it('no token → deny', () => degraded('no-token', { AGENT_PERMS_TOKEN: '' }), SLOW);
  it('resolver unreachable (closed port) → deny', () => degraded('unreachable', { AGENT_PERMS_CHECK_URL: closedPortUrl }), SLOW);
  it('resolver answers non-2xx → deny', async () => {
    const url = await listen((_req, res) => { res.statusCode = 500; res.end('boom'); });
    await degraded('http-500', { AGENT_PERMS_CHECK_URL: url });
  }, SLOW);
  it('resolver hangs past the 500 ms hook timeout → deny', async () => {
    const url = await listen((_req, res) => { setTimeout(() => res.end('{"data":{"decision":"allow"}}'), 1_500); });
    await degraded('timeout', { AGENT_PERMS_CHECK_URL: url });
  }, SLOW);
  it('bad stdin → deny', () => degraded('bad-stdin', {}, BAD_STDIN), SLOW);

  it('the fleet default (flag unset) is unchanged: unreachable resolver → silence (codex) / allow (claude), labelled fail-open', async () => {
    const codex = await runHook(env(OTHER_AGENT_ID, { AGENT_PERMS_CHECK_URL: closedPortUrl }), tool);
    expect(codex.out).toBe('');
    const claude = await runHook({ ...env(OTHER_AGENT_ID, { AGENT_PERMS_CHECK_URL: closedPortUrl }), AGENT_HOOK_DIALECT: 'claude' }, tool);
    expect(decisionOf(claude)).toMatchObject({ permissionDecision: 'allow', permissionDecisionReason: expect.stringContaining('fail-open') });
  }, SLOW);
});

describe('Fix round P1 — the tool is blocked by the CLI itself: real executeCodexCli → stand-in codex → real hook → real resolver', () => {
  /** Run the REAL adapter with the stand-in binary; report whether the tool call actually ran (marker on disk). */
  async function runCodex({ agentId, env: extraEnv = {}, params = {} }) {
    const marker = join(tmpdir(), `neo16-fake-tool-${process.pid}-${++n}`);
    vi.stubEnv('CODEX_CLI_BIN', FAKE_CODEX);
    vi.stubEnv('FAKE_TOOL_MARKER', marker);
    vi.stubEnv('AGENT_PERMS_CHECK_URL', checkUrl);
    for (const [k, v] of Object.entries(extraEnv)) vi.stubEnv(k, v);
    const events = [];
    let pid = null;
    try {
      const result = await executeCodexCli({
        model: 'gpt-6-astra', messages: [{ role: 'user', content: 'When is she free?' }], systemPrompt: 'You are Nora.',
        agentId, spaceId: SPACE_ID, jobId: null, maxTurns: 1, permissionsFailClosed: true,
        onEvent: (e) => events.push(e), onSpawn: (p) => { pid = p; }, ...params,
      });
      return { result, events, pid, toolRan: existsSync(marker) };
    } finally {
      rmSync(marker, { force: true });
      vi.unstubAllEnvs();
    }
  }
  const toolResult = (events) => events.find((e) => e.type === 'user')?.message?.content?.[0]?.content ?? '';

  it('deny-all NPC agent, resolver up: the CLI blocks the MCP call (marker never written), the run still returns the final message', async () => {
    const { result, events, pid, toolRan } = await runCodex({ agentId: NPC_AGENT_ID });
    expect(pid).toEqual(expect.any(Number));
    expect(toolRan).toBe(false);
    expect(toolResult(events)).toContain('Tool call blocked by PreToolUse hook');
    expect(toolResult(events)).toContain(`Denied by policy rule #${policyId}`);
    expect(JSON.parse(result.content)).toMatchObject({ npc_response: 'She is free on Thursday at two.' });
    expect(result).toMatchObject({ model: 'gpt-6-astra', modelSource: 'requested' });
  }, SLOW);

  it('control — an agent with NO policy, resolver up: the stand-in honours the protocol and the tool RUNS (so the block above came from the hook)', async () => {
    const { toolRan, events } = await runCodex({ agentId: OTHER_AGENT_ID });
    expect(toolRan).toBe(true);
    expect(toolResult(events)).not.toContain('blocked');
  }, SLOW);

  it('resolver unreachable: a fail-closed run blocks the tool for BOTH the policy agent and the policy-less agent', async () => {
    for (const agentId of [NPC_AGENT_ID, OTHER_AGENT_ID]) {
      const { toolRan, events } = await runCodex({ agentId, env: { AGENT_PERMS_CHECK_URL: closedPortUrl } });
      expect(toolRan, `agent ${agentId}`).toBe(false);
      expect(toolResult(events)).toContain('fail-closed');
    }
  }, SLOW);

  it('resolver unreachable WITHOUT the fail-closed flag (fleet default): the tool runs — the flag is what closes the hole for NPCs', async () => {
    const { toolRan } = await runCodex({ agentId: OTHER_AGENT_ID, env: { AGENT_PERMS_CHECK_URL: closedPortUrl }, params: { permissionsFailClosed: false } });
    expect(toolRan).toBe(true);
  }, SLOW);

  it('AGENT_PERMS=bypass on the host: a fail-closed run is refused before anything is spawned', async () => {
    let spawned = false;
    await expect(runCodex({ agentId: NPC_AGENT_ID, env: { AGENT_PERMS: 'bypass' }, params: { onSpawn: () => { spawned = true; } } }))
      .rejects.toThrow(/AGENT_PERMS=bypass is not allowed/);
    expect(spawned).toBe(false);
  }, SLOW);

  it('an already-aborted signal: the adapter rejects with AbortError and spawns nothing', async () => {
    const ctrl = new AbortController();
    ctrl.abort('timeout');
    let spawned = false;
    await expect(runCodex({ agentId: NPC_AGENT_ID, params: { signal: ctrl.signal, onSpawn: () => { spawned = true; } } }))
      .rejects.toMatchObject({ name: 'AbortError', message: expect.stringContaining('timeout') });
    expect(spawned).toBe(false);
  }, SLOW);
});
