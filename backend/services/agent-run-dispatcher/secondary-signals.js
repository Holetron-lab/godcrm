/**
 * ADR-0042 — Secondary signals classifier (Task 2, hybrid variant C).
 *
 * Pure async, /proc-only. Given a pid + a prior baseline, sample three
 * independent signals to decide if a process is alive, dead, or genuinely
 * ambiguous. The dispatcher (Task 4/5) calls this from `stuck_check` after
 * the heartbeat clock has already declared the run "possibly stuck" —
 * secondary signals are the second-opinion gate before we kill.
 *
 * No DB, no spawn, no shell-out, no dispatcher imports. Every fs read is
 * wrapped — we NEVER throw. Anything we can't read becomes an `inconclusive`
 * reason; the dispatcher decides what to do (re-sample, escalate, give up).
 *
 * Signals (read from /proc):
 *   - /proc/<pid>/stat               — process state char ('Z'/'X' → dead)
 *                                    + utime/stime (delta-based liveness)
 *   - /proc/<pid>/net/tcp            — count of non-LISTEN sockets (snapshot)
 *   - /proc/<pid>/task/<pid>/children — count of forked children (snapshot)
 *
 * **HYBRID DESIGN (variant C, AC5 fix).** The CPU axis is the only
 * delta-based signal: we sample `(utime+stime)` clock ticks, compare to
 * the prior `baseline.cpu` sample, and divide by the wall-clock window
 * to get an instantaneous CPU% over the interval. Sockets and children
 * are SNAPSHOT-only — they detect *existence*, not activity. A network-
 * hung WebFetch with a stuck TCP connection has `sockets > 0` forever
 * but `cpuDeltaPct == 0`; the CPU axis lets us mark it `inconclusive`
 * and escalate, instead of falsely declaring `alive` (which would mask
 * the stall and rely on the wall-clock backstop).
 *
 * Verdict (in priority order):
 *   - dead         if state ∈ {Z, X}                                  (zombie / dying)
 *   - dead         if /proc/<pid>/stat is ENOENT and no other proof   (gone)
 *   - alive        if cpuDeltaPct > CPU_LIVENESS_THRESHOLD            (PRIMARY — closes AC5)
 *   - dead         if cpuDeltaPct == 0 AND sockets == 0 AND children == 0
 *                  (no activity, no resources)
 *   - inconclusive if cpuDeltaPct == 0 AND (sockets > 0 OR children > 0)
 *                  (was alive snapshot, now suspect — escalate)
 *   - alive        if baseline === null AND (sockets > 0 OR children > 0)
 *                  (first sample fallback — matches old snapshot behavior)
 *   - inconclusive otherwise — including EACCES, malformed /proc files, or
 *                  running/sleeping process with no observable activity.
 *
 * `reasons[]` is a flat list of short audit strings (`'stat:state=Z'`,
 * `'cpu:delta=2.40%'`, `'net/tcp:1 active connection'`, …). `proof` is
 * a small object capturing the parsed evidence for debugging; the
 * `proof.cpu` blob is what the dispatcher persists as the next call's
 * `baseline.cpu`.
 *
 * @see ADR-0042 §9 (secondary-signals).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export const VERDICT = Object.freeze({
  ALIVE: 'alive',
  DEAD: 'dead',
  INCONCLUSIVE: 'inconclusive',
});

// TCP socket states from include/net/tcp_states.h. Anything that isn't
// LISTEN (0A) is "active enough" — the process is talking to something
// on the network or holding a half-closed channel open.
const TCP_LISTEN = '0A';

// Linux user-space tick rate. `_SC_CLK_TCK` from sysconf — on every Linux
// distro we run this is 100, but read it from the OS if available so the
// math stays correct on exotic kernels. Default 100 if `os.constants`
// doesn't expose it (older Node, non-Linux test box, etc.).
const CLK_TCK = (() => {
  // Node doesn't expose sysconf directly; `os.constants` does NOT carry
  // _SC_CLK_TCK. Fall back to the documented Linux default.
  // (If we ever need precision, we'd shell out to `getconf CLK_TCK` once
  // at module load — but that violates the no-spawn rule of this file.)
  return 100;
})();

// Default CPU%-delta threshold above which we declare the process alive.
// Configurable via `config.secondary_signals.cpu_liveness_threshold_pct`
// passed through `opts.cpuLivenessThresholdPct`. 1% is conservative —
// even a barely-alive event loop ticking once a second clears this.
export const CPU_LIVENESS_THRESHOLD_DEFAULT_PCT = 1;

/**
 * Parse a /proc/<pid>/stat line. The `comm` field is wrapped in parens and
 * may contain spaces or parens itself, so we split on the LAST ')' rather
 * than tokenising from the left. Returns null on malformed input.
 *
 * Fields after `)` are space-separated. After the closing paren the layout
 * is: state (0) ppid (1) ... utime (11) stime (12) ... — i.e. fields 14
 * and 15 in `man 5 proc` 1-indexed numbering, but indices 11 and 12 in
 * the post-`)` slice (because pid + comm consumed two slots in the man
 * page numbering and the post-`)` slice starts at field 3).
 */
