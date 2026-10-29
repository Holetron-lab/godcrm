// Neo16 W2-S4 — process identity, kill-and-wait (no DB). Fix round after the 2c review:
//
//   P1 "PID reuse": a pid recorded on a turn may be recycled after a server restart. The runner
//   kills only the EXACT process it spawned — /proc start ticks + boot id — never "any CLI that is
//   not older than spawned_at". A newer foreign CLI on the same pid must be left alone.
//   P1 "kill ≠ stop": sending a signal is not an exit. `reapExecution` waits until the process is
//   gone (the shared killProcessTree escalates SIGTERM → SIGKILL at 5 s) and refuses to let a new
//   attempt spawn while the old one lives. Proven on REAL children of this test: a `sleep` posing
//   as `codex` (argv[0]), one of them ignoring SIGTERM so only the SIGKILL ends it.
//   Also pins contract 6.10: the module never imports the invocation or job dispatcher.

import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPid, isOurCliProcess, reapExecution, killCancelledRuns } from '../learning/agentRun.js';
import { killProcessTree } from '../../../services/labs/ai-execution/process-management.js';

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOT = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A real child whose argv[0] is `codex` (so it passes the CLI check) but which is only `sleep`. */
function spawnFakeCli({ ignoreTerm = false } = {}) {
  const script = `${ignoreTerm ? 'trap "" TERM; ' : ''}exec -a codex sleep 30`;
  const child = spawn('bash', ['-c', script], { stdio: 'ignore', detached: true }); // group leader → killProcessTree(-pid)
  child.unref();
  return child;
}
const exited = (child) => new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));

describe('Neo16 — process identity (P1: pid reuse)', () => {
  const live = (args, startTicks, bootId = BOOT) => ({ alive: true, args, startTicks, bootId });
  const ours = { pid: 4242, proc_start_ticks: 500_000, proc_boot_id: BOOT };

  it('kills only the exact process: same start ticks + same boot + claude/codex argv', () => {
    for (const args of ['claude -p --output-format stream-json', 'node /usr/local/bin/claude -p', '/root/.local/bin/codex exec - --json', 'codex exec - --json --skip-git-repo-check']) {
      expect(isOurCliProcess(live(args, 500_000), ours)).toBe(true);
    }
    for (const args of ['node server.js', 'node /root/production/business-crm/backend/server.js', 'claude-code-helper --serve', 'sleep 30', '/usr/bin/python3 /opt/ops/executor.py']) {
      expect(isOurCliProcess(live(args, 500_000), ours)).toBe(false);
    }
  });

  it('a NEWER foreign CLI that got our pid is not ours; neither is an older one, another boot, or a pid with no identity recorded', () => {
    expect(isOurCliProcess(live('codex exec - --json', 500_001), ours)).toBe(false); // started after ours → recycled pid
    expect(isOurCliProcess(live('codex exec - --json', 499_999), ours)).toBe(false); // started before ours
    expect(isOurCliProcess(live('codex exec - --json', 500_000, 'other-boot'), ours)).toBe(false);
    expect(isOurCliProcess(live('codex exec - --json', 500_000), { pid: 4242, spawned_at: new Date().toISOString() })).toBe(false); // 2c-style record: no identity → never
    expect(isOurCliProcess(live('codex exec - --json', 500_000), { pid: 4242, proc_start_ticks: 500_000, proc_boot_id: '' })).toBe(false);
    expect(isOurCliProcess({ alive: false }, ours)).toBe(false);
    expect(isOurCliProcess(live(null, 500_000), ours)).toBe(false);
  });

  it('inspectPid reports a live child with a stable identity, and nothing once it is gone', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      await sleep(50);
      const a = await inspectPid(child.pid);
      expect(a).toMatchObject({ alive: true, args: 'sleep 30', bootId: BOOT });
      expect(Number.isInteger(a.startTicks) && a.startTicks > 0).toBe(true);
      expect(await inspectPid(child.pid)).toEqual(a); // identity does not drift
    } finally {
      child.kill('SIGKILL');
    }
    await exited(child);
    await sleep(30);
    expect(await inspectPid(child.pid)).toEqual({ alive: false });
    expect(await inspectPid(0)).toEqual({ alive: false });
    expect(await inspectPid(NaN)).toEqual({ alive: false });
  }, 15_000);
});

