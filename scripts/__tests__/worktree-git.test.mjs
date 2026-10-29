// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runWorktreeGit } from '../worktree-git.mjs';

const dirs = [];
const originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.WORKTREE_GIT_TEST_MODE;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const git = (cwd, ...args) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(mode = 'cleanup') {
  const root = mkdtempSync(join(tmpdir(), 'worktree-git-test-')); dirs.push(root);
  const repo = join(root, 'repo');
  execFileSync('/usr/bin/git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@localhost');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(repo, 'file'), 'base'); git(repo, 'add', 'file'); git(repo, 'commit', '-m', 'base');
  const cwd = join(root, 'work'); git(repo, 'worktree', 'add', '-b', 'task', cwd);
  const gitDir = git(cwd, 'rev-parse', '--absolute-git-dir');
  const bin = join(root, 'bin'); mkdirSync(bin);
  // Fault injection at the native Git boundary: a completed commit may emit an
  // EROFS cleanup error and leave its per-worktree pseudoref. Git is otherwise real.
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync,execFileSync}=require('node:child_process');
const fs=require('node:fs'); const path=require('node:path');
const a=process.argv.slice(2), cwd=a[1], op=a[2];
const g=(...args)=>execFileSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const mode=process.env.WORKTREE_GIT_TEST_MODE;
if(op==='commit' && mode==='no-change') {
 fs.writeFileSync(path.join(g('rev-parse','--absolute-git-dir'),'CHERRY_PICK_HEAD'),g('rev-parse','HEAD')+'\\n');
} else {
 const r=spawnSync('/usr/bin/git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}); fs.writeSync(1,r.stdout||''); fs.writeSync(2,r.stderr||'');
 if(r.status!==0) process.exit(r.status||2);
}
if(op==='commit') {
 const dir=g('rev-parse','--absolute-git-dir');
 if(mode!=='unrelated') fs.writeFileSync(path.join(dir,'CHERRY_PICK_HEAD'),g('rev-parse','HEAD')+'\\n');
 if(mode==='sequencer') fs.mkdirSync(path.join(dir,'sequencer'));
 fs.writeSync(2,"error: Unable to create '"+g('rev-parse','--path-format=absolute','--git-common-dir')+"/packed-refs.lock': Read-only file system\\n");
 fs.writeSync(2,'another diagnostic\\n');
}
`, { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`; process.env.WORKTREE_GIT_TEST_MODE = mode;
  let stdout = '', stderr = '';
  const output = { stdout: { write: s => { stdout += s; } }, stderr: { write: s => { stderr += s; } } };
  return { cwd, gitDir, repo, output, stderr: () => stderr, stdout: () => stdout };
}
it('repairs proven completed cleanup, keeps other diagnostics and shared refs unchanged', () => {
  const f = fixture(); const main = git(f.repo, 'rev-parse', 'main');
  expect(runWorktreeGit(['commit', '--allow-empty', '-m', 'test'], f.cwd, f.output)).toBe(0);
  expect(existsSync(join(f.gitDir, 'CHERRY_PICK_HEAD'))).toBe(false);
  expect(f.stderr()).toContain('another diagnostic'); expect(f.stderr()).toContain('cleaned CHERRY_PICK_HEAD');
  expect(f.stderr()).not.toContain('Read-only file system');
  expect(git(f.repo, 'rev-parse', 'main')).toBe(main);
  expect(existsSync(join(f.gitDir, 'godcrm-worktree-git.lock'))).toBe(false);
});
for (const mode of ['no-change', 'sequencer', 'unrelated']) {
  it(`refuses unproven cleanup: ${mode}`, () => {
    const f = fixture(mode);
    expect(runWorktreeGit(['commit', '--allow-empty', '-m', 'test'], f.cwd, f.output)).toBe(2);
    expect(f.stderr()).toContain('packed-refs.lock');
    if (mode !== 'unrelated') expect(existsSync(join(f.gitDir, 'CHERRY_PICK_HEAD'))).toBe(true);
  });
}
it('preserves conflict state on failure so normal --continue can resolve it', () => {
  const f = fixture();
  writeFileSync(join(f.repo, 'file'), 'main'); git(f.repo, 'commit', '-am', 'main change');
  const source = git(f.repo, 'rev-parse', 'HEAD');
  writeFileSync(join(f.cwd, 'file'), 'task'); git(f.cwd, 'commit', '-am', 'task change');
  expect(runWorktreeGit(['cherry-pick', source], f.cwd, f.output)).toBe(1);
  expect(readFileSync(join(f.gitDir, 'CHERRY_PICK_HEAD'), 'utf8').trim()).toBe(source);
  expect(git(f.cwd, 'ls-files', '--unmerged')).not.toBe('');
  writeFileSync(join(f.cwd, 'file'), 'resolved'); git(f.cwd, 'add', 'file');
  expect(runWorktreeGit(['cherry-pick', '--continue'], f.cwd, f.output)).toBe(0);
  expect(existsSync(join(f.gitDir, 'CHERRY_PICK_HEAD'))).toBe(false);
});
it('refuses concurrent wrapper calls and unsupported commands', () => {
  const f = fixture(); writeFileSync(join(f.gitDir, 'godcrm-worktree-git.lock'), 'busy');
  expect(runWorktreeGit(['commit', '--allow-empty', '-m', 'test'], f.cwd, f.output)).toBe(2);
  expect(readFileSync(join(f.gitDir, 'godcrm-worktree-git.lock'), 'utf8')).toBe('busy');
  expect(runWorktreeGit(['reset', '--hard'], f.cwd, f.output)).toBe(2);
  expect(runWorktreeGit(['commit'], f.repo, f.output)).toBe(2);
});
