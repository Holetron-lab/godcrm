// @vitest-environment node
import '../../test/setup.js';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
const fetchRelay = vi.hoisted(() => vi.fn());
vi.mock('../../services/connectors/remoteMcp.js', async (original) => ({ ...await original(), remoteMcpFetch: fetchRelay }));
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
import vault, { getSpaceConnector } from '../../services/connectors/CredentialVault.js';
import router from '../../routes/v3/connectors.js';
import { executeTool } from '../../services/agent-tools/executor.js';

let ws, other, server;
beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const columns = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'space_connectors'");
  expect(columns.map(c => c.column_name)).toEqual(expect.arrayContaining(['space_id', 'type_slug', 'encrypted_payload', 'status']));
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
  await vault.init();
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'mj-flow' });
  other = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'mj-other' });
  const app = express().use(express.json()).use((req, _res, next) => {
    req.user = { id: ws.userId, role: 'user' }; next();
  }).use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (ws) {
    await dbRun('DELETE FROM audit_log WHERE user_id = ?', [ws.userId]);
    await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
    await ws.cleanup();
  }
  if (other) await other.cleanup();
  await vault.shutdown();
});

it('saves through the space API, decrypts only for its MCP call, and blocks other spaces/disabled credentials', async () => {
  const secret = 'mj-flow-fixture-secret';
  const base = `/spaces/${ws.spaceId}/connectors`;
  const saved = await request(server).post(base).send({ type_slug: 'midjourney', display_name: 'Fixture relay',
    fields: { url: 'https://relay.example.com/mj', access_token: secret } });
  expect(saved.status).toBe(201);
  expect(JSON.stringify(saved.body)).not.toContain(secret);
  expect(saved.body.data.connector).not.toHaveProperty('encrypted_payload');
  const id = saved.body.data.connector.id;
  const stored = await dbGet('SELECT encrypted_payload FROM space_connectors WHERE id = ?', [id]);
  expect(JSON.stringify(stored)).not.toContain(secret);
  expect((await getSpaceConnector(ws.spaceId, 'midjourney')).access_token).toBe(secret);
  expect(await getSpaceConnector(other.spaceId, 'midjourney')).toBeNull();
  expect((await request(server).get(`/spaces/${other.spaceId}/connectors`)).status).toBe(403);

  fetchRelay.mockResolvedValueOnce(new Response(JSON.stringify({ code: 1, result: '54321' })));
  const result = await executeTool('midjourney_image_generate', { prompt: 'A boat' }, ws.userId, { spaceId: ws.spaceId });
  expect(result).toMatchObject({ async: true, task_id: expect.any(String) });
  expect(fetchRelay).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(secret);

  expect(await executeTool('midjourney_image_generate', { prompt: 'A boat' }, other.userId, { spaceId: other.spaceId }))
    .toMatchObject({ error: 'connector_missing' });
  expect((await request(server).patch(`${base}/${id}`).send({ enabled: false })).status).toBe(200);
  expect(await executeTool('midjourney_image_generate', { prompt: 'A boat' }, ws.userId, { spaceId: ws.spaceId }))
    .toMatchObject({ error: 'connector_missing' });
  expect(fetchRelay).toHaveBeenCalledTimes(1);
});
