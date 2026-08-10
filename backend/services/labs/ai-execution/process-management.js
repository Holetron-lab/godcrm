/**
 * Active child process tracking and lifecycle management.
 *
 * Extracted from ai-execution-service.js
 */

import { apiLogger } from '../../../utils/logger.js';

// ─── ACTIVE CHILD PROCESS TRACKING ─────────────────────────────
// Track all spawned CLI processes so we can kill them on graceful shutdown.
// Map<pid, { child, label, startedAt }>
const _activeChildProcesses = new Map();

/**
 * Kill a process and all its children (process group).
 * First tries SIGTERM on the process group, then SIGKILL after 5s if needed.
 * @param {number} pid - Process ID
 * @param {object} child - ChildProcess object (optional)
 * @returns {boolean} Whether kill was attempted
 */
export function killProcessTree(pid, child) {
  try {
    // Kill entire process group (negative PID = process group)
    process.kill(-pid, 'SIGTERM');
    // Fallback: also kill the child directly in case it's not the group leader
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    }
    // Schedule SIGKILL for stubborn MCP processes after 5 seconds
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
    }, 5000).unref();
    return true;
  } catch (err) {
    // ESRCH = no such process (already dead) — that's fine
    if (err.code !== 'ESRCH') {
      apiLogger.warn({ pid, err: err.message }, 'killProcessTree: unexpected error');
    }
    // Fallback: try killing just the child
    if (child) {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }
    return false;
  }
}

/**
 * Kill all active child processes (called during graceful shutdown).
 * Kills entire process trees (including MCP sub-processes).
 * @returns {number} Number of processes killed
 */
export function killAllActiveProcesses() {
  let killed = 0;
  for (const [pid, info] of _activeChildProcesses) {
    if (killProcessTree(pid, info.child)) {
      killed++;
      apiLogger.info({ pid, label: info.label }, 'Graceful shutdown: killed process tree');
    }
  }
  _activeChildProcesses.clear();
  return killed;
}

/**
 * Kill orphan MCP-related processes that survived after their parent claude CLI died.
 * Searches for processes matching known MCP patterns and kills them if they're orphaned.
 * @returns {Promise<number>} Number of orphan processes killed
 */
export async function killOrphanMCPProcesses() {
  const { execSync } = await import('child_process');
  const MCP_PATTERNS = ['mcp-searxng', 'google-drive-mcp', 'mcp-server'];
  let totalKilled = 0;

  for (const pattern of MCP_PATTERNS) {
    try {
      // Find PIDs of processes matching pattern, exclude grep itself
      const output = execSync(
        `pgrep -f "${pattern}" 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (!output) continue;

      const pids = output.split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));

      for (const pid of pids) {
        // Check if parent PID is 1 (orphaned) or if parent is NOT a tracked claude process
        try {
          const ppidStr = execSync(`ps -o ppid= -p ${pid} 2>/dev/null || true`, {
            encoding: 'utf-8', timeout: 3000
          }).trim();
          const ppid = parseInt(ppidStr, 10);

          // Kill if orphaned (ppid=1) or parent is not in our active tracking
          if (ppid === 1 || !_activeChildProcesses.has(ppid)) {
            process.kill(pid, 'SIGKILL');
            totalKilled++;
            apiLogger.info({ pid, pattern, ppid }, 'Killed orphan MCP process');
          }
        } catch {
          // Process already dead or permission denied
        }
      }
    } catch {
      // pgrep not available or other error — skip
    }
  }

  if (totalKilled > 0) {
    apiLogger.info({ totalKilled }, 'Orphan MCP cleanup complete');
  }
  return totalKilled;
}

/**
 * Get count of active child processes.
 */
export function getActiveProcessCount() {
  return _activeChildProcesses.size;
}

/**
 * Get active process PIDs (for monitoring).
 */
export function getActiveProcessPids() {
  return Array.from(_activeChildProcesses.keys());
}

/**
 * Register a child process for tracking.
 * @param {number} pid
 * @param {{ child: object, label: string, startedAt: number }} info
 */
export function trackChildProcess(pid, info) {
  _activeChildProcesses.set(pid, info);
}

/**
 * Unregister a child process from tracking.
 * @param {number} pid
 */
export function untrackChildProcess(pid) {
  _activeChildProcesses.delete(pid);
}
