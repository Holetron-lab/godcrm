// @vitest-environment node
import '../../test/setup.js';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../services/connectors/remoteMcp.js', async (original) => ({
  ...await original(), runRemoteMcp: vi.fn(async () => ({ tools: [], server_info: { name: 'fixture', version: '1' } })),
}));
import router from '../../routes/v3/connectors.js';
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import * as database from '../../database/connection.js';
import vault from '../../services/connectors/CredentialVault.js';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';

let ws;
let other;
let server;
let userId;
let connectorId;
let transactionError;
const savedKey = process.env.CRM_CREDENTIAL_KEY;
beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const columns = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'space_connectors'");
  expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining(['custom_definition', 'encrypted_payload', 'last_checked_at']));
  const transaction = database.withTransactionAsync;
  vi.spyOn(database, 'withTransactionAsync').mockImplementation(async (fn) => {
    try { return await transaction(fn); } catch (err) { transactionError = err; throw err; }
  });
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
  await vault.init();
  ws = await createEphemeralWorkspace({ label: 'remote-mcp', table: false, dashboard: false });
  other = await createEphemeralWorkspace({ label: 'remote-other', table: false, dashboard: false });
  userId = ws.userId;
  const app = express().use(express.json()).use((req, _res, next) => { req.user = { id: userId, role: 'user' }; next(); }).use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (ws) {
    await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
    await ws.cleanup();
  }
  if (other) await other.cleanup();
  if (ws) expect(await dbGet('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toBeNull();
  await vault.shutdown();
  if (savedKey === undefined) delete process.env.CRM_CREDENTIAL_KEY;
  else process.env.CRM_CREDENTIAL_KEY = savedKey;
});

describe('remote MCP persistence and legacy router integration', () => {
  it('creates encrypted settings, checks, disables, re-enables and revokes', async () => {
    const base = `/spaces/${ws.spaceId}/connectors`;
    const created = await request(server).post(base).send({ type_slug: 'custom_blender_mcp', display_name: 'Fixture',
      fields: { url: 'https://example.com/mcp', bearer_token: 'throwaway-secret' } });
    expect(created.status, transactionError?.message).toBe(201);
    connectorId = created.body.data.connector.id;
    const stored = await dbGet('SELECT * FROM space_connectors WHERE id = ?', [connectorId]);
    expect(stored.custom_definition).toEqual({ url: 'https://example.com/mcp', allowed_tools: [] });
    expect(JSON.stringify(stored)).not.toContain('throwaway-secret');
    expect(vault.decrypt(stored.encrypted_payload)).toEqual({ bearer_token: 'throwaway-secret' });
    const checked = await request(server).post(`${base}/${connectorId}/test`).send({});
    expect(checked.body.data.check).toMatchObject({ ok: true, tool_count: 0 });
    expect(checked.body.data.connector.last_checked_at).toBeTruthy();
    expect((await request(server).patch(`${base}/${connectorId}`).send({ enabled: false })).body.data.connector.enabled).toBe(false);
    expect((await request(server).post(`${base}/${connectorId}/test`).send({})).status).toBe(409);
    expect((await request(server).patch(`${base}/${connectorId}`).send({ allowed_tools: ['read'] })).body.data.connector.enabled).toBe(false);
    expect((await request(server).patch(`${base}/${connectorId}`).send({ enabled: true })).body.data.connector.enabled).toBe(true);
    userId = other.userId;
    expect((await request(server).get(`${base}/${connectorId}`)).status).toBe(403);
    expect((await request(server).delete(`${base}/${connectorId}`)).status).toBe(403);
    userId = ws.userId;
    expect((await request(server).delete(`${base}/${connectorId}`)).status).toBe(200);
    expect((await dbGet('SELECT encrypted_payload FROM space_connectors WHERE id = ?', [connectorId])).encrypted_payload).toEqual({});
    expect((await request(server).patch(`${base}/${connectorId}`).send({ enabled: true })).status).toBe(409);
    const audit = await dbAll("SELECT details FROM audit_log WHERE entity_type = 'space_connector' AND entity_id = ?", [String(connectorId)]);
    expect(audit.length).toBeGreaterThan(4);
    expect(JSON.stringify(audit)).not.toContain('throwaway-secret');
  });
});
