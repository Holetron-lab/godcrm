// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { remoteMcpSchema, publicLookup, runRemoteMcp } from '../../services/connectors/remoteMcp.js';

function fakeServer({ malformed = false, failCall = false } = {}) {
  return vi.fn(async (_url, init) => {
    if (init.method === 'GET') return new Response(null, { status: 405 });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const message = JSON.parse(init.body);
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (message.method === 'initialize') result = {
      protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' },
    };
    if (message.method === 'tools/list') result = malformed ? { tools: 'bad' } : message.params?.cursor
      ? { tools: [{ name: 'second', inputSchema: { type: 'object' } }] }
      : { tools: [{ name: 'first', inputSchema: { type: 'object' } }], nextCursor: 'page2' };
    if (message.method === 'tools/call') {
      if (failCall) throw new Error('connection lost after submission');
      result = { content: [{ type: 'text', text: 'done' }] };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' },
    });
  });
}

describe('remote MCP boundary', () => {
  it.each(['http://example.com/mcp', 'https://user:pass@example.com/mcp',
    'https://example.com/mcp?token=secret', 'https://example.com/mcp#secret',
    'https://127.0.0.1/mcp', 'https://[::1]/mcp', 'https://169.254.169.254/mcp'])('rejects unsafe URL %s', (url) => {
    expect(remoteMcpSchema.safeParse({ url }).success).toBe(false);
  });
  it('accepts HTTPS and rejects undeclared connection options', () => {
    expect(remoteMcpSchema.parse({ url: 'https://example.com/mcp' })).toEqual({ url: 'https://example.com/mcp' });
    expect(remoteMcpSchema.safeParse({ url: 'https://example.com', command: 'sh' }).success).toBe(false);
    expect(remoteMcpSchema.safeParse({ url: 'https://example.com', bearer_token: 'x\r\ny' }).success).toBe(false);
  });
  it('rejects localhost at socket lookup', async () => {
    await expect(new Promise((resolve, reject) => publicLookup('localhost', {}, (err, address) => err ? reject(err) : resolve(address))))
      .rejects.toThrow('MCP address is not public');
  });
  it('never opens transport for invalid settings', async () => {
    const fetch = vi.fn();
    await expect(runRemoteMcp({ url: 'http://localhost' }, { fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the SDK handshake, pagination, bearer auth and session cleanup', async () => {
    const fetch = fakeServer();
    const result = await runRemoteMcp({ url: 'https://example.com/mcp', bearer_token: 'fixture-token' }, { fetch });
    expect(result.tools.map((tool) => tool.name)).toEqual(['first', 'second']);
    expect(result.server_info.name).toBe('fixture');
    expect(fetch.mock.calls.every(([, init]) => new Headers(init.headers).get('authorization') === 'Bearer fixture-token')).toBe(true);
    expect(fetch.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
  });
  it('rejects malformed remote responses and still closes the session', async () => {
    const fetch = fakeServer({ malformed: true });
    await expect(runRemoteMcp({ url: 'https://example.com/mcp' }, { fetch })).rejects.toThrow();
    expect(fetch.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true);
  });
  it('executes a tool once and never retries uncertain writes', async () => {
    const fetch = fakeServer({ failCall: true });
    await expect(runRemoteMcp({ url: 'https://example.com/mcp' }, { fetch, name: 'write', args: {} })).rejects.toThrow();
    expect(fetch.mock.calls.filter(([, init]) => init.body && JSON.parse(init.body).method === 'tools/call')).toHaveLength(1);
  });
});