function parseStatLine(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const lastParen = raw.lastIndexOf(')');
  if (lastParen < 0) return null;
  const tail = raw.slice(lastParen + 1).trim();
  if (tail.length === 0) return null;
  const parts = tail.split(/\s+/);
  const state = parts[0];
  if (typeof state !== 'string' || state.length !== 1) return null;
  // utime = field 14 (man 5 proc, 1-indexed) → post-')' index 11.
  // stime = field 15 (man 5 proc, 1-indexed) → post-')' index 12.
  const utimeRaw = parts[11];
  const stimeRaw = parts[12];
  const utime = /^\d+$/.test(utimeRaw || '') ? Number(utimeRaw) : null;
  const stime = /^\d+$/.test(stimeRaw || '') ? Number(stimeRaw) : null;
  return { state, utime, stime };
}

/**
 * Count non-LISTEN socket rows in a /proc/<pid>/net/tcp body.
 * Snapshot-only: detects *existence* of a connection, not activity. A
 * hung TCP socket with bytes neither in nor out still shows up here. The
 * CPU delta axis is what catches that case.
 *
 * The first line is the column header — skip it. Each subsequent row's
 * 4th whitespace-separated token is the connection state in hex.
 */
function countActiveSockets(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  const lines = raw.split('\n');
  let count = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const parts = line.split(/\s+/);
    // Header survives if the file is mangled — skip lines that look like one.
    if (parts.length < 4) continue;
    const st = parts[3];
    if (typeof st !== 'string' || st.length === 0) continue;
    if (st.toUpperCase() === TCP_LISTEN) continue;
    count += 1;
  }
  return count;
}

/**
 * Children file format: space-separated pids on one line, possibly empty,
 * possibly with a trailing newline. Snapshot-only: detects *existence*
 * of children, not whether they are doing work. A wedged subprocess
 * still counts here; the parent's own CPU delta reflects whether the
 * agent is making progress.
 */
function countChildren(raw) {
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter((tok) => /^\d+$/.test(tok)).length;
}

async function readSafe(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: err && err.code ? err.code : 'EUNKNOWN', err };
  }
}

/**
 * Compute CPU% over the wall-clock window between two `proof.cpu` samples.
 *
 *   cpuDeltaPct = (Δticks / (CLK_TCK * (Δms / 1000))) * 100
 *
 * Returns `null` if any input is missing, the wall window is zero, or
 * the math underflows. The caller treats `null` as "no CPU signal" and
 * falls back to snapshot-only logic.
 */
function computeCpuDeltaPct(currentCpu, baselineCpu, nowMs) {
  if (!currentCpu || !baselineCpu) return null;
  const u0 = baselineCpu.utime;
  const s0 = baselineCpu.stime;
  const t0 = baselineCpu.capturedAt;
  const u1 = currentCpu.utime;
  const s1 = currentCpu.stime;
  if (typeof u0 !== 'number' || typeof s0 !== 'number') return null;
  if (typeof u1 !== 'number' || typeof s1 !== 'number') return null;
  if (typeof t0 !== 'number' || !Number.isFinite(t0)) return null;
  const wallMs = nowMs - t0;
  if (!(wallMs > 0)) return null;  // zero or negative → div-by-zero guard
  const deltaTicks = (u1 + s1) - (u0 + s0);
  if (deltaTicks < 0) return null; // counter went backwards (pid reuse?) — give up
  const wallSec = wallMs / 1000;
  return (deltaTicks / (CLK_TCK * wallSec)) * 100;
}

/**
 * Classify whether a pid is alive based on /proc evidence + an optional
 * prior CPU baseline.
 *
 * @param {number|string} pid
 * @param {object|null} baseline — prior `proof.cpu` blob, or null on first call.
 *   Shape: `{ utime, stime, capturedAt }` (capturedAt = ms epoch).
 * @param {{
 *   procRoot?: string,
 *   cpuLivenessThresholdPct?: number,
 *   nowMs?: number,
 * }} [opts]
 *   - `procRoot`: test seam (defaults to '/proc')
 *   - `cpuLivenessThresholdPct`: override CPU%-delta threshold (default 1)
 *   - `nowMs`: test seam for current wall-clock ms (defaults to Date.now())
 * @returns {Promise<{verdict: 'alive'|'dead'|'inconclusive', reasons: string[], proof: object}>}
 */
