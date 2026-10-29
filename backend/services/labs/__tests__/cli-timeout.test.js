// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const h = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn() }));
vi.mock('child_process', () => ({ spawn: h.spawn }));
vi.mock('../ai-execution/process-management.js', () => ({
  killProcessTree: h.kill, trackChildProcess: vi.fn(), untrackChildProcess: vi.fn(),
}));
import { executeClaudeCode, executeCodexCli, executeCopilotCli } from '../ai-execution/cli-providers.js';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
for (const execute of [executeClaudeCode, executeCodexCli, executeCopilotCli]) {
  it(`${execute.name} stays alive past 30 minutes and rejects at 120 minutes`, async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
    child.unref = vi.fn(); child.kill = vi.fn();
    h.spawn.mockReturnValue(child);
    let settled = false;
    const result = execute({ messages: [{ role: 'user', content: 'test' }], jobId: 99 })
      .then(() => { settled = true; return null; }, err => { settled = true; return err; });
    // Dynamic imports must finish before advancing the provider's timer.
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    if (execute === executeClaudeCode) expect(h.spawn.mock.lastCall[2].env.MCP_JOB_ID).toBe('99');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(89 * 60 * 1000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect((await result).message).toContain('timeout (120 min)');
    child.emit('close', 1);
  });
}
