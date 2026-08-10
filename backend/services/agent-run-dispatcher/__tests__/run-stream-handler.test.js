/**
 * ADR-150 P0 — runStreamHandler backstop behavior.
 *
 * Spawns a long-sleeping shell script as the runner stand-in (via
 * RUN_CLAUDE_SCRIPT_OVERRIDE) with `backstopMs=200`. The handler's wall-
 * clock guard MUST fire SIGTERM and the returned summary MUST carry
 * `terminalReason='backstop'` so the dispatcher can persist
 * `run_terminal_reason='backstop'` (vs the old generic 'timeout').
 *
 * Also exercises the `onMeaningfulEvent` callback ordering: it MUST fire
 * AFTER `onEvent` for every well-formed NDJSON line.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  runStreamHandler,
  DEFAULT_BACKSTOP_WARN_RATIO,
} from '../run-stream-handler.mjs';

let scriptDir;
let sleepScript;
let echoScript;

beforeAll(() => {
  scriptDir = mkdtempSync(join(tmpdir(), 'adr150-runstream-'));

  // Long-sleep script: ignores stdin, sleeps 30s. The 200ms backstop will
  // SIGTERM the group well before the sleep completes.
  sleepScript = join(scriptDir, 'sleep.sh');
  writeFileSync(sleepScript, '#!/bin/bash\ncat > /dev/null\nsleep 30\n', { mode: 0o755 });
  chmodSync(sleepScript, 0o755);

  // Echo script: emits 3 NDJSON lines and exits. Used to verify the
  // onMeaningfulEvent callback ordering vs onEvent.
  echoScript = join(scriptDir, 'echo.sh');
  const echoBody = [
    '#!/bin/bash',
    'cat > /dev/null',
    `echo '{"type":"info","message":"starting"}'`,
    `echo '{"type":"output","content":"thinking"}'`,
    `echo '{"type":"result","status":"success"}'`,
    'exit 0',
  ].join('\n');
  writeFileSync(echoScript, echoBody, { mode: 0o755 });
  chmodSync(echoScript, 0o755);
});

afterAll(() => {
  try { rmSync(scriptDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('runStreamHandler — backstop fires terminalReason=backstop', () => {
  it('backstopMs=200 + 30s sleep → SIGTERM, finalStatus=timeout, terminalReason=backstop', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99001,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 200,
        heartbeatMs: 60_000,  // suppress heartbeat noise
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(summary.finalStatus).toBe('timeout');
    expect(summary.terminalReason).toBe('backstop');
    // Real wall-clock kill: duration well past 200ms but well under 30s.
    expect(summary.durationMs).toBeGreaterThanOrEqual(200);
    expect(summary.durationMs).toBeLessThan(20_000);
  }, 30_000);
});

describe('runStreamHandler — onMeaningfulEvent ordering', () => {
  it('onMeaningfulEvent fires AFTER onEvent for each NDJSON line', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = echoScript;

    const trace = [];
    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99002,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 10_000,
        heartbeatMs: 60_000,
        onEvent: (evt) => { trace.push(['evt', evt.type]); },
        onMeaningfulEvent: (evt) => { trace.push(['meaningful', evt.type]); },
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(summary.finalStatus).toBe('success');
    expect(summary.eventCount).toBe(3);
    // Pairs come back in (evt, meaningful) order per line.
    expect(trace).toEqual([
      ['evt', 'info'],         ['meaningful', 'info'],
      ['evt', 'output'],       ['meaningful', 'output'],
      ['evt', 'result'],       ['meaningful', 'result'],
    ]);
  }, 30_000);

  it('onEvent throwing does not block onMeaningfulEvent', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = echoScript;

    const meaningfulSeen = [];
    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99003,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 10_000,
        heartbeatMs: 60_000,
        onEvent: () => { throw new Error('intentional onEvent failure'); },
        onMeaningfulEvent: (evt) => { meaningfulSeen.push(evt.type); },
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(summary.finalStatus).toBe('success');
    expect(meaningfulSeen).toEqual(['info', 'output', 'result']);
  }, 30_000);
});

describe('runStreamHandler — backstop warn (ADR-0042 Task 6)', () => {
  // backstopMs=400 + warnRatio=0.5 → warn at ~200ms, kill at ~400ms.
  // Picked tight values so the whole suite still completes well under
  // the 30s test timeout while leaving room for scheduler jitter.
  it('fires onBackstopWarn exactly once at the configured ratio', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    const warns = [];
    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99100,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 400,
        backstopWarnRatio: 0.5,
        heartbeatMs: 60_000,
        onBackstopWarn: (w) => warns.push(w),
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(summary.finalStatus).toBe('timeout');
    expect(summary.terminalReason).toBe('backstop');
    expect(warns).toHaveLength(1);
    const w = warns[0];
    expect(typeof w.at).toBe('string');
    expect(w.ratio).toBeCloseTo(0.5, 5);
    expect(w.thresholdMs).toBe(200);
    expect(w.backstopMs).toBe(400);
    expect(w.elapsedMs).toBeGreaterThanOrEqual(200);
    expect(w.elapsedMs).toBeLessThan(400);
  }, 30_000);

  it('falls back to DEFAULT_BACKSTOP_WARN_RATIO when ratio is omitted', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    const warns = [];
    try {
      await runStreamHandler({
        ticketId: 99101,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 400,
        // backstopWarnRatio omitted → default
        heartbeatMs: 60_000,
        onBackstopWarn: (w) => warns.push(w),
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(warns).toHaveLength(1);
    expect(warns[0].ratio).toBeCloseTo(DEFAULT_BACKSTOP_WARN_RATIO, 5);
    expect(warns[0].thresholdMs).toBe(Math.floor(400 * DEFAULT_BACKSTOP_WARN_RATIO));
  }, 30_000);

  it('does not fire when the run finishes before the warn threshold', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = echoScript; // exits ~immediately

    const warns = [];
    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99102,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 60_000,
        backstopWarnRatio: 0.5,    // warn at 30s — script exits well before
        heartbeatMs: 60_000,
        onBackstopWarn: (w) => warns.push(w),
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }

    expect(summary.finalStatus).toBe('success');
    expect(warns).toHaveLength(0);
  }, 30_000);

  it('still kills on backstop when onBackstopWarn callback throws', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99103,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 400,
        backstopWarnRatio: 0.5,
        heartbeatMs: 60_000,
        onBackstopWarn: () => { throw new Error('intentional warn failure'); },
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }
    expect(summary.finalStatus).toBe('timeout');
    expect(summary.terminalReason).toBe('backstop');
  }, 30_000);

  it('out-of-range ratios silently fall back to the default', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    const warns = [];
    try {
      await runStreamHandler({
        ticketId: 99104,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 400,
        backstopWarnRatio: 2.0,     // ≥1 → invalid → fallback to default
        heartbeatMs: 60_000,
        onBackstopWarn: (w) => warns.push(w),
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }
    expect(warns).toHaveLength(1);
    expect(warns[0].ratio).toBeCloseTo(DEFAULT_BACKSTOP_WARN_RATIO, 5);
  }, 30_000);

  it('skips warn entirely when no onBackstopWarn callback is provided', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99105,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        backstopMs: 400,
        backstopWarnRatio: 0.5,
        heartbeatMs: 60_000,
        // onBackstopWarn omitted — runner must not throw and kill must still fire.
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }
    expect(summary.finalStatus).toBe('timeout');
    expect(summary.terminalReason).toBe('backstop');
  }, 30_000);
});

describe('runStreamHandler — backstopMs aliases timeoutMs', () => {
  it('caller-supplied timeoutMs is honored when backstopMs is omitted', async () => {
    const prev = process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = sleepScript;

    let summary;
    try {
      summary = await runStreamHandler({
        ticketId: 99004,
        workspacePath: scriptDir,
        prompt: 'noop',
        agentId: '1',
        timeoutMs: 200,        // deprecated alias still works
        heartbeatMs: 60_000,
      });
    } finally {
      if (prev === undefined) delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;
      else process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = prev;
    }
    expect(summary.finalStatus).toBe('timeout');
    expect(summary.terminalReason).toBe('backstop');
  }, 30_000);
});
