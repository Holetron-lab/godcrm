/** Per-invocation code workspace. Runs in the trusted launcher BEFORE Codex's sandbox. */
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = '/root/production/business-crm';
const CODE_ROLES = new Set(['frontend-developer', 'frontend-qa', 'developer', 'developer-ralph', 'sysadmin']);
const git = async (cwd, ...args) => {
  const { execFile } = await import('node:child_process');
  return (await promisify(execFile)('git', ['-C', cwd, ...args], {
    timeout: 60_000, maxBuffer: 1024 * 1024,
  })).stdout.trim();
};

/** Resolve identity from server data, never from prompt text or caller-supplied paths. */
export async function prepareCodexWorkspace({ agentId, spaceId, jobId }) {
  if (Number(spaceId) !== 11 || !Number.isSafeInteger(Number(agentId)) || Number(agentId) <= 0) return null;
  if (!['/srv/godcrm/live', REPO].includes(process.cwd())) return null;
  if (!Object.values(networkInterfaces()).flat().some(entry => entry?.address === '<PROD_IP>')) return null;
  const { dbGet, isPostgres } = await import('../../../database/connection.js');
  const row = await dbGet(isPostgres()
    ? 'SELECT data FROM table_rows WHERE id = $1 AND table_id = $2'
    : 'SELECT data FROM table_rows WHERE id = ? AND table_id = ?', [Number(agentId), 1784]);
  const data = typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data;
  if (!CODE_ROLES.has(data?.slug)) return null;
  return createCodexWorkspace({ repo: REPO, parent: '/root', slug: data.slug, jobId });
}

/** Allocate from committed main; each invocation (including retries) gets a unique index. */
export async function createCodexWorkspace({ repo, parent, slug, jobId }) {
  if (!CODE_ROLES.has(slug)) throw new Error('Unsupported Codex code role');
  repo = await realpath(repo);
  parent = await realpath(parent);
  const run = Number.isSafeInteger(Number(jobId)) && Number(jobId) > 0 ? `job-${jobId}` : 'run';
  const designation = `codex-${run}-${randomUUID()}-${slug}`;
  const cwd = join(parent, `wt-${designation}`);
  // A private ref directory allows commits without granting main/sibling refs.
  const branch = `feat/${designation}/work`;
  const baseSha = await git(repo, 'rev-parse', '--verify', 'refs/heads/main^{commit}');
  await git(repo, 'worktree', 'add', '-b', branch, cwd, baseSha);
  const common = await realpath(await git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const gitDir = await realpath(await git(cwd, 'rev-parse', '--absolute-git-dir'));
  const refDir = join(common, 'refs', 'heads', 'feat', designation);
  const logDir = join(common, 'logs', 'refs', 'heads', 'feat', designation);
  await mkdir(logDir, { recursive: true });
  const writableRoots = [gitDir, join(common, 'objects'), refDir, logDir];
  return {
    cwd, branch, baseSha, writableRoots,
    instructions: `[Allocated code workspace — ADR-0181-A]
The launcher already created your isolated worktree from committed main.
Worktree: ${cwd}
Branch: ${branch}
Base SHA: ${baseSha}
Use this worktree for this invocation; do not allocate a second one or reuse an older agent's tree.
Files, this worktree's index, Git objects and this branch's refs are writable in the sandbox.
Shared checkout, other worktrees, main refs and deployment artifacts are outside this grant.
For commit/cherry-pick use node scripts/worktree-git.mjs commit ... or cherry-pick ... .
It verifies successful Git 2.43 pseudoref cleanup locally; do not grant shared packed-refs write access.
Do not run simultaneous raw Git writes and wrapper calls in this worktree.
Vitest: npm test -- --maxWorkers=1 <suite>; cache is .cache/vitest inside this worktree.
For direct Vitest calls include --configLoader runner (shared node_modules is read-only).
Integration into main still uses the existing git reservation and approval flow.
Leave this worktree in place until the process exits. Dirty or unmerged work is retained; report its path.
These paths do not expand your role's authorization.`,
    async release() {
      // Never force-clean: a crashed/unfinished agent's work must survive.
      if (await git(cwd, 'status', '--porcelain', '--untracked-files=all')) return;
      if (await git(cwd, 'symbolic-ref', '--short', 'HEAD') !== branch) return;
      try { await git(repo, 'merge-base', '--is-ancestor', branch, 'refs/heads/main'); }
      catch { return; }
      await git(repo, 'worktree', 'remove', cwd);
      await git(repo, 'branch', '-d', branch);
    },
  };
}
