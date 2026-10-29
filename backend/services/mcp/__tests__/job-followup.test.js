// @vitest-environment node
import { beforeEach, afterAll, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ handlers: [], execute: vi.fn(), take: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({ Server: class {
  setRequestHandler(schema, fn) { h.handlers.push(fn); }
  async connect() {}
} }));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class {} }));
vi.mock('../../agent-tools/executor.js', () => ({ executeTool: h.execute }));
vi.mock('../buildToolList.js', () => ({ buildToolList: () => [{ name: 'test_tool' }] }));
vi.mock('../../agent-job/single-active.js', () => ({ takeJobMessages: h.take }));
vi.mock('../../secrets/SecretsVault.js', () => ({ default: { init: async () => ({}) } }));
vi.mock('../../../database/connection.js', () => ({ getAdapter: vi.fn(), dbGet: vi.fn(), safeJsonParse: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
await import('../../../mcp-server.js');
const call = request => h.handlers[1]({ params: { name: 'test_tool', arguments: request } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('MCP_JOB_ID', '99'); h.execute.mockResolvedValue({ ok: true }); h.take.mockResolvedValue([]); });
afterAll(() => vi.unstubAllEnvs());
it('attaches follow-ups to the tool result using runtime identity, not arguments', async () => {
  const message = { content: 'update task', userId: 1, attachments: [{ url: '/uploads/a.png' }] };
  h.take.mockResolvedValue([message]);
  const result = await call({ jobId: 777 });
  expect(h.take).toHaveBeenCalledWith(99);
  expect(result.content).toHaveLength(2);
  expect(result.content[1].text).toContain(JSON.stringify(message));
  expect(result.isError).toBe(false);
});
it('keeps successful tool results successful if the mailbox read fails', async () => {
  h.take.mockRejectedValue(new Error('offline'));
  const result = await call({});
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
  expect(h.execute).toHaveBeenCalledTimes(1);
});
it('keeps tool errors visible alongside a follow-up', async () => {
  h.execute.mockResolvedValue({ error: 'permission denied' }); h.take.mockResolvedValue([{ content: 'continue' }]);
  const result = await call({});
  expect(result.isError).toBe(true); expect(result.content).toHaveLength(2);
});
