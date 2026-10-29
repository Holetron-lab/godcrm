// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const h = vi.hoisted(() => ({ spawn: vi.fn(), prepare: vi.fn() }));
vi.mock('child_process', () => ({ spawn: h.spawn }));
vi.mock('../ai-execution/codex-workspace.js', () => ({ prepareCodexWorkspace: h.prepare }));
import { executeCodexCli } from '../ai-execution/cli-providers.js';
afterEach(() => { vi.clearAllMocks(); });
const params = { messages: [{ role: 'user', content: 'fix code' }], agentId: 31114, spaceId: 11, jobId: 101 };
it('binds the child and prompt to the allocated workspace, with exact roots and existing hooks', async () => {
  const workspace = { cwd: '/root/wt-test-frontend-developer', baseSha: 'abc', writableRoots: ['/repo/.git/worktrees/own', '/repo/.git/objects'], instructions: 'allocated workspace', release: vi.fn() };
  workspace.release.mockResolvedValue(); h.prepare.mockResolvedValue(workspace);
  let child;
  h.spawn.mockImplementation(() => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() }; child.unref = vi.fn();
    setTimeout(() => { child.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } })+'\n'); child.emit('close', 0); }, 1);
    return child;
  });
  expect((await executeCodexCli(params)).content).toBe('done');
  expect(h.prepare).toHaveBeenCalledWith({ agentId: 31114, spaceId: 11, jobId: 101 });
  const [, args, options] = h.spawn.mock.lastCall;
  expect(options.cwd).toBe(workspace.cwd);
  expect(args.slice(args.indexOf('--cd'), args.indexOf('--cd') + 6)).toEqual(['--cd', workspace.cwd, '--add-dir', workspace.writableRoots[0], '--add-dir', workspace.writableRoots[1]]);
  expect(args).toContain('--approve-for-me');
  expect(args.some(a => a.startsWith('hooks.PreToolUse='))).toBe(true);
  expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(child.stdin.write.mock.lastCall[0]).toContain(workspace.instructions);
  expect(workspace.release).toHaveBeenCalledOnce();
});
it('does not spawn on allocation failure and releases a workspace when spawn throws', async () => {
  h.prepare.mockRejectedValueOnce(new Error('allocation failed'));
  await expect(executeCodexCli(params)).rejects.toThrow('allocation failed');
  expect(h.spawn).not.toHaveBeenCalled();
  const release = vi.fn().mockResolvedValue();
  h.prepare.mockResolvedValue({ cwd: '/workspace', writableRoots: [], instructions: 'test', release });
  h.spawn.mockImplementation(() => { throw new Error('spawn failed'); });
  await expect(executeCodexCli(params)).rejects.toThrow('spawn failed');
  expect(release).toHaveBeenCalledOnce();
});
