// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../database/connection.js', () => ({ dbGet: vi.fn(), dbAll: vi.fn(), dbRun: vi.fn(), withTransactionAsync: vi.fn() }));
const broker = vi.hoisted(() => ({ preflight: vi.fn(), summary: vi.fn(), run: vi.fn(), artifact: vi.fn() }));
vi.mock('../../services/ops/stagingBrowserBroker.js', () => ({ browserPreflight: broker.preflight, browserPreflightSummary: broker.summary, runBrowserSuite: broker.run, readBrowserArtifact: broker.artifact }));
import { browserExchange, browserInstallation } from '../../services/ops/stagingBrowserChannel.js';
import { signBody } from '../../services/ops/stagingExecutionBroker.js';
import { signOpsGateToken, buildOpsGateEnv } from '../../services/ops/opsGate.js';
import { OpsDenied } from '../../services/ops/opsBroker.js';
import { dbGet } from '../../database/connection.js';
import { opsGateRouter } from '../../routes/v3/ops.js';
import { browserToolHandlers } from '../../services/agent-tools/browser-tools.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-ipc-'));
const key = crypto.randomBytes(32).toString('hex');
let server;
let socket;
let responder;
let seen;
let peers;
beforeEach(async () => {
  vi.clearAllMocks(); peers = new Set(); seen = [];
  socket = path.join(temp, crypto.randomUUID());
  responder = body => ({ body: { v: 1, nonce: body.nonce, op: body.op, result: { ready: true } } });
  server = net.createServer(peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer));
    let input = '';
    peer.on('data', chunk => {
      input += chunk;
      if (!input.includes('\n')) return;
      const message = JSON.parse(input.split('\n')[0]);
      expect(message.sig).toBe(signBody(key, message.body));
      seen.push(message.body);
      const out = responder(message.body, peer);
      if (out === null) return;
      if (typeof out === 'string') return peer.write(out);
      peer.write(JSON.stringify({ ...out, sig: out.sig ?? signBody(key, out.body) }) + '\n');
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
});
afterEach(async () => {
  for (const p of peers) p.destroy();
  if (server.listening) await new Promise(resolve => server.close(resolve));
});

afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));

const exchange = (options = {}) => browserExchange({ key, socket }, { op: 'preflight' }, options);
describe('real signed Unix IPC', () => {
  it('authenticates a bounded challenge response', async () => {
    expect(await exchange()).toEqual({ ready: true });
    expect(seen[0]).toMatchObject({ v: 1, op: 'preflight' });
  });
  it.each(['signature','nonce','operation','extra','malformed','oversized','closed'])('rejects %s response', async kind => {
    responder = (body, peer) => {
      if (kind === 'closed') { peer.destroy(); return null; }
      if (kind === 'malformed') return 'not-json\n';
      if (kind === 'oversized') return 'x'.repeat(66000);
      const out = { body: { v: 1, nonce: body.nonce, op: body.op, result: {} } };
      if (kind === 'signature') out.sig = '0'.repeat(64);
      if (kind === 'nonce') out.body.nonce = crypto.randomUUID();
      if (kind === 'operation') out.body.op = 'run';
      if (kind === 'extra') out.body.secret = 'hidden';
      return out;
    };
    await expect(exchange()).rejects.toBeInstanceOf(OpsDenied);
  });
  it('deadline closes a hung connection', async () => {
    responder = () => null;
    await expect(exchange({ timeoutMs: 25 })).rejects.toMatchObject({ reason: 'worker_deadline' });
  });
  it('abort disconnects the worker transport', async () => {
    const controller = new AbortController();
    responder = () => { controller.abort(); return null; };
    await expect(exchange({ signal: controller.signal })).rejects.toMatchObject({ reason: 'cancelled' });
  });
  it('pre-aborted calls never connect', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(exchange({ signal: controller.signal })).rejects.toMatchObject({ reason: 'cancelled' });
    expect(seen).toEqual([]);
  });
  it('uninstalled profile is BLOCKED', () => {
    expect(() => browserInstallation()).toThrow(OpsDenied);
  });
});

describe('authenticated HTTP route and gate compatibility', () => {
  const app = express().use('/api/v3/ops', opsGateRouter);
  const token = () => signOpsGateToken({ agentId: 31113, spaceId: 11, jobId: 22049 });
  it('refuses no token and a forged token before broker access', async () => {
    for (const auth of ['', 'Bearer forged']) {
      const r = await request(app).post('/api/v3/ops/browser/run').set('authorization', auth).send({ suite_id: 'axe-v1' });
      expect(r.status).toBe(401); expect(r.body.error.decision).toBe('DENY');
    }
    expect(broker.run).not.toHaveBeenCalled();
  });
  it('binds the verified dispatch identity', async () => {
    broker.run.mockResolvedValue({ decision: 'PASS' });
    const r = await request(app).post('/api/v3/ops/browser/run').set('authorization', `Bearer ${token()}`).send({ suite_id: 'axe-v1' });
    expect(r.body.data.decision).toBe('PASS');
    expect(broker.run.mock.calls[0][0].claims).toMatchObject({ agent_id: 31113, space_id: 11, dispatch_job_id: '22049' });
  });
  it('reports missing capabilities as machine-readable BLOCKED', async () => {
    broker.preflight.mockRejectedValue(new OpsDenied('capability_unavailable', 503));
    const r = await request(app).post('/api/v3/ops/browser/preflight').set('authorization', `Bearer ${token()}`).send({ suite_id: 'axe-v1' });
    expect(r.status).toBe(503); expect(r.body.error).toEqual({ decision: 'BLOCKED', reason: 'capability_unavailable' });
  });
  it('does not require browser migration for existing grants', async () => {
    vi.mocked(dbGet).mockResolvedValue({ ok: 1 });
    expect(await buildOpsGateEnv({ agentId: 1, spaceId: 11, jobId: 2 })).toHaveProperty('GODCRM_OPS_GATE_TOKEN');
    expect(dbGet).toHaveBeenCalledTimes(1);
  });
  it('missing browser migration fails closed without throwing', async () => {
    vi.mocked(dbGet).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('missing table'));
    expect(await buildOpsGateEnv({ agentId: 1, spaceId: 11, jobId: 2 })).toEqual({});
  });
  it('job-specific browser grant enables only the existing identity token', async () => {
    vi.mocked(dbGet).mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: 1 });
    expect(await buildOpsGateEnv({ agentId: 1, spaceId: 11, jobId: 2 })).toHaveProperty('GODCRM_OPS_GATE_TOKEN');
    expect(dbGet.mock.calls.at(-1)[1]).toEqual([1, 11, '2']);
  });
  it('client refuses extra fields before network', async () => {
    expect(await browserToolHandlers.ops_browser_run({ suite_id: 'axe-v1', url: 'https://example.com' })).toEqual({ decision: 'DENY', reason: 'invalid_browser_request' });
  });
});
