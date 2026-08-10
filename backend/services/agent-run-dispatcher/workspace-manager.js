/**
 * Workspace Manager — ADR-0030 Phase 3.
 *
 * Materializes per-ticket git worktrees on disk so the autonomous run loop
 * has an isolated branch + working directory to operate on. Each ticket
 * claimed by the dispatcher gets its own worktree under
 * `/root/workspaces/T-<ticketId>/` on a branch `run/T-<ticketId>` cut from
 * the current `main` HEAD of the source repo.
 *
 * Design notes:
 *   - Pure module, no side effects on import.
 *   - All shell-outs use `child_process.execFile` (NOT `exec`) to avoid any
 *     shell-injection risk from ticket IDs.
 *   - 30s timeout per git operation; warnings logged on slow ops.
 *   - Worktrees share node_modules with the parent dir — we deliberately do
 *     NOT run `npm install` here (huge time cost; not needed for code edits).
 *   - All operations are idempotent so repeated dispatcher ticks are safe.
 *
 * @see ADR-0030 §3.5 (workspace materialization), §6 (Phase 3 deliverables).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'workspace_manager' });
const execFileAsync = promisify(execFile);

// ─── Constants ─────────────────────────────────────────────────
export const WORKSPACE_ROOT = '/root/workspaces';
export const SOURCE_REPO = '/root/production/business-crm';
const GIT_TIMEOUT_MS = 30_000;
const SLOW_OP_THRESHOLD_MS = 5_000;

const TICKET_DIR_PREFIX = 'T-';
const BRANCH_PREFIX = 'run/T-';

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Validate ticket id — must be a positive integer. Refuse anything else
 * before it can ever reach a shell argv slot, even though execFile already
 * neutralizes shell injection.
 */
function normalizeTicketId(ticketId) {
  const n = Number(ticketId);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`workspace_manager: invalid ticketId=${ticketId}`);
  }
  return n;
}

function pathFor(ticketId) {
  return path.join(WORKSPACE_ROOT, `${TICKET_DIR_PREFIX}${ticketId}`);
}

function branchFor(ticketId) {
  return `${BRANCH_PREFIX}${ticketId}`;
}

/**
 * Run a git command from SOURCE_REPO with timeout. Logs slow ops.
 * Throws on non-zero exit; caller decides whether to swallow.
 */
async function git(args, { allowFail = false } = {}) {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: SOURCE_REPO,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024, // 8MB — porcelain output of many worktrees fits easily
    });
    const durationMs = Date.now() - startedAt;
    if (durationMs > SLOW_OP_THRESHOLD_MS) {
      log.warn({ args, durationMs }, 'workspace_manager: slow git op');
    }
    return { stdout, stderr, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (allowFail) {
      log.debug({ args, durationMs, err: err.message }, 'workspace_manager: git op failed (allowed)');
      return { stdout: '', stderr: err.stderr || err.message || '', durationMs, failed: true };
    }
    log.error({ args, durationMs, err: err.message, stderr: err.stderr }, 'workspace_manager: git op failed');
    throw err;
  }
}

/**
 * Ensure /root/workspaces exists with mode 0700.
 */
async function ensureWorkspaceRoot() {
  try {
    await fs.mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
    // mkdir respects mode only when CREATING — chmod always to be safe.
    await fs.chmod(WORKSPACE_ROOT, 0o700);
  } catch (err) {
    log.error({ err: err.message, root: WORKSPACE_ROOT }, 'failed to ensure workspace root');
    throw err;
  }
}

/**
 * Parse `git worktree list --porcelain` output. Each entry is a paragraph
 * of `key value\n` lines, with paragraphs separated by a blank line.
 * Yields objects: { worktree, HEAD, branch }.
 */
