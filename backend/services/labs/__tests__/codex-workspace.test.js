// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const h = vi.hoisted(() => ({ dbGet: vi.fn(), networkInterfaces: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({ dbGet: h.dbGet, isPostgres: () => true }));
vi.mock('node:os', async original => ({ ...await original(), networkInterfaces: h.networkInterfaces }));
import { createCodexWorkspace, prepareCodexWorkspace } from '../ai-execution/codex-workspace.js';
const dirs = [];
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'codex-workspace-test-')); dirs.push(parent);
  const repo = join(parent, 'repo');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  git(repo, 'config', 'user.name', 'Workspace test'); git(repo, 'config', 'user.email', 'test@localhost');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
  await writeFile(join(repo, 'source'), 'committed'); git(repo, 'add', 'source'); git(repo, 'commit', '-m', 'base');
  return { repo, parent, slug: 'frontend-developer', jobId: 3660 };
}
it('allocates distinct invocations from committed main, ignoring dirty shared source', async () => {
  const opts = await fixture(); await writeFile(join(opts.repo, 'source'), 'dirty shared source');
  const [a, b] = await Promise.all([createCodexWorkspace(opts), createCodexWorkspace(opts)]);
  expect(a.cwd).not.toBe(b.cwd); expect(a.writableRoots[0]).not.toBe(b.writableRoots[0]);
  expect(await readFile(join(a.cwd, 'source'), 'utf8')).toBe('committed');
  expect(a.writableRoots).not.toContain(join(opts.repo, '.git'));
  expect(a.writableRoots).not.toContain(opts.repo);
  expect(a.instructions).toContain(a.cwd);
  await a.release(); await b.release();
  expect(git(opts.repo, 'worktree', 'list', '--porcelain')).not.toContain(a.cwd);
  expect(await readFile(join(opts.repo, 'source'), 'utf8')).toBe('dirty shared source');
});
it('preserves dirty and committed-but-unmerged work', async () => {
  const opts = await fixture(); const w = await createCodexWorkspace(opts);
  await writeFile(join(w.cwd, 'new'), 'keep'); await w.release();
  expect(await readFile(join(w.cwd, 'new'), 'utf8')).toBe('keep');
  git(w.cwd, 'add', 'new'); git(w.cwd, 'commit', '-m', 'work'); await w.release();
  expect(git(opts.repo, 'worktree', 'list', '--porcelain')).toContain(w.cwd);
  git(opts.repo, 'merge', '--no-ff', w.branch, '-m', 'integrate'); await w.release();
  expect(git(opts.repo, 'branch', '--list', w.branch)).toBe('');
});
it('rejects unsupported roles and fails before allocation when main is absent', async () => {
  const opts = await fixture();
  await expect(createCodexWorkspace({ ...opts, slug: '../escape' })).rejects.toThrow('Unsupported');
  git(opts.repo, 'branch', '-m', 'other');
  await expect(createCodexWorkspace(opts)).rejects.toThrow();
  expect(git(opts.repo, 'worktree', 'list', '--porcelain').match(/worktree /g)).toHaveLength(1);
});
it('does not provision for another space, runtime, host, missing identity or non-code role', async () => {
  const params = { agentId: 31114, spaceId: 11 };
  vi.spyOn(process, 'cwd').mockReturnValue('/srv/godcrm/live');
  h.networkInterfaces.mockReturnValue({ eth0: [{ address: '<PROD_IP>' }] });
  expect(await prepareCodexWorkspace({ ...params, spaceId: 89 })).toBeNull();
  expect(await prepareCodexWorkspace({ ...params, agentId: null })).toBeNull();
  vi.mocked(process.cwd).mockReturnValue('/other');
  expect(await prepareCodexWorkspace(params)).toBeNull();
  vi.mocked(process.cwd).mockReturnValue('/srv/godcrm/live');
  h.networkInterfaces.mockReturnValue({ eth0: [{ address: '<RING1_IP>' }] });
  expect(await prepareCodexWorkspace(params)).toBeNull(); expect(h.dbGet).not.toHaveBeenCalled();
  h.networkInterfaces.mockReturnValue({ eth0: [{ address: '<PROD_IP>' }] });
  h.dbGet.mockResolvedValue({ data: { slug: 'marketer' } });
  expect(await prepareCodexWorkspace(params)).toBeNull();
  expect(h.dbGet.mock.lastCall[1]).toEqual([31114, 1784]);
  h.dbGet.mockRejectedValue(new Error('identity lookup unavailable'));
  await expect(prepareCodexWorkspace(params)).rejects.toThrow('identity lookup unavailable');
});