export async function classify(pid, baseline = null, opts = {}) {
  // Back-compat shim: old call sites that pass `(pid, opts)` with no
  // baseline still work — we detect by sniffing the second arg.
  if (baseline && typeof baseline === 'object' && (
    typeof baseline.procRoot === 'string'
    || typeof baseline.cpuLivenessThresholdPct === 'number'
    || typeof baseline.nowMs === 'number'
  ) && baseline.utime === undefined && baseline.stime === undefined) {
    opts = baseline;
    baseline = null;
  }
  const procRoot = typeof opts.procRoot === 'string' ? opts.procRoot : '/proc';
  const threshold = typeof opts.cpuLivenessThresholdPct === 'number'
    ? opts.cpuLivenessThresholdPct
    : CPU_LIVENESS_THRESHOLD_DEFAULT_PCT;
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const pidStr = String(pid);
  const reasons = [];
  const proof = {
    pid: pidStr,
    state: null,
    cpu: null,             // { utime, stime, capturedAt, deltaPct }
    active_sockets: null,
    child_count: null,
  };

  // --- /proc/<pid>/stat ----------------------------------------------------
  const statPath = path.join(procRoot, pidStr, 'stat');
  const statRead = await readSafe(statPath);
  let statEnoent = false;
  let statCorrupt = false;
  if (!statRead.ok) {
    if (statRead.code === 'ENOENT') {
      statEnoent = true;
      reasons.push('stat:ENOENT');
    } else if (statRead.code === 'EACCES') {
      reasons.push('stat:EACCES');
    } else {
      reasons.push(`stat:${statRead.code}`);
    }
  } else {
    const parsed = parseStatLine(statRead.data);
    if (!parsed) {
      reasons.push('stat:malformed');
      statCorrupt = true;
    } else {
      proof.state = parsed.state;
      reasons.push(`stat:state=${parsed.state}`);
      // Capture CPU sample even on Z/X — useful for post-mortem proof,
      // though we short-circuit to dead immediately below.
      const haveCpu = typeof parsed.utime === 'number' && typeof parsed.stime === 'number';
      if (haveCpu) {
        proof.cpu = {
          utime: parsed.utime,
          stime: parsed.stime,
          capturedAt: nowMs,
          deltaPct: null,
        };
      } else {
        // utime/stime corrupt but state parsed → mark CPU portion suspect.
        reasons.push('stat:cpu_fields_malformed');
      }
      if (parsed.state === 'Z' || parsed.state === 'X') {
        // Dead-on-arrival: zombie or dying. Net/children reads are skipped —
        // they'd be ENOENT or empty anyway, and we want a clean verdict.
        return { verdict: VERDICT.DEAD, reasons, proof };
      }
    }
  }

  // --- /proc/<pid>/net/tcp -------------------------------------------------
  const netPath = path.join(procRoot, pidStr, 'net', 'tcp');
  const netRead = await readSafe(netPath);
  if (!netRead.ok) {
    if (netRead.code === 'ENOENT') {
      reasons.push('net/tcp:ENOENT');
    } else if (netRead.code === 'EACCES') {
      reasons.push('net/tcp:EACCES');
    } else {
      reasons.push(`net/tcp:${netRead.code}`);
    }
  } else {
    const sockets = countActiveSockets(netRead.data);
    proof.active_sockets = sockets;
    if (sockets > 0) {
      reasons.push(`net/tcp:${sockets} active connection${sockets === 1 ? '' : 's'}`);
    } else {
      reasons.push('net/tcp:0 active connections');
    }
  }

  // --- /proc/<pid>/task/<pid>/children ------------------------------------
  const childrenPath = path.join(procRoot, pidStr, 'task', pidStr, 'children');
  const childRead = await readSafe(childrenPath);
  if (!childRead.ok) {
    if (childRead.code === 'ENOENT') {
      reasons.push('children:ENOENT');
    } else if (childRead.code === 'EACCES') {
      reasons.push('children:EACCES');
    } else {
      reasons.push(`children:${childRead.code}`);
    }
  } else {
    const kids = countChildren(childRead.data);
    proof.child_count = kids;
    if (kids > 0) {
      reasons.push(`children:${kids} subproc${kids === 1 ? '' : 's'}`);
    } else {
      reasons.push('children:0 subprocs');
    }
  }

  // --- CPU%-delta vs baseline (PRIMARY liveness signal) -------------------
  // If baseline is null we can't compute a delta — fall through to snapshot
  // fallback below. If we have a baseline AND a fresh proof.cpu sample,
  // compute the delta and stamp it back into proof.cpu for audit.
  //
  // `cpuAxisGiven` records whether the caller PROVIDED a baseline at all.
  // It's distinct from `cpuDeltaPct !== null` (computed value), because we
  // need to suppress the snapshot fallback when the caller wanted CPU
  // semantics but the math couldn't run (zero wall window, counter
  // backwards, malformed cpu fields). Otherwise we'd silently regress to
  // old snapshot=alive on the very paths the hybrid was designed to fix.
  let cpuDeltaPct = null;
  let cpuAxisGiven = false;
  if (baseline && typeof baseline === 'object'
      && baseline.utime !== undefined && baseline.stime !== undefined) {
    cpuAxisGiven = true;
    if (proof.cpu) {
      cpuDeltaPct = computeCpuDeltaPct(proof.cpu, baseline, nowMs);
      if (cpuDeltaPct === null) {
        reasons.push('cpu:delta_unavailable');
      } else {
        proof.cpu.deltaPct = cpuDeltaPct;
        reasons.push(`cpu:delta=${cpuDeltaPct.toFixed(2)}%`);
      }
    } else {
      reasons.push('cpu:delta_unavailable');
    }
  } else if (baseline === null) {
    reasons.push('cpu:no_baseline');
  }

  // --- verdict aggregation ------------------------------------------------
  const sockets  = proof.active_sockets ?? 0;
  const children = proof.child_count    ?? 0;
  const aliveBySnapshot = sockets > 0 || children > 0;

  // PRIMARY: CPU delta over threshold → alive (closes AC5).
  if (cpuDeltaPct !== null && cpuDeltaPct > threshold) {
    return { verdict: VERDICT.ALIVE, reasons, proof };
  }

  // CPU delta computed AND zero AND no resources → dead.
  // (cpuDeltaPct === 0 means no work since baseline; sockets+children=0
  // means no observable resources either. Process is wedged-and-empty.)
  if (cpuDeltaPct !== null && cpuDeltaPct === 0 && !aliveBySnapshot) {
    return { verdict: VERDICT.DEAD, reasons, proof };
  }

  // CPU delta computed AND below threshold AND snapshot has resources →
  // INCONCLUSIVE. Was alive snapshot before the baseline; now suspect.
  // The dispatcher escalates (re-sample / kill stuck_inconclusive).
  // This is the AC5 path: network-hung WebFetch with sockets>0 + 0% CPU.
  if (cpuDeltaPct !== null && cpuDeltaPct <= threshold && aliveBySnapshot) {
    return { verdict: VERDICT.INCONCLUSIVE, reasons, proof };
  }

  // FALLBACK: no baseline (first sample). Match old snapshot behavior so
  // callers who don't yet plumb a baseline keep working: any positive
  // snapshot signal → alive. Once they pass a baseline next tick the
  // hybrid rules above kick in.
  //
  // IMPORTANT: only kicks in when the caller did NOT provide a baseline
  // (`cpuAxisGiven === false`). If they did provide one but the math
  // failed (zero wall window, counter regressed, malformed cpu fields),
  // we want INCONCLUSIVE so the dispatcher re-samples instead of
  // misclassifying a wedged process as alive.
  if (!cpuAxisGiven && aliveBySnapshot) {
    return { verdict: VERDICT.ALIVE, reasons, proof };
  }

  // ENOENT on stat with NO positive proof from net/children → process is gone.
  // (We never reach `dead` from running-state alone — that's `inconclusive`,
  // because a CPU-bound R-state process with no sockets/children might just
  // be doing pure compute. Letting it live errs on safety, per ADR §9.)
  if (statEnoent) {
    return { verdict: VERDICT.DEAD, reasons, proof };
  }

  // Corrupt stat with no other proof → inconclusive (covers div-by-zero
  // wall-window and malformed cpu fields too).
  if (statCorrupt) {
    return { verdict: VERDICT.INCONCLUSIVE, reasons, proof };
  }

  return { verdict: VERDICT.INCONCLUSIVE, reasons, proof };
}

export default {
  VERDICT,
  CPU_LIVENESS_THRESHOLD_DEFAULT_PCT,
  classify,
};
