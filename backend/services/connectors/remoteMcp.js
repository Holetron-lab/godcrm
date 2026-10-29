import dns from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import axios from 'axios';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Resolve at socket creation, never validate DNS and then resolve it again.
// This transport uses public IPv4 only; local Blender needs an HTTPS bridge.
const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(ip, prefix);

export const remoteMcpSchema = z.object({
  url: z.string().max(2048).url().refine((value) => {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
      !u.hostname.includes(':') && (!isIP(u.hostname) || !blocked.check(u.hostname));
  }, 'Use a public HTTPS URL without credentials, query or fragment'),
  bearer_token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(),
}).strict();

export function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (err) return callback(new Error('MCP DNS lookup failed'));
    if (!addresses.length || addresses.some(({ address }) => blocked.check(address))) {
      return callback(new Error('MCP address is not public'));
    }
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, 4);
  });
}

// SDK FetchLike adapter: no redirects, environment proxies or automatic auth
// discovery. TLS verifies the original hostname, lookup pins the socket IP.
export async function remoteMcpFetch(url, init = {}) {
  remoteMcpSchema.parse({ url: String(url) });
  const response = await axios.request({
    url: String(url), method: init.method || 'GET', data: init.body,
    headers: Object.fromEntries(new Headers(init.headers)),
    adapter: 'http', proxy: false, maxRedirects: 0, responseType: 'stream',
    httpsAgent: new https.Agent({ lookup: publicLookup, keepAlive: false }),
    signal: init.signal, timeout: 15_000, maxBodyLength: 1024 * 1024,
    validateStatus: () => true,
  });
  if (response.status >= 300 && response.status < 400) {
    response.data.destroy();
    throw new Error('MCP redirects are not allowed');
  }
  if ([204, 205, 304].includes(response.status)) {
    response.data.destroy();
    return new Response(null, { status: response.status, headers: response.headers });
  }
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > 1024 * 1024 ? new Error('MCP response too large') : null, chunk);
    },
  });
  response.data.on('error', (err) => limit.destroy(err));
  limit.on('close', () => response.data.destroy());
  return new Response(Readable.toWeb(response.data.pipe(limit)), { status: response.status, headers: response.headers });
}

export async function runRemoteMcp(settings, { name, args, fetch = remoteMcpFetch } = {}) {
  const { url, bearer_token } = remoteMcpSchema.parse(settings);
  const client = new Client({ name: 'godcrm-connector', version: '1' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) }),
    requestInit: { headers: bearer_token ? { Authorization: `Bearer ${bearer_token}` } : {} },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  const options = { timeout: 15_000, signal: controller.signal };
  try {
    await client.connect(transport, options);
    if (name) return await client.callTool({ name, arguments: args }, undefined, options);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, options);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (tools.length > 500 || (cursor && !page.tools.length)) throw new Error('MCP tool list limit exceeded');
    } while (cursor);
    return { tools, server_info: client.getServerVersion() };
  } finally {
    // Bound cleanup too; close aborts the optional SSE listener.
    try { await transport.terminateSession(); } catch { /* server may not support DELETE */ }
    controller.abort();
    await client.close();
    clearTimeout(timer);
  }
}
