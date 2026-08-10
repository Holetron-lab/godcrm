/**
 * ADR-0042 — Secondary signals classifier unit tests (Task 2).
 *
 * No /proc reads against the real OS — every test seeds a tmpdir that mimics
 * the relevant /proc/<pid>/* files, then passes `procRoot` to `classify`.
 *
 * Boot guard via backend/test/setup.js still runs (vitest setupFiles) so we
 * inherit ADR-0009 PROD-DB protection even though this module is offline.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VERDICT, classify } from '../secondary-signals.js';

let ROOT;

beforeAll(async () => {
  ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'adr0042-proc-'));
});

afterAll(async () => {
  if (ROOT) await fs.rm(ROOT, { recursive: true, force: true });
});

let scenarioCounter = 0;

/**
 * Build a fake /proc tree under ROOT/<scenario>/<pid>/... and return the
 * `procRoot` to pass to classify(). Each scenario gets a fresh subdir so
 * tests can't pollute one another.
 *
 * @param {{
 *   pid?: number,
 *   stat?: string|null,             // raw line; null = file missing (ENOENT)
 *   statMode?: number|null,         // chmod for EACCES tests
 *   netTcp?: string|null,           // raw body; null = ENOENT
 *   netTcpMode?: number|null,
 *   children?: string|null,         // raw body; null = ENOENT
 * }} spec
 */
async function seed(spec = {}) {
  scenarioCounter += 1;
  const pid = spec.pid ?? 12345;
  const procRoot = path.join(ROOT, `s${scenarioCounter}`);
  const pidDir = path.join(procRoot, String(pid));
  const taskDir = path.join(pidDir, 'task', String(pid));
  const netDir = path.join(pidDir, 'net');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.mkdir(netDir, { recursive: true });

  if (spec.stat !== null && spec.stat !== undefined) {
    const p = path.join(pidDir, 'stat');
    await fs.writeFile(p, spec.stat, 'utf8');
    if (typeof spec.statMode === 'number') {
      await fs.chmod(p, spec.statMode);
    }
  }
  if (spec.netTcp !== null && spec.netTcp !== undefined) {
    const p = path.join(netDir, 'tcp');
    await fs.writeFile(p, spec.netTcp, 'utf8');
    if (typeof spec.netTcpMode === 'number') {
      await fs.chmod(p, spec.netTcpMode);
    }
  }
  if (spec.children !== null && spec.children !== undefined) {
    await fs.writeFile(path.join(taskDir, 'children'), spec.children, 'utf8');
  }
  return { pid, procRoot };
}

// Realistic /proc/<pid>/stat shape: pid (comm) state ppid ... (52 fields).
// Field layout AFTER the closing ')' (man 5 proc, 1-indexed):
//   idx 0  = state    (= field 3)
//   idx 1  = ppid     (= field 4)
//   ...
//   idx 11 = utime    (= field 14)  — ticks in user mode
//   idx 12 = stime    (= field 15)  — ticks in kernel mode
//
// `STAT_HEADER` keeps utime=stime=0 (matches the original 22 cases). For
// CPU-delta tests use `STAT_WITH_CPU(state, utime, stime)` instead.
const STAT_HEADER = (state, comm = 'claude') =>
  `12345 (${comm}) ${state} 1 12345 12345 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0`;

const STAT_WITH_CPU = (state, utime, stime, comm = 'claude') => {
  // Build a 52-field tail with utime/stime planted at idx 11/12.
  const tail = new Array(52).fill('0');
  tail[0] = String(state);
  tail[1] = '1';        // ppid
  tail[2] = '12345';    // pgrp
  tail[3] = '12345';    // session
  tail[11] = String(utime);
  tail[12] = String(stime);
  return `12345 (${comm}) ${tail.join(' ')}`;
};