function parseWorktreePorcelain(stdout) {
  const entries = [];
  const blocks = stdout.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;
    const entry = {};
    for (const line of lines) {
      const idx = line.indexOf(' ');
      if (idx === -1) {
        // bare flag, e.g. "bare" or "detached"
        entry[line] = true;
      } else {
        entry[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    if (entry.worktree) entries.push(entry);
  }
  return entries;
}

/**
 * Parse a worktree porcelain entry into ticket workspace info, or null if
 * the entry doesn't belong to /root/workspaces/T-*.
 */
function entryToWorkspace(entry) {
  const wt = entry.worktree;
  if (!wt) return null;
  if (!wt.startsWith(WORKSPACE_ROOT + '/')) return null;
  const dirName = path.basename(wt);
  if (!dirName.startsWith(TICKET_DIR_PREFIX)) return null;
  const ticketId = Number(dirName.slice(TICKET_DIR_PREFIX.length));
  if (!Number.isInteger(ticketId)) return null;
  // Branch in porcelain output is "refs/heads/<name>"; strip prefix.
  const rawBranch = entry.branch || '';
  const branch = rawBranch.startsWith('refs/heads/') ? rawBranch.slice('refs/heads/'.length) : rawBranch;
  return { ticketId, path: wt, branch };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Create (or return existing) workspace for a ticket. Idempotent.
 *
 * @param {number|string} ticketId
 * @param {{ baseBranch?: string }} [opts] - baseBranch defaults to 'main'
 * @returns {Promise<{ path: string, branch: string, createdAt: string, reused?: boolean }>}
 */
export async function createWorkspace(ticketId, opts = {}) {
  const id = normalizeTicketId(ticketId);
  const baseBranch = opts.baseBranch || 'main';
  const wsPath = pathFor(id);
  const wsBranch = branchFor(id);

  await ensureWorkspaceRoot();

  // Check existing worktrees first — if one for this ticket already exists,
  // return it without re-creating (idempotent).
  const { stdout } = await git(['worktree', 'list', '--porcelain']);
  const existing = parseWorktreePorcelain(stdout)
    .map(entryToWorkspace)
    .filter(Boolean)
    .find((w) => w.ticketId === id);

  if (existing) {
    // Verify directory still exists on disk (worktree list can be stale if
    // someone deleted the dir manually). If gone, prune + recreate.
    try {
      await fs.access(existing.path);
      log.debug({ ticket_id: id, path: existing.path, branch: existing.branch }, 'workspace already exists — reusing');
      return {
        path: existing.path,
        branch: existing.branch,
        createdAt: await readDirCreatedAt(existing.path),
        reused: true,
      };
    } catch {
      log.warn({ ticket_id: id, path: existing.path }, 'worktree listed but dir missing — pruning + recreating');
      await git(['worktree', 'prune'], { allowFail: true });
    }
  }

  // Branch may already exist (e.g. from a prior worktree that was removed
  // but branch wasn't deleted). Detect and either reuse with `worktree add
  // <path> <branch>` (no -b) or create fresh with `-b`.
  const branchExists = await checkBranchExists(wsBranch);

  // Also: a stale dir at wsPath without worktree entry → remove it before
  // git refuses to add.
  try {
    await fs.access(wsPath);
    log.warn({ ticket_id: id, path: wsPath }, 'stale directory at workspace path — removing');
    await fs.rm(wsPath, { recursive: true, force: true });
  } catch {
    // expected: dir does not exist
  }

  let createArgs;
  if (branchExists) {
    log.info({ ticket_id: id, branch: wsBranch }, 'reusing existing branch for workspace');
    createArgs = ['worktree', 'add', wsPath, wsBranch];
  } else {
    createArgs = ['worktree', 'add', wsPath, '-b', wsBranch, baseBranch];
  }

  await git(createArgs);
  const createdAt = new Date().toISOString();
  log.info({ ticket_id: id, path: wsPath, branch: wsBranch, createdAt }, 'workspace created');

  return { path: wsPath, branch: wsBranch, createdAt, reused: false };
}

async function checkBranchExists(branch) {
  const res = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
  return !res.failed;
}

async function readDirCreatedAt(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return (stat.birthtime || stat.ctime).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Destroy a workspace for a ticket. Removes the worktree, then deletes the
 * branch (best-effort). Idempotent — returns { removed: false, reason } if
 * no workspace existed.
 *
 * @param {number|string} ticketId
 * @returns {Promise<{ removed: boolean, reason?: string, path?: string, branch?: string }>}
 */
export async function destroyWorkspace(ticketId) {
  const id = normalizeTicketId(ticketId);
  const wsPath = pathFor(id);
  const wsBranch = branchFor(id);

  // Find existing worktree entry — if absent, treat as not_found unless a
  // stray dir is on disk.
  const { stdout } = await git(['worktree', 'list', '--porcelain']);
  const existing = parseWorktreePorcelain(stdout)
    .map(entryToWorkspace)
    .filter(Boolean)
    .find((w) => w.ticketId === id);

  let dirOnDisk = false;
  try {
    await fs.access(wsPath);
    dirOnDisk = true;
  } catch { /* missing */ }

  if (!existing && !dirOnDisk) {
    // Branch may still exist from a previous half-cleanup — try to remove.
    const branchRes = await git(['branch', '-D', wsBranch], { allowFail: true });
    if (!branchRes.failed) {
      log.info({ ticket_id: id, branch: wsBranch }, 'workspace not present but branch deleted');
    }
    return { removed: false, reason: 'not_found' };
  }

  // Remove worktree if registered.
  if (existing) {
    await git(['worktree', 'remove', '--force', wsPath], { allowFail: true });
  }

  // Force-rm dir if still present (e.g., worktree was unregistered but dir
  // remained from previous run).
  try {
    await fs.access(wsPath);
    await fs.rm(wsPath, { recursive: true, force: true });
  } catch { /* gone */ }

  // Prune any stale worktree metadata.
  await git(['worktree', 'prune'], { allowFail: true });

  // Delete branch — best-effort.
  const branchRes = await git(['branch', '-D', wsBranch], { allowFail: true });
  if (branchRes.failed) {
    log.debug({ ticket_id: id, branch: wsBranch }, 'branch delete failed (likely already gone)');
  }

  log.info({ ticket_id: id, path: wsPath, branch: wsBranch }, 'workspace destroyed');
  return { removed: true, path: wsPath, branch: wsBranch };
}

/**
 * List all ticket workspaces currently registered as git worktrees.
 *
 * @returns {Promise<Array<{ ticketId: number, path: string, branch: string, createdAt: string }>>}
 */
export async function listWorkspaces() {
  await ensureWorkspaceRoot();
  const { stdout } = await git(['worktree', 'list', '--porcelain']);
  const entries = parseWorktreePorcelain(stdout)
    .map(entryToWorkspace)
    .filter(Boolean);

  const enriched = await Promise.all(
    entries.map(async (e) => ({
      ticketId: e.ticketId,
      path: e.path,
      branch: e.branch,
      createdAt: await readDirCreatedAt(e.path),
    }))
  );
  return enriched;
}

/**
 * Health check: workspace root exists, count of registered worktrees,
 * and any orphan directories under WORKSPACE_ROOT that aren't tracked as
 * worktrees (left behind by crashes / manual fiddling).
 *
 * @returns {Promise<{ ok: boolean, workspaceRoot: string, count: number, orphaned: string[] }>}
 */
export async function workspaceHealth() {
  try {
    await ensureWorkspaceRoot();
    const tracked = await listWorkspaces();
    const trackedPaths = new Set(tracked.map((w) => w.path));

    let dirEntries = [];
    try {
      dirEntries = await fs.readdir(WORKSPACE_ROOT);
    } catch {
      dirEntries = [];
    }

    const orphaned = [];
    for (const name of dirEntries) {
      if (!name.startsWith(TICKET_DIR_PREFIX)) continue;
      const fullPath = path.join(WORKSPACE_ROOT, name);
      if (!trackedPaths.has(fullPath)) {
        orphaned.push(fullPath);
      }
    }

    return {
      ok: true,
      workspaceRoot: WORKSPACE_ROOT,
      count: tracked.length,
      orphaned,
    };
  } catch (err) {
    log.error({ err: err.message }, 'workspaceHealth failed');
    return {
      ok: false,
      workspaceRoot: WORKSPACE_ROOT,
      count: 0,
      orphaned: [],
      error: err.message,
    };
  }
}

export default {
  createWorkspace,
  destroyWorkspace,
  listWorkspaces,
  workspaceHealth,
  WORKSPACE_ROOT,
  SOURCE_REPO,
};
