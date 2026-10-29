// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import dns from 'node:dns';
import axios from 'axios';
vi.mock('axios', () => ({ default: { request: vi.fn() } }));
vi.mock('node:dns', () => ({ default: { lookup: vi.fn() } }));
import { publicLookup, remoteMcpFetch } from '../../services/connectors/remoteMcp.js';

describe('MCP socket and fetch policy', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'])('rejects DNS answer %s', async (address) => {
    dns.lookup.mockImplementation((_host, _opts, callback) => callback(null, [{ address, family: 4 }]));
    await expect(new Promise((resolve, reject) => publicLookup('example.com', {}, (err, ip) => err ? reject(err) : resolve(ip)))).rejects.toThrow('not public');
  });
  it('rejects mixed public/private DNS and pins approved addresses', async () => {
    dns.lookup.mockImplementationOnce((_h, _o, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }]))
      .mockImplementationOnce((_h, _o, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }]));
    const lookup = () => new Promise((resolve, reject) => publicLookup('example.com', { all: true }, (err, ips) => err ? reject(err) : resolve(ips)));
    await expect(lookup()).rejects.toThrow('not public');
    await expect(lookup()).resolves.toEqual([{ address: '1.1.1.1', family: 4 }]);
  });
  it('disables redirects and proxies and passes the guarded socket resolver', async () => {
    axios.request.mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, data: Readable.from(['{}']) });
    const response = await remoteMcpFetch('https://example.com/mcp', { method: 'POST', body: '{}', headers: { authorization: 'Bearer fixture' } });
    expect(await response.json()).toEqual({});
    const config = axios.request.mock.lastCall[0];
    expect(config).toMatchObject({ proxy: false, maxRedirects: 0, timeout: 15000 });
    expect(config.httpsAgent.options.lookup).toBe(publicLookup);
  });
  it('refuses a redirect without forwarding credentials', async () => {
    const stream = Readable.from(['redirect']);
    axios.request.mockResolvedValue({ status: 302, headers: { location: 'https://other.example/mcp' }, data: stream });
    await expect(remoteMcpFetch('https://example.com/mcp')).rejects.toThrow('redirects');
    expect(stream.destroyed).toBe(true);
  });
  it('bounds streamed responses', async () => {
    axios.request.mockResolvedValue({ status: 200, headers: {}, data: Readable.from([Buffer.alloc(1024 * 1024 + 1)]) });
    const response = await remoteMcpFetch('https://example.com/mcp');
    await expect(response.text()).rejects.toThrow('too large');
  });
});
