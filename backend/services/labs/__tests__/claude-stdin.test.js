// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const h = vi.hoisted(() => ({
  spawn: vi.fn(), kill: vi.fn(), track: vi.fn(), untrack: vi.fn(),
  error: vi.fn(), info: vi.fn(), unlink: vi.fn(),
}));
vi.mock('child_process', () => ({ spawn: h.spawn }));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(), readFileSync: vi.fn(() => 'system context'), unlinkSync: h.unlink,
}));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { info: h.info, warn: vi.fn(), error: h.error } }));
vi.mock('../../connectors/mcpGate.js', () => ({ buildMcpGateEnv: vi.fn(async () => ({})) }));
vi.mock('../../ops/opsGate.js', () => ({ buildOpsGateEnv: vi.fn(async () => ({})) }));
vi.mock('../ai-execution/codex-workspace.js', () => ({ prepareCodexWorkspace: vi.fn() }));
vi.mock('../ai-execution/process-management.js', () => ({
  killProcessTree: h.kill, trackChildProcess: h.track, untrackChildProcess: h.untrack,
}));
import { executeClaudeCode } from '../ai-execution/cli-providers.js';

let child;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  child = Object.assign(new EventEmitter(), {
    pid: 12345, exitCode: null, signalCode: null, unref: vi.fn(),
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
  });
  h.spawn.mockReturnValue(child);
});
afterEach(() => {
  child.emit('close', 1);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function start(extra = {}) {
  const result = executeClaudeCode({ messages: [{ role: 'user', content: 'test prompt' }], ...extra })
    .catch(err => err);
  await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
  return { result };
}

it('rejects and logs asynchronous stdin EPIPE without throwing into the server', async () => {
  const { result } = await start();
  const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  expect(() => child.stdin.emit('error', err)).not.toThrow();
  expect(await result).toMatchObject({ message: expect.stringContaining('Claude CLI stdin') });
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ err, pid: child.pid }), expect.any(String));
  expect(h.kill).toHaveBeenCalledWith(child.pid, child);
  expect(vi.getTimerCount()).toBe(0);
  // A late result/close must not turn a failed request into a reported success.
  child.stdout.emit('data', JSON.stringify({ type: 'result', result: 'late result' }) + '\n');
  child.emit('close', 0);
  expect(h.untrack).toHaveBeenCalledWith(child.pid);
  expect(h.info.mock.calls.some(call => call[1] === 'Claude Code CLI completed')).toBe(false);
});

it.each([
  [1, null], [0, null], [null, 'SIGTERM'],
])('does not write to an exited child (exit=%s, signal=%s)', async (exitCode, signalCode) => {
  Object.assign(child, { exitCode, signalCode });
  const { result } = await start({ systemPrompt: 'system context' });
  expect(child.stdin.write).not.toHaveBeenCalled();
  expect(child.stdin.end).not.toHaveBeenCalled();
  expect(await result).toBeInstanceOf(Error);
  expect(h.kill).not.toHaveBeenCalled();
  expect(h.unlink).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['write', 'end'])('cleans up and rejects when stdin.%s throws', async method => {
  child.stdin[method].mockImplementationOnce(() => { throw new Error('write EPIPE'); });
  const { result } = await start({ systemPrompt: 'system context' });
  expect(await result).toMatchObject({ message: expect.stringContaining('Claude CLI stdin') });
  expect(h.unlink).toHaveBeenCalled();
  expect(h.kill).toHaveBeenCalledWith(child.pid, child);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([undefined, 'system context'])('preserves prompt delivery and successful responses (system=%s)', async systemPrompt => {
  const { result } = await start({ systemPrompt });
  expect(child.stdin.write).toHaveBeenCalledWith(systemPrompt
    ? '<system_instructions>\nsystem context\n</system_instructions>\n\ntest prompt'
    : 'test prompt');
  expect(child.stdin.end).toHaveBeenCalledOnce();
  child.stdout.emit('data', JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 2, output_tokens: 3 } }) + '\n');
  child.emit('close', 0);
  expect(await result).toMatchObject({ content: 'done', usage: { totalTokens: 5 } });
  expect(h.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves spawn and nonzero-exit errors', async () => {
  const { result } = await start();
  child.emit('error', new Error('spawn claude ENOENT'));
  child.emit('close', -2);
  expect(await result).toMatchObject({ message: 'Failed to spawn Claude CLI: spawn claude ENOENT' });
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves stderr diagnostics on nonzero exit', async () => {
  const { result } = await start();
  child.stderr.emit('data', 'native binary missing');
  child.emit('close', 1);
  expect(await result).toMatchObject({ message: 'Claude CLI exited with code 1: native binary missing' });
});

it('survives a real child closing stdin during a large prompt write', async () => {
  vi.useRealTimers();
  const { spawn } = await vi.importActual('child_process');
  let closed;
  h.spawn.mockImplementationOnce(() => {
    child = spawn(process.execPath, ['-e',
      "require('node:fs').closeSync(0); setTimeout(() => process.exit(1), 50);",
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    closed = new Promise(resolve => child.once('close', resolve));
    return child;
  });
  const result = await executeClaudeCode({ messages: [{ role: 'user', content: 'x'.repeat(4 * 1024 * 1024) }] })
    .catch(err => err);
  await closed;
  expect(result).toMatchObject({ message: expect.stringContaining('Claude CLI stdin') });
  expect(['EPIPE', 'ECONNRESET']).toContain(result.cause.code);
  expect(h.untrack).toHaveBeenCalledWith(child.pid);
});