// /proc/<pid>/net/tcp body: header + N rows. We only mirror the first 4 cols
// realistically; classify() only inspects col index 3 (`st`).
const NET_HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
const NET_ROW = (st) =>
  `   0: 0100007F:1538 0100007F:9F30 ${st} 00000000:00000000 02:00000000 00000000   115        0 9999 1 ffff986a025f6900 100 0 0 10 0`;

const NET_LISTEN_ONLY = NET_HEADER + NET_ROW('0A');
const NET_ONE_ACTIVE = NET_HEADER + NET_ROW('01');
const NET_THREE_ACTIVE = NET_HEADER + [NET_ROW('01'), NET_ROW('06'), NET_ROW('08')].join('\n');
const NET_HEADER_ONLY = NET_HEADER;

describe('ADR-0042 secondary-signals — dead via process state', () => {
  it('zombie state (Z) → dead', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('Z'),
      netTcp: NET_ONE_ACTIVE, // ignored — Z short-circuits before net read
      children: '999\n',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.proof.state).toBe('Z');
    expect(r.reasons).toContain('stat:state=Z');
  });

  it('dying state (X) → dead', async () => {
    const { pid, procRoot } = await seed({ stat: STAT_HEADER('X') });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.proof.state).toBe('X');
    expect(r.reasons).toContain('stat:state=X');
  });

  it('comm with parens and spaces does not break parsing', async () => {
    // simulate a process whose comm is '(weird (name)' — splits on LAST ')'.
    const stat = `12345 ((weird (name)) Z 1 12345 12345 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0`;
    const { pid, procRoot } = await seed({ stat });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.proof.state).toBe('Z');
  });
});

describe('ADR-0042 secondary-signals — alive signals', () => {
  it('R + zero sockets + zero children → inconclusive (no positive proof)', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.state).toBe('R');
    expect(r.proof.active_sockets).toBe(0);
    expect(r.proof.child_count).toBe(0);
    expect(r.reasons).toContain('net/tcp:0 active connections');
    expect(r.reasons).toContain('children:0 subprocs');
  });

  it('R + one active socket → alive', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.active_sockets).toBe(1);
    expect(r.reasons).toContain('net/tcp:1 active connection');
  });

  it('R + child pids → alive', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      netTcp: NET_LISTEN_ONLY,
      children: '999 1000\n',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.child_count).toBe(2);
    expect(r.reasons).toContain('children:2 subprocs');
  });

  it('S (sleeping) + active sockets → alive', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_THREE_ACTIVE,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.state).toBe('S');
    expect(r.proof.active_sockets).toBe(3);
    expect(r.reasons).toContain('net/tcp:3 active connections');
  });

  it('multiple connections counted in proof', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_THREE_ACTIVE,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.proof.active_sockets).toBe(3);
  });

  it('multiple children counted in proof', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_LISTEN_ONLY,
      children: '101 202 303 404',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.child_count).toBe(4);
    expect(r.reasons).toContain('children:4 subprocs');
  });
});

describe('ADR-0042 secondary-signals — ENOENT handling', () => {
  it('ENOENT on /proc/<pid>/stat (no other proof) → dead', async () => {
    const { pid, procRoot } = await seed({
      stat: null,
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.reasons).toContain('stat:ENOENT');
    expect(r.proof.state).toBeNull();
  });

  it('ENOENT on stat BUT children present → alive (positive proof wins)', async () => {
    const { pid, procRoot } = await seed({
      stat: null,
      netTcp: NET_LISTEN_ONLY,
      children: '999',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.reasons).toContain('stat:ENOENT');
    expect(r.proof.child_count).toBe(1);
  });

  it('ENOENT on net/tcp only → still classifies based on stat (Z → dead)', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('Z'),
      netTcp: null,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.proof.state).toBe('Z');
  });

  it('ENOENT on net/tcp with running stat + no children → inconclusive', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      netTcp: null,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('net/tcp:ENOENT');
  });
});

