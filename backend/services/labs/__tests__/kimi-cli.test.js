// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const h = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), dbGet: vi.fn(), secret: vi.fn() }));
vi.mock('child_process', () => ({ spawn: h.spawn }));
vi.mock('../../../database/connection.js', () => ({ dbGet: h.dbGet, isPostgres: () => true }));
vi.mock('../../secrets/getSecret.js', () => ({ getSecret: h.secret }));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../connectors/mcpGate.js', () => ({ buildMcpGateEnv: vi.fn(async () => ({})) }));
vi.mock('../../ops/opsGate.js', () => ({ buildOpsGateEnv: vi.fn(async () => ({})) }));
vi.mock('../ai-execution/codex-workspace.js', () => ({ prepareCodexWorkspace: vi.fn() }));
vi.mock('../ai-execution/process-management.js', () => ({ killProcessTree: h.kill, trackChildProcess: vi.fn(), untrackChildProcess: vi.fn() }));
import { executeKimiCli } from '../ai-execution/cli-providers.js';
import { detectProvider, resolveAgentProvider } from '../../chat/agent-execution-shared/provider-resolution.js';

let child;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('KIMI_FLEET_MODEL', 'auto');
  vi.stubEnv('AGENT_PERMS', 'hook');
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new EventEmitter(), unref: vi.fn() });
  h.spawn.mockReturnValue(child);
});
afterEach(() => { child.emit('close', 1); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function start(extra = {}) {
  const result = executeKimiCli({ messages: [{ role: 'user', content: 'test' }], model: 'kimi-code/k3.1-pro', ...extra }).catch(e => e);
  await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
  return { result };
}
it('routes Kimi to CLI and keeps other providers unchanged', () => {
  expect(detectProvider('kimi-code', 'claude-old')).toMatchObject({ isKimi: true, isCliAgent: true, isAnthropic: false });
  expect(detectProvider('codex', 'gpt')).toMatchObject({ isCodex: true, isCliAgent: true });
  expect(detectProvider('anthropic', 'claude')).toMatchObject({ isCliAgent: false, isAnthropic: true });
});
it('does not silently inherit another operator when Kimi has no API key', async () => {
  h.dbGet.mockResolvedValueOnce({ data: { provider: 'kimi-code' } }).mockResolvedValue(null);
  const result = await resolveAgentProvider({ operator_id: 42, model: 'kimi-code/k3.1-pro' }, { spaceId: 11 });
  expect(result).toMatchObject({ provider: 'kimi-code', isLocal: true });
  expect(h.secret).not.toHaveBeenCalled();
  expect(h.dbGet).toHaveBeenCalledTimes(2);
});
it('passes identity and translates fragmented tool calls/results and final output', async () => {
  const onEvent = vi.fn();
  const { result } = await start({ agentId: 42, spaceId: 11, jobId: 99, maxTurns: 3, onEvent });
  expect(h.spawn.mock.lastCall[2].env).toMatchObject({ AGENT_HOOK_DIALECT: 'kimi', KIMI_CRM_MANAGED: '1', AGENT_ID: '42', SPACE_ID: '11', MCP_SPACE_ID: '11', MCP_JOB_ID: '99', KIMI_LOOP_MAX_STEPS_PER_TURN: '3' });
  const events = [
    { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'Read', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'contents' },
    { role: 'assistant', content: 'OK' },
  ].map(e => JSON.stringify(e)).join('\n');
  child.stdout.emit('data', events.slice(0, 17)); child.stdout.emit('data', events.slice(17)); child.emit('close', 0);
  expect(await result).toMatchObject({ content: 'OK', modelSource: 'requested', finishReason: 'end_turn' });
  expect(onEvent.mock.calls.map(c => c[0].message.content[0])).toEqual([
    { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } },
    { type: 'tool_result', tool_use_id: 't1', content: 'contents' }, { type: 'text', text: 'OK' },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([1, null])('rejects exit %s even after partial assistant text', async code => {
  const { result } = await start();
  child.stdout.emit('data', '{"role":"assistant","content":"working"}\n'); child.emit('close', code);
  expect(await result).toBeInstanceOf(Error);
});
it('rejects empty output instead of reporting a successful job', async () => {
  const { result } = await start(); child.emit('close', 0);
  expect(await result).toBeInstanceOf(Error);
});
it('counts UTF-8 bytes and refuses an oversized indispensable prompt before spawn', async () => {
  await expect(executeKimiCli({ messages: [{ role: 'user', content: 'я'.repeat(60000) }] })).rejects.toThrow(/prompt.*budget/i);
  expect(h.spawn).not.toHaveBeenCalled();
});
it('sheds oldest history to fit the byte budget', async () => {
  const { result } = await start({ messages: [{ role: 'user', content: 'я'.repeat(60000) }, { role: 'user', content: 'current' }] });
  expect(h.spawn.mock.lastCall[1][1]).toBe('current'); child.stdout.emit('data', '{"role":"assistant","content":"OK"}\n'); child.emit('close', 0);
  expect(await result).toMatchObject({ content: 'OK' });
});
it('rejects bypass and fail-closed requests rather than promising an unsupported security boundary', async () => {
  await expect(executeKimiCli({ messages: [], permissionsFailClosed: true })).rejects.toThrow(/fail.closed/i);
  vi.stubEnv('AGENT_PERMS', 'bypass');
  await expect(executeKimiCli({ messages: [] })).rejects.toThrow(/bypass/i);
  expect(h.spawn).not.toHaveBeenCalled();
});
it('honours pre-abort and timeout', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(executeKimiCli({ messages: [], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.spawn).not.toHaveBeenCalled();
  const { result } = await start({ runTimeoutMs: 1000 }); await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeInstanceOf(Error); expect(h.kill).toHaveBeenCalled();
});
it('rejects malformed external tool events after partial text', async () => {
  const { result } = await start();
  child.stdout.emit('data', '{"role":"assistant","content":"working"}\n');
  child.stdout.emit('data', '{"role":"assistant","tool_calls":[{"id":42}]}\n');
  child.emit('close', 0);
  expect(await result).toBeInstanceOf(Error);
});
it('preserves Cyrillic text when a UTF-8 character crosses stdout chunks', async () => {
  const { result } = await start();
  const data = Buffer.from('{"role":"assistant","content":"Привет"}\n');
  const split = data.indexOf(Buffer.from('П')) + 1;
  child.stdout.write(data.subarray(0, split)); child.stdout.write(data.subarray(split)); child.emit('close', 0);
  expect(await result).toMatchObject({ content: 'Привет' });
});
it.each(['kimi-code/k3-256k', 'custom/TeamModel'])('honours registry model %s without a fleet override', async model => {
  vi.stubEnv('KIMI_FLEET_MODEL', undefined);
  const { result } = await start({ model });
  child.stdout.emit('data', '{"role":"assistant","content":"OK"}\n'); child.emit('close', 0);
  expect(h.spawn.mock.lastCall[1].slice(-2)).toEqual(['-m', model]);
  expect(await result).toMatchObject({ model });
});
it('preserves an explicit fleet model override', async () => {
  vi.stubEnv('KIMI_FLEET_MODEL', 'custom/TeamModel');
  const { result } = await start({ model: 'kimi-code/k3-256k' });
  child.stdout.emit('data', '{"role":"assistant","content":"OK"}\n'); child.emit('close', 0);
  expect(h.spawn.mock.lastCall[1].slice(-2)).toEqual(['-m', 'custom/TeamModel']);
  expect(await result).toMatchObject({ model: 'custom/TeamModel' });
});
it('uses the CLI configured default when no model is selected', async () => {
  const { result } = await start({ model: undefined });
  child.stdout.emit('data', '{"role":"assistant","content":"OK"}\n'); child.emit('close', 0);
  expect(h.spawn.mock.lastCall[1]).not.toContain('-m');
  expect(await result).toMatchObject({ content: 'OK', model: null });
});
it('surfaces the fatal CLI error after a long workspace-trust warning', async () => {
  const { result } = await start();
  const error = 'error: failed to run prompt: Model "kimi-code/k3.1-pro" is not configured in config.toml.';
  child.stderr.emit('data', `Warning: this folder is not trusted; ${'MCP server '.repeat(40)}\n\n${error}\nSee log: /tmp/kimi-code.log`);
  child.emit('close', 1);
  expect((await result).message).toContain(error);
});