describe('Neo16 — reap: kill and WAIT (P1: kill ≠ stop)', () => {
  it('a live child that only looks like a CLI by argv but has another identity is never killed (fake registry)', async () => {
    const kill = vi.fn();
    const inspect = (info) => ({ inspectPid: async () => info, kill, reapTimeoutMs: 200, pollMs: 10 });
    const exec = { pid: 4242, turn_id: 1, proc_start_ticks: 77, proc_boot_id: BOOT };
    expect(await reapExecution(exec, inspect({ alive: true, args: 'codex exec - --json', startTicks: 78, bootId: BOOT }))).toBe(false); // newer foreign codex
    expect(await reapExecution(exec, inspect({ alive: true, args: 'node server.js', startTicks: 77, bootId: BOOT }))).toBe(false);
    expect(await reapExecution(exec, inspect({ alive: false }))).toBe(false);
    expect(await reapExecution({ ...exec, pid: null }, inspect({ alive: true, args: 'codex', startTicks: 77, bootId: BOOT }))).toBe(false);
    expect(await killCancelledRuns([{ id: 1, execution: exec }, { id: 2, execution: null }], inspect({ alive: true, args: 'codex exec', startTicks: 78, bootId: BOOT }))).toBe(0);
    expect(kill).not.toHaveBeenCalled();
  });

  it('a process that does not die within the reap window makes the reclaim FAIL instead of spawning beside it', async () => {
    const kill = vi.fn(); // signal sent, process ignores it
    const exec = { pid: 4242, turn_id: 2, proc_start_ticks: 77, proc_boot_id: BOOT };
    const d = { inspectPid: async () => ({ alive: true, args: 'codex exec - --json', startTicks: 77, bootId: BOOT }), kill, reapTimeoutMs: 250, pollMs: 20 };
    const t0 = Date.now();
    await expect(reapExecution(exec, d)).rejects.toMatchObject({ exit: 'reap_failed', code: 'EVALUATION_FAILED', status: 502 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('a process that dies LATE is waited for: reap returns only after the registry says it is gone', async () => {
    let alive = true;
    const kill = vi.fn(() => { setTimeout(() => { alive = false; }, 300); }); // SIGTERM handled slowly
    const exec = { pid: 4242, turn_id: 3, proc_start_ticks: 77, proc_boot_id: BOOT };
    const d = { inspectPid: async () => (alive ? { alive: true, args: 'codex exec - --json', startTicks: 77, bootId: BOOT } : { alive: false }), kill, reapTimeoutMs: 2_000, pollMs: 20 };
    const t0 = Date.now();
    expect(await reapExecution(exec, d)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
    expect(alive).toBe(false);
  });

  it('REAL child posing as codex: identity is captured from /proc, the real killProcessTree ends it, reap returns after the exit', async () => {
    const child = spawnFakeCli();
    await sleep(80);
    const info = await inspectPid(child.pid);
    expect(info).toMatchObject({ alive: true, args: 'codex 30', bootId: BOOT });
    const execution = { pid: child.pid, turn_id: 4, proc_start_ticks: info.startTicks, proc_boot_id: BOOT, spawned_at: new Date().toISOString() };
    const kill = vi.fn((pid) => killProcessTree(pid));
    expect(await reapExecution(execution, { kill, reapTimeoutMs: 7_000, pollMs: 25 })).toBe(true);
    expect(kill).toHaveBeenCalledWith(child.pid);
    expect(await inspectPid(child.pid)).toEqual({ alive: false });
    await exited(child);
  }, 15_000);

  it('REAL child posing as codex that IGNORES SIGTERM: reap waits through the shared SIGKILL escalation (~5 s) and only then returns', async () => {
    const child = spawnFakeCli({ ignoreTerm: true });
    await sleep(120);
    const info = await inspectPid(child.pid);
    expect(info).toMatchObject({ alive: true, args: 'codex 30' });
    const execution = { pid: child.pid, turn_id: 5, proc_start_ticks: info.startTicks, proc_boot_id: BOOT };
    const t0 = Date.now();
    expect(await reapExecution(execution, { kill: (pid) => killProcessTree(pid), reapTimeoutMs: 8_000, pollMs: 50 })).toBe(true);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(4_500); // SIGTERM was ignored; SIGKILL fires at 5 s
    expect(await inspectPid(child.pid)).toEqual({ alive: false });
    await exited(child);
  }, 20_000);

  it('REAL child: a stale identity (as if the pid were recycled) is left alive', async () => {
    const child = spawnFakeCli();
    try {
      await sleep(80);
      const info = await inspectPid(child.pid);
      const recycled = { pid: child.pid, turn_id: 6, proc_start_ticks: info.startTicks - 1, proc_boot_id: BOOT };
      const kill = vi.fn((pid) => killProcessTree(pid));
      expect(await reapExecution(recycled, { kill, reapTimeoutMs: 500, pollMs: 25 })).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      expect((await inspectPid(child.pid)).alive).toBe(true);
    } finally {
      killProcessTree(child.pid);
    }
    await exited(child);
  }, 15_000);
});

describe('Neo16 — module boundary', () => {
  it('contract 6.10 / §2: the module never imports the invocation dispatcher, the job dispatcher or the MCP server', () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); } else if (/\.(js|mjs|cjs)$/.test(name)) files.push(p);
      }
    };
    walk(MODULE_DIR);
    expect(files.length).toBeGreaterThan(5);
    const forbidden = [/invocation-dispatcher/, /agent-job\/create\.js/, /createAndDispatchJob/, /mcp-server\.js/, /single-active\.js/];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const imports = src.split('\n').filter((l) => /^\s*(import\b|export\s+.*\bfrom\b|.*\bimport\()/.test(l));
      for (const re of forbidden) expect(imports.some((l) => re.test(l)), `${f} imports ${re}`).toBe(false);
    }
  });
});
