#!/usr/bin/env node
/** Git 2.43 worktree pseudoref cleanup without access to shared packed-refs. */
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, openSync, closeSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runWorktreeGit(args, cwd = process.cwd(), output = process) {
  if (!['commit', 'cherry-pick'].includes(args[0])) {
    output.stderr.write('Usage: node scripts/worktree-git.mjs <commit|cherry-pick> [git arguments]\n');
    return 2;
  }
  const git = (...argv) => {
    const r = spawnSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr || `git exited ${r.status}`);
    return r.stdout.trim();
  };
  let lock;
  let lockPath;
  try {
    const gitDir = git('rev-parse', '--absolute-git-dir');
    const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    if (resolve(gitDir) === resolve(common)) throw new Error('A linked worktree is required');
    // Serialize wrapper calls in this worktree. Do not mix simultaneous raw Git writes.
    lockPath = join(gitDir, 'godcrm-worktree-git.lock');
    lock = openSync(lockPath, 'wx', 0o600);
    const before = git('rev-parse', 'HEAD');
    const result = spawnSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
    });
    output.stdout.write(result.stdout || '');
    if (result.error || result.status !== 0) {
      output.stderr.write(result.stderr || result.error?.message || `git terminated by ${result.signal}\n`);
      return result.error ? 2 : (result.status ?? (result.signal === 'SIGINT' ? 130 : 2));
    }
    const warning = `error: Unable to create '${common}/packed-refs.lock': Read-only file system`;
    const lines = (result.stderr || '').split('\n');
    if (!lines.includes(warning)) {
      output.stderr.write(result.stderr || '');
      return 0;
    }
    // Git can return 0 after failing pseudoref deletion. Never infer success from
    // exit status alone, nor clean conflict/sequencer state after a failed command.
    if (before === git('rev-parse', 'HEAD') || git('ls-files', '--unmerged') ||
        ['sequencer', 'rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some(p => existsSync(join(gitDir, p)))) {
      throw new Error(`Git cleanup not proven safe; inspect worktree.\n${result.stderr}`);
    }
    const refs = ['CHERRY_PICK_HEAD', 'REVERT_HEAD'].filter(p => existsSync(join(gitDir, p)));
    if (refs.length !== lines.filter(line => line === warning).length) {
      throw new Error(`Unexpected packed-refs failure; state retained.\n${result.stderr}`);
    }
    const pending = refs.map(name => {
      const path = join(gitDir, name);
      const value = readFileSync(path, 'utf8');
      if (!/^[0-9a-f]{40,64}\n$/.test(value)) throw new Error(`Invalid ${name}; state retained`);
      git('cat-file', '-e', `${value.trim()}^{commit}`);
      return { path, value, name };
    });
    for (const ref of pending) {
      if (readFileSync(ref.path, 'utf8') !== ref.value) throw new Error(`${ref.name} changed; state retained`);
      unlinkSync(ref.path);
    }
    output.stderr.write(lines.filter(line => line !== warning).join('\n'));
    output.stderr.write(`[worktree-git] Completed Git operation; cleaned ${refs.join(', ')} locally.\n`);
    return 0;
  } catch (error) {
    output.stderr.write(`[worktree-git] ${error.message}\n`);
    return 2;
  } finally {
    if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runWorktreeGit(process.argv.slice(2));
}