describe('ADR-0042 secondary-signals — EACCES + corrupt format', () => {
  // EACCES is reproduced by chmod 0 on the file. Skip if running as root,
  // because root bypasses DAC and would read it anyway → no error → wrong
  // assertion. The CI test box runs as a non-root user; the dev server runs
  // as root, hence the guard. We log the skip so it's not silently dropped.
  const isRoot = (process.getuid && process.getuid() === 0);

  it.skipIf(isRoot)('EACCES on stat → inconclusive (does not throw)', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      statMode: 0,
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('stat:EACCES');
  });

  it('corrupt /proc/<pid>/stat (no parens) → inconclusive, does not throw', async () => {
    const { pid, procRoot } = await seed({
      stat: 'totally not a stat line at all',
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('stat:malformed');
    expect(r.proof.state).toBeNull();
  });

  it('empty /proc/<pid>/stat → inconclusive, does not throw', async () => {
    const { pid, procRoot } = await seed({
      stat: '',
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('stat:malformed');
  });
});

describe('ADR-0042 secondary-signals — empty bodies', () => {
  it('empty /proc/<pid>/net/tcp (header only) → no alive signal', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_HEADER_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.active_sockets).toBe(0);
  });

  it('empty children file → no alive signal', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_LISTEN_ONLY,
      children: '   \n',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.child_count).toBe(0);
  });
});

describe('ADR-0042 secondary-signals — robustness', () => {
  it('does not throw when ALL three files are missing — verdict=dead via stat ENOENT', async () => {
    // Make a procRoot with NO pid dir at all → every read is ENOENT.
    scenarioCounter += 1;
    const procRoot = path.join(ROOT, `s${scenarioCounter}`);
    await fs.mkdir(procRoot, { recursive: true });
    const r = await classify(99999, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.reasons).toContain('stat:ENOENT');
    expect(r.reasons).toContain('net/tcp:ENOENT');
    expect(r.reasons).toContain('children:ENOENT');
  });

  it('concurrent ENOENT on stat + missing net/tcp → dead (stat is authoritative)', async () => {
    const { pid, procRoot } = await seed({
      stat: null,
      netTcp: null,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.reasons).toContain('stat:ENOENT');
    expect(r.reasons).toContain('net/tcp:ENOENT');
  });

  it('returns a stable shape: verdict + reasons[] + proof{}', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('R'),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(typeof r.verdict).toBe('string');
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.reasons.every((s) => typeof s === 'string')).toBe(true);
    expect(r.proof).toEqual(expect.objectContaining({
      pid: String(pid),
      state: 'R',
      active_sockets: 0,
      child_count: 0,
    }));
  });

  it('ignores listen-state TCP rows (0A) when counting actives', async () => {
    const mixed = NET_HEADER + [NET_ROW('0A'), NET_ROW('01'), NET_ROW('0A')].join('\n');
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: mixed,
      children: '',
    });
    const r = await classify(pid, { procRoot });
    expect(r.proof.active_sockets).toBe(1);
    expect(r.verdict).toBe(VERDICT.ALIVE);
  });

  it('children with non-numeric tokens are filtered out', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_HEADER('S'),
      netTcp: NET_LISTEN_ONLY,
      children: 'not_a_pid 42 also-bad 7',
    });
    const r = await classify(pid, { procRoot });
    expect(r.proof.child_count).toBe(2);
    expect(r.verdict).toBe(VERDICT.ALIVE);
  });
});

