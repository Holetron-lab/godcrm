// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

it('rejects oversized collections before visiting their elements (GHSA-mrhx-c7xc-m3w5)', () => {
  const visit = vi.fn(() => true);
  const result = z.array(z.string().refine(visit)).max(2).safeParse(Array(100).fill('x'));
  expect(result.success).toBe(false);
  expect(visit).not.toHaveBeenCalled();
});

it('keeps form errors and valid values through the Zod resolver', async () => {
  const resolve = zodResolver(z.object({ name: z.string().min(1, 'Required') }));
  expect((await resolve({ name: '' }, {}, {})).errors.name.message).toBe('Required');
  expect((await resolve({ name: 'ok' }, {}, {})).values).toEqual({ name: 'ok' });
});

it('OpenAI parses structured output with the installed Zod schema', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'local', object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop',
      message: { role: 'assistant', content: '{"name":"ok"}', refusal: null } }],
  }), { headers: { 'content-type': 'application/json' } }));
  const client = new OpenAI({ apiKey: 'test-only', fetch });
  const result = await client.chat.completions.parse({ model: 'test-only', messages: [],
    response_format: zodResponseFormat(z.object({ name: z.string() }), 'result') });
  expect(result.choices[0].message.parsed).toEqual({ name: 'ok' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('MCP advertises and validates a Zod tool over its real transport', async () => {
  const server = new McpServer({ name: 'test', version: '1' });
  server.registerTool('echo', { inputSchema: { name: z.string().min(1) } }, async ({ name }) =>
    ({ content: [{ type: 'text', text: name }] }));
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    expect((await client.listTools()).tools[0].inputSchema.properties.name.type).toBe('string');
    expect((await client.callTool({ name: 'echo', arguments: { name: 'ok' } })).content[0].text).toBe('ok');
    expect((await client.callTool({ name: 'echo', arguments: { name: '' } })).isError).toBe(true);
  } finally { await client.close(); await server.close(); }
});
