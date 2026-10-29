// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, test, expect, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ rows: new Map() }));
vi.mock('../../../database/connection.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(async (sql, params) => {
    if (sql.includes('INSERT INTO')) {
      const [key, wpId, holder] = params;
      const row = state.rows.get(key);
      if (row && row.holder_session !== holder) return undefined;
      const next = { holder_session: holder, wp_id: wpId, expires_at: '2099-01-01T00:00:00Z' };
      state.rows.set(key, next);
      return next;
    }
    return state.rows.get(params[0]);
  }),
}));
import { gitReservationKeys, LEGACY_GIT_INDEX_KEY } from '../git-reservation-keys.js';
import { gateWrite, isGitWriteCommand } from '../reservations.js';

let root, repo, wt, alias;
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'git-mutex-test-'));
  repo = path.join(root, 'main'); wt = path.join(root, 'work tree'); alias = path.join(root, 'alias');
  git('init', repo);
  git('-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial');
  git('-C', repo, 'worktree', 'add', '-b', 'test-worktree', wt);
  mkdirSync(path.join(wt, 'nested'));
  symlinkSync(wt, alias);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => state.rows.clear());
const gate = (cwd, holderSession, command = 'git add -A', extra = {}) => gateWrite({
  toolName: 'Bash', toolInput: { command, ...extra }, cwd, holderSession,
});

describe('canonical checkout mutex', () => {
  test.each([
    'node scripts/worktree-git.mjs commit -m done',
    '/usr/bin/node "/some path/scripts/worktree-git.mjs" cherry-pick abc',
  ])('worktree helper shares the native Git reservation: %s', async command => {
    expect(isGitWriteCommand(command)).toBe(true);
    expect(await gitReservationKeys(command, wt)).toEqual(await gitReservationKeys('git commit -m done', wt));
    await gate(wt, 'A');
    expect(await gate(wt, 'B', command)).toMatchObject({ decision: 'deny' });
    expect(await gate(repo, 'B', command)).toBeNull();
  });
  test('helper with cd locks its actual checkout; unknown invocation falls back', async () => {
    expect(await gitReservationKeys(`cd "${wt}" && node scripts/worktree-git.mjs commit -m done`, repo))
      .toEqual(await gitReservationKeys('git commit -m done', wt));
    expect(await gitReservationKeys('node --eval code scripts/worktree-git.mjs commit -m done', repo))
      .toEqual([LEGACY_GIT_INDEX_KEY]);
    expect(isGitWriteCommand('node scripts/worktree-git.mjs')).toBe(false);
  });
  test('independent worktrees acquire concurrently', async () => {
    expect(await Promise.all([gate(repo, 'A'), gate(wt, 'B')])).toEqual([null, null]);
    expect(state.rows.size).toBe(2);
  });
  test('same checkout blocks a rival but renews its owner', async () => {
    expect(await gate(wt, 'A')).toBeNull();
    expect(await gate(wt, 'A', 'git commit -m done')).toBeNull();
    expect(await gate(wt, 'B')).toMatchObject({ decision: 'deny' });
  });
  test('subdirectory and symlink cannot bypass the same checkout lock', async () => {
    await gate(wt, 'A');
    expect(await gate(path.join(wt, 'nested'), 'B')).toMatchObject({ decision: 'deny' });
    expect(await gate(alias, 'B')).toMatchObject({ decision: 'deny' });
  });
  test('quoted git -C targets main, preserving merge serialization', async () => {
    await gate(repo, 'A');
    expect(await gate(wt, 'B', `git -C "${repo}" merge test-worktree`)).toMatchObject({ decision: 'deny' });
  });
  test('quoted worktree with spaces is recognized and locked', async () => {
    const command = `git -C "${wt}" commit -m done`;
    expect(isGitWriteCommand(command)).toBe(true);
    await gate(wt, 'A');
    expect(await gate(repo, 'B', command)).toMatchObject({ decision: 'deny' });
  });
  test('cd and repeated relative -C resolve to the actual checkout', async () => {
    const expected = await gitReservationKeys('git add -A', wt);
    expect(await gitReservationKeys(`cd "${wt}" && git add -A && git commit -m done`, repo)).toEqual(expected);
    expect(await gitReservationKeys('git -C .. -C "work tree" add -A', repo)).toEqual(expected);
  });
  test('command touching two checkouts reserves both', async () => {
    expect(await gate(repo, 'A', `git add -A && git -C "${wt}" add -A`)).toBeNull();
    expect(state.rows.size).toBe(2);
    expect(await gate(wt, 'B')).toMatchObject({ decision: 'deny' });
  });
  test('explicit tool workdir overrides hook cwd', async () => {
    await gate(wt, 'A');
    expect(await gate(repo, 'B', 'git add -A', { workdir: wt })).toMatchObject({ decision: 'deny' });
  });
  test('read-only git does not reserve', async () => {
    expect(await gate(wt, 'A', 'git status')).toBeNull();
    expect(state.rows.size).toBe(0);
  });
  test.each(['git -C "$TARGET" add -A', 'GIT_INDEX_FILE=x git add -A', 'git --git-dir=x add -A', 'cd /missing; git add -A', 'git add -A | cat', 'git add -A && (git commit -m x)'])(
    'ambiguous shell retains legacy behavior: %s', async command => {
      expect(await gitReservationKeys(command, repo)).toEqual([LEGACY_GIT_INDEX_KEY]);
    },
  );
  test('missing cwd and unresolved repository retain legacy behavior', async () => {
    expect(await gitReservationKeys('git add -A', undefined)).toEqual([LEGACY_GIT_INDEX_KEY]);
    expect(await gitReservationKeys('git add -A', root)).toEqual([LEGACY_GIT_INDEX_KEY]);
    expect(await gate(undefined, 'A')).toBeNull();
    expect(await gate(undefined, 'B')).toMatchObject({ decision: 'deny' });
  });
});


test('permission hook sends the invocation cwd to the check endpoint', async () => {
  let received;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { decision: 'allow' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const hook = fileURLToPath(new URL('../../../../scripts/agent-permission-hook.js', import.meta.url));
    const child = spawn(process.execPath, [hook], {
      cwd: repo,
      env: { ...process.env, AGENT_PERMS_TOKEN: 'test-only',
        AGENT_PERMS_CHECK_URL: `http://127.0.0.1:${server.address().port}/check` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.resume(); child.stderr.resume();
    child.stdin.end(JSON.stringify({ cwd: wt, session_id: 'hook-test', tool_name: 'Bash', tool_input: { command: 'git add -A' } }));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code).toBe(0);
    expect(received).toMatchObject({ cwd: wt, session_id: 'hook-test', tool_input: { command: 'git add -A' } });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
