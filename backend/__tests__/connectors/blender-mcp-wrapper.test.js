// @vitest-environment node
/**
 * scripts/blender-mcp/scoped-mcp.py — the gate-checked launcher, driven for
 * real: python3 wrapper ↔ fake upstream MCP, with a fake CRM gate on loopback
 * whose verdict the test flips mid-session.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.resolve(__dirname, '../../../scripts/blender-mcp/scoped-mcp.py');
const FAKE_MCP = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');

let gate; // { server, url, verdict }

beforeAll(async () => {
  gate = { verdict: { allowed: true, reason: 'ok' }, hits: [] };
  gate.server = http.createServer((req, res) => {
    gate.hits.push(req.headers.authorization || '');
    if (req.headers.authorization !== 'Bearer good-token') {
      res.writeHead(401).end(JSON.stringify({ success: false }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: gate.verdict }));
  });
  await new Promise((r) => gate.server.listen(0, '127.0.0.1', r));
  gate.url = `http://127.0.0.1:${gate.server.address().port}/api/v3/connectors/mcp-gate`;
});

afterAll(() => new Promise((r) => gate.server.close(r)));

function startWrapper(env) {
  const child = spawn('python3', [WRAPPER], {
    env: {
      ...process.env,
      BLENDER_MCP_UPSTREAM_JSON: JSON.stringify([process.execPath, FAKE_MCP]),
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const w = waiters.get(msg.id);
    if (w) {
      waiters.delete(msg.id);
      w(msg);
    }
  });
  let seq = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const t = setTimeout(() => reject(new Error(`no reply to ${method}`)), 5000);
      waiters.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  const stop = () =>
    new Promise((r) => {
      child.on('exit', r);
      child.stdin.end();
    });
  return { call, notify, stop };
}

describe('scoped-mcp.py', () => {
  it('without a gate token it is an empty MCP server and never asks the gate', async () => {
    const w = startWrapper({ GODCRM_MCP_GATE_URL: gate.url });
    const init = await w.call('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.serverInfo.name).toBe('blender-scope-inactive');
    expect(init.result.serverInfo.reason).toBe('no_gate_token');
    expect((await w.call('tools/list')).result.tools).toEqual([]);
    expect((await w.call('tools/call', { name: 'get_scene_info' })).error.code).toBe(-32601);
    await w.stop();
    expect(gate.hits).toEqual([]);
  });

  it('with a rejected token it stays inactive', async () => {
    const w = startWrapper({ GODCRM_MCP_GATE_URL: gate.url, GODCRM_MCP_GATE_TOKEN_BLENDER_MCP: 'bad' });
    const init = await w.call('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.serverInfo.name).toBe('blender-scope-inactive');
    expect(init.result.serverInfo.reason).toMatch(/gate_unreachable/);
    await w.stop();
  });

  it('with an allowed token it proxies upstream and cuts tool calls once the CRM flips the switch', async () => {
    gate.verdict = { allowed: true, reason: 'ok' };
    const w = startWrapper({ GODCRM_MCP_GATE_URL: gate.url, GODCRM_MCP_GATE_TOKEN_BLENDER_MCP: 'good-token' });

    const init = await w.call('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.serverInfo.name).toBe('fake-mcp');
    w.notify('notifications/initialized');
    expect((await w.call('tools/list')).result.tools).toHaveLength(2);

    const ok = await w.call('tools/call', { name: 'get_scene_info', arguments: {} });
    expect(ok.result.content[0].text).toBe('called get_scene_info');

    gate.verdict = { allowed: false, reason: 'disabled' };
    const cut = await w.call('tools/call', { name: 'get_scene_info', arguments: {} });
    expect(cut.error.code).toBe(-32001);
    expect(cut.error.message).toMatch(/disabled/);

    gate.verdict = { allowed: true, reason: 'ok' };
    const back = await w.call('tools/call', { name: 'get_addon_status', arguments: {} });
    expect(back.result.content[0].text).toBe('called get_addon_status');

    await w.stop();
  });

  it('a gate that is down means no tools', async () => {
    const w = startWrapper({
      GODCRM_MCP_GATE_URL: 'http://127.0.0.1:1/api/v3/connectors/mcp-gate',
      GODCRM_MCP_GATE_TOKEN_BLENDER_MCP: 'good-token',
    });
    const init = await w.call('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.serverInfo.name).toBe('blender-scope-inactive');
    expect((await w.call('tools/list')).result.tools).toEqual([]);
    await w.stop();
  });
});
