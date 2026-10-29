// @vitest-environment node
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), run: vi.fn(), role: vi.fn(), remote: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mocks.get, withTransactionAsync: (fn) => fn({ run: mocks.run }) }));
vi.mock('../../services/EffectiveRoleService.js', () => ({ getEffectiveRole: mocks.role }));
vi.mock('../../services/connectors/CredentialVault.js', () => ({ default: { encrypt: mocks.encrypt, decrypt: mocks.decrypt } }));
vi.mock('../../services/connectors/remoteMcp.js', async (original) => ({ ...await original(), runRemoteMcp: mocks.remote }));
import router from '../../routes/v3/remote-connectors.js';

const row = { id: 7, space_id: 11, type_slug: 'custom_mcp', kind: 'mcp', status: 'active',
  custom_definition: { url: 'https://example.com/mcp', allowed_tools: ['read'] }, encrypted_payload: { v: 1 } };
const app = express().use(express.json()).use((req, _res, next) => { req.user = { id: 1 }; next(); }).use(router);
let server;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); });
afterAll(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });
const base = '/spaces/11/connectors';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ effectiveRole: 'admin' });
  mocks.get.mockResolvedValue(row);
  mocks.run.mockResolvedValue({ lastInsertRowid: 7 });
  mocks.encrypt.mockReturnValue({ v: 1, ct: 'ciphertext' });
  mocks.decrypt.mockReturnValue({ bearer_token: 'test-secret' });
  mocks.remote.mockResolvedValue({ tools: [{ name: 'read', inputSchema: { type: 'object' } }], server_info: { name: 'fake' } });
});
describe('remote connector API', () => {
  it('saves URL separately from the encrypted token and audits in a transaction', async () => {
    const res = await request(server).post(base).send({ type_slug: 'custom_mcp', display_name: 'Remote',
      fields: { url: 'https://example.com/mcp', bearer_token: 'test-secret' }, allowed_tools: ['read'] });
    expect(res.status).toBe(201);
    expect(mocks.encrypt).toHaveBeenCalledWith({ bearer_token: 'test-secret' });
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain('test-secret');
    expect(JSON.stringify(res.body)).not.toContain('encrypted_payload');
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
  it.each(['viewer', 'editor', 'denied'])('denies %s before network or mutation', async (effectiveRole) => {
    mocks.role.mockResolvedValue({ effectiveRole });
    for (const action of ['test', 'tools/call']) {
      const res = await request(server).post(`${base}/7/${action}`).send({ name: 'read', arguments: {} });
      expect(res.status).toBe(403);
    }
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('rejects invalid payload before encryption', async () => {
    expect((await request(server).post(base).send({ type_slug: 'custom_mcp', display_name: 'Bad', fields: { url: 'http://localhost' } })).status).toBe(400);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('checks the real MCP handshake and returns counted tools without credentials', async () => {
    const res = await request(server).post(`${base}/7/test`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.check).toMatchObject({ ok: true, tool_count: 1 });
    expect(mocks.remote).toHaveBeenCalledWith({ url: 'https://example.com/mcp', bearer_token: 'test-secret' });
    expect(JSON.stringify(res.body)).not.toContain('test-secret');
  });
  it('denies disabled connections and unapproved tools before opening transport', async () => {
    mocks.get.mockResolvedValueOnce({ ...row, status: 'disabled' });
    expect((await request(server).post(`${base}/7/test`).send({})).status).toBe(409);
    expect((await request(server).post(`${base}/7/tools/call`).send({ name: 'delete', arguments: {} })).status).toBe(403);
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it('calls an explicitly approved tool', async () => {
    const res = await request(server).post(`${base}/7/tools/call`).send({ name: 'read', arguments: { id: 2 } });
    expect(res.status).toBe(200);
    expect(mocks.remote).toHaveBeenCalledWith(expect.any(Object), { name: 'read', args: { id: 2 } });
  });
  it('redacts remote failures and audits their outcome', async () => {
    mocks.remote.mockRejectedValue(new Error('upstream echoed test-secret'));
    const res = await request(server).post(`${base}/7/test`).send({});
    expect(res.body.data.check.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('test-secret');
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain('test-secret');
  });
  it('keeps revoked connections revoked and scrubs credentials on delete', async () => {
    mocks.get.mockResolvedValueOnce({ ...row, status: 'revoked' });
    expect((await request(server).patch(`${base}/7`).send({ enabled: true })).status).toBe(409);
    expect((await request(server).delete(`${base}/7`)).status).toBe(200);
    expect(mocks.run.mock.calls[0][0]).toContain("encrypted_payload = '{}'::jsonb");
  });
});