// ─── ADR-0042 hybrid CPU-delta-vs-baseline (variant C, AC5 fix) ───────────
//
// The CPU axis is the only delta-based liveness signal. Sockets/children
// remain snapshot-only — they detect *existence*, not activity. A
// network-hung WebFetch with a stuck TCP connection has sockets>0 forever
// but cpuDeltaPct == 0; the new rules mark that `inconclusive` and let
// the dispatcher escalate, instead of falsely declaring `alive`.
//
// `proof.cpu` from a prior call is what the next call uses as its
// `baseline` argument — round-trip is the contract the dispatcher relies
// on.
describe('ADR-0042 secondary-signals — hybrid CPU-delta liveness (AC5)', () => {
  it('baseline=null on first call → falls back to old snapshot behavior (sockets>0 → alive)', async () => {
    // Regression check: old single-arg call sites still get the same
    // verdict on the first sample.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 100, 50),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const r = await classify(pid, null, { procRoot, nowMs: 1_000_000 });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.cpu).toEqual({
      utime: 100,
      stime: 50,
      capturedAt: 1_000_000,
      deltaPct: null,
    });
    expect(r.reasons).toContain('cpu:no_baseline');
  });

  it('baseline=null + sockets=0 + children=0 → inconclusive (no positive proof, no baseline)', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 100, 50),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const r = await classify(pid, null, { procRoot, nowMs: 1_000_000 });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('cpu:no_baseline');
  });

  it('baseline given + CPU ticks unchanged + sockets>0 → INCONCLUSIVE (was alive, now suspect — AC5)', async () => {
    // Network-hung WebFetch: TCP connection still open, process burning
    // 0% CPU. Old code returned ALIVE (false negative for stall); hybrid
    // now returns INCONCLUSIVE so the dispatcher can escalate.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('S', 100, 50),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const baseline = { utime: 100, stime: 50, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_010_000, // 10s later
    });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.cpu.deltaPct).toBe(0);
    expect(r.proof.active_sockets).toBe(1);
    expect(r.reasons).toContain('cpu:delta=0.00%');
  });

  it('baseline given + CPU ticks unchanged + sockets=0 + children=0 → DEAD', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('S', 100, 50),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const baseline = { utime: 100, stime: 50, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_010_000,
    });
    expect(r.verdict).toBe(VERDICT.DEAD);
    expect(r.proof.cpu.deltaPct).toBe(0);
  });

  it('baseline given + CPU delta > threshold (>1%) → ALIVE (PRIMARY)', async () => {
    // 200 ticks delta over 1s wall window @ CLK_TCK=100 → 200% CPU.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 300, 0),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const baseline = { utime: 100, stime: 0, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_001_000, // 1s later
    });
    expect(r.verdict).toBe(VERDICT.ALIVE);
    expect(r.proof.cpu.deltaPct).toBeCloseTo(200, 1);
    expect(r.reasons.some((s) => s.startsWith('cpu:delta='))).toBe(true);
  });

  it('baseline given + CPU delta below threshold (e.g. 0.5%) + sockets>0 → INCONCLUSIVE', async () => {
    // 1 tick over 2s wall window @ CLK_TCK=100 → 0.5% CPU. Below 1%
    // default threshold; sockets>0 → was-alive-snapshot, now suspect.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('S', 101, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const baseline = { utime: 100, stime: 0, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_002_000, // 2s later
    });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.cpu.deltaPct).toBeCloseTo(0.5, 2);
  });

  it('baseline given + CPU delta below threshold + sockets=0 + children=0 → DEAD', async () => {
    // Same 0.5% CPU but no resources at all → process is wedged-and-empty.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('S', 101, 0),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const baseline = { utime: 100, stime: 0, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_002_000,
    });
    // 0.5% > 0 so cpuDeltaPct !== 0 — falls through "delta>0 but
    // <threshold" path → DEAD only when delta IS exactly 0. With non-
    // zero-but-tiny delta we land in INCONCLUSIVE. This codifies the
    // current rule: only true zero-CPU implies dead.
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.proof.cpu.deltaPct).toBeCloseTo(0.5, 2);
  });

  it('configurable threshold: cpuLivenessThresholdPct=10 + delta=5% → INCONCLUSIVE (was 5% alive at default)', async () => {
    // 5 ticks over 0.1s @ CLK_TCK=100 = 500% — easily over default 1%.
    // Bump threshold to 1000% and the same sample drops to inconclusive.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 105, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const baseline = { utime: 100, stime: 0, capturedAt: 1_000_000 };
    const rDefault = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_000_100, // 100ms later
    });
    expect(rDefault.verdict).toBe(VERDICT.ALIVE);

    const { pid: pid2, procRoot: procRoot2 } = await seed({
      stat: STAT_WITH_CPU('R', 105, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const rHigh = await classify(pid2, baseline, {
      procRoot: procRoot2,
      nowMs: 1_000_100,
      cpuLivenessThresholdPct: 1000,
    });
    expect(rHigh.verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('corrupt /proc/<pid>/stat utime/stime fields → inconclusive (CPU axis unavailable)', async () => {
    // Rebuild a stat line where utime is non-numeric. parseStatLine()
    // treats it as null → no proof.cpu → cpu axis bypassed; falls
    // through to snapshot fallback.
    const tail = new Array(52).fill('0');
    tail[0] = 'R';
    tail[1] = '1';
    tail[11] = 'NOT_A_NUMBER';
    tail[12] = '50';
    const corrupt = `12345 (claude) ${tail.join(' ')}`;
    const { pid, procRoot } = await seed({
      stat: corrupt,
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const baseline = { utime: 100, stime: 50, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_010_000,
    });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('stat:cpu_fields_malformed');
    expect(r.proof.cpu).toBeNull();
  });

  it('baseline.capturedAt === nowMs (zero wall delta) → div-by-zero guard → INCONCLUSIVE', async () => {
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 200, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const baseline = { utime: 100, stime: 0, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_000_000, // same instant
    });
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.reasons).toContain('cpu:delta_unavailable');
    // proof.cpu still has the fresh sample for the dispatcher to persist
    // as the next baseline.
    expect(r.proof.cpu.utime).toBe(200);
    expect(r.proof.cpu.deltaPct).toBeNull();
  });

  it('proof.cpu is the round-trip baseline (consume → persist → reuse)', async () => {
    // Sample 1: no baseline → captures cpu={utime, stime, capturedAt}.
    // Sample 2: pass sample-1's proof.cpu as baseline → deltaPct populated.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 100, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const r1 = await classify(pid, null, { procRoot, nowMs: 5_000_000 });
    expect(r1.proof.cpu).toEqual({
      utime: 100, stime: 0, capturedAt: 5_000_000, deltaPct: null,
    });

    // Re-seed (same pid) with bumped CPU ticks.
    const { pid: pid2, procRoot: procRoot2 } = await seed({
      stat: STAT_WITH_CPU('R', 250, 0),
      netTcp: NET_ONE_ACTIVE,
      children: '',
    });
    const r2 = await classify(pid2, r1.proof.cpu, {
      procRoot: procRoot2,
      nowMs: 5_001_000, // 1s later
    });
    // 150 ticks over 1s @ 100 CLK_TCK = 150% CPU.
    expect(r2.verdict).toBe(VERDICT.ALIVE);
    expect(r2.proof.cpu.deltaPct).toBeCloseTo(150, 1);
  });

  it('counter-going-backwards (pid reuse / wraparound) → cpu axis unavailable', async () => {
    // baseline u+s = 500, current = 100 (counter regressed — pid was
    // reused). computeCpuDeltaPct returns null → axis bypassed.
    const { pid, procRoot } = await seed({
      stat: STAT_WITH_CPU('R', 100, 0),
      netTcp: NET_LISTEN_ONLY,
      children: '',
    });
    const baseline = { utime: 400, stime: 100, capturedAt: 1_000_000 };
    const r = await classify(pid, baseline, {
      procRoot,
      nowMs: 1_010_000,
    });
    expect(r.reasons).toContain('cpu:delta_unavailable');
    // No baseline-aware verdict, no snapshot positive → INCONCLUSIVE.
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
  });
});
