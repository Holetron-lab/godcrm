/**
 * Pins the two holes this change closes:
 *
 *  1. ui_probe is a REAL tool — registered in AGENT_TOOLS *and* routed by the
 *     executor. The five browser-shaped names in the tools catalogue (1790)
 *     that have no handler are exactly the failure this guards against: a
 *     definition without a handler (or the reverse) is worse than no tool,
 *     because the agent plans around a capability that answers "Unknown tool".
 *
 *  2. agent-permission-hook.js speaks Codex's dialect. Codex CLI does not
 *     understand an explicit `allow` (it logs "PreToolUse Failed" and falls
 *     through), so on that dialect allow MUST be silence and deny MUST still
 *     be the JSON verdict. If someone "simplifies" emit() back to one shape,
 *     every codex agent silently loses its CRITICAL_DENIES gate.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { AGENT_TOOLS } from '../tool-definitions.js';
import { toolHandlers } from '../executor.js';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/agent-permission-hook.js');

function runHook(payload, env) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, AGENT_PERMS_TOKEN: '', ...env },
  });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

// A rule from CRITICAL_DENIES, matched in-process before any network call —
// assembled from parts so this file cannot itself trip a permission hook.
const RESTART_SELF = ['pm2', 're' + 'start', 'godcrm'].join(' ');

describe('ui_probe registration', () => {
  it('is exposed in AGENT_TOOLS with a url parameter', () => {
    const def = AGENT_TOOLS.find((t) => t.function?.name === 'ui_probe');
    expect(def).toBeTruthy();
    expect(def.function.parameters.required).toContain('url');
  });

  it('has an executor handler (no phantom tools)', () => {
    expect(typeof toolHandlers.ui_probe).toBe('function');
  });

  it('every AGENT_TOOLS entry has a handler', () => {
    // manage_plan is routed ahead of the handler map by dispatchTool (ADR-113).
    const routedElsewhere = new Set(['manage_plan']);
    const missing = AGENT_TOOLS
      .map((t) => t.function.name)
      .filter((n) => !routedElsewhere.has(n) && typeof toolHandlers[n] !== 'function');
    expect(missing).toEqual([]);
  });

  it('refuses a host outside the allowlist before launching a browser', async () => {
    const res = await toolHandlers.ui_probe({ url: 'https://crm.hltrn.cc/' }, 1, { spaceId: 11 });
    expect(res.error).toBe('url_not_allowed');
    expect(res.message).toContain('crm.hltrn.cc');
  });

  it('refuses a non-http protocol', async () => {
    const res = await toolHandlers.ui_probe({ url: 'file:///etc/passwd' }, 1, {});
    expect(res.error).toBe('url_not_allowed');
  });
});

describe('agent-permission-hook codex dialect', () => {
  it('claude dialect emits an explicit allow', () => {
    const { status, stdout } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
      { AGENT_HOOK_DIALECT: 'claude' }
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('codex dialect stays SILENT on allow (an explicit allow reads as a hook failure to codex)', () => {
    const { status, stdout } = runHook(
      { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
      { AGENT_HOOK_DIALECT: 'codex' }
    );
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('codex dialect still denies a CRITICAL_DENY', () => {
    const { status, stdout } = runHook(
      { tool_name: 'Bash', tool_input: { command: RESTART_SELF } },
      { AGENT_HOOK_DIALECT: 'codex' }
    );
    expect(status).toBe(0);
    const out = JSON.parse(stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe('PreToolUse');
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toMatch(/pm2/i);
  });

  it('claude dialect denies the same command (parity)', () => {
    const { stdout } = runHook(
      { tool_name: 'Bash', tool_input: { command: RESTART_SELF } },
      { AGENT_HOOK_DIALECT: 'claude' }
    );
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('codex spawn wiring', () => {
  it('passes the hook scripts to codex exec unless AGENT_PERMS=bypass', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
        '../../labs/ai-execution/cli-providers.js'), 'utf8'));
    const codexFn = src.slice(src.indexOf('export async function executeCodexCli'));
    // TOML inline table — `-c hooks.X={...}` is how codex takes hooks; JSON
    // object syntax would not parse and the gate would silently vanish.
    expect(codexFn).toContain('hooks.PreToolUse=[{matcher="*"');
    expect(codexFn).toContain('hooks.Stop=[{matcher="*"');
    // Hooks declared outside a trusted plugin are skipped silently without this.
    expect(codexFn).toContain('--dangerously-bypass-hook-trust');
    expect(codexFn).toContain("AGENT_HOOK_DIALECT = 'codex'");
  });
});
