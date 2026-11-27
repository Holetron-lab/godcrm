// @vitest-environment node
import '../../test/setup.js';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post } }));

import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
import vault, { getSpaceConnector } from '../../services/connectors/CredentialVault.js';
import router from '../../routes/v3/connectors.js';
import { executeTool } from '../../services/agent-tools/executor.js';

let ws, other, server;
beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const columns = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'space_connectors'");
  expect(columns.map(column => column.column_name)).toEqual(expect.arrayContaining(['space_id', 'type_slug', 'encrypted_payload', 'status']));
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
  await vault.init();
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'telegram-flow' });
  other = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'telegram-other' });
  const app = express().use(express.json()).use((req, _res, next) => {
    req.user = { id: ws.userId, role: 'user' };
    next();
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

it('stores an encrypted bot token and sends only for its active owning space', async () => {
  const secret = '123456:telegram-flow-fixture-secret';
  const base = `/spaces/${ws.spaceId}/connectors`;
  const saved = await request(server).post(base).send({
    type_slug: 'telegram',
    display_name: 'Fixture Telegram bot',
    fields: { access_token: secret, default_chat_id: '@fixture_channel' },
  });
  expect(saved.status).toBe(201);
  expect(JSON.stringify(saved.body)).not.toContain(secret);
  expect(saved.body.data.connector).not.toHaveProperty('encrypted_payload');
  const id = saved.body.data.connector.id;
  const stored = await dbGet('SELECT encrypted_payload FROM space_connectors WHERE id = ?', [id]);
  expect(JSON.stringify(stored)).not.toContain(secret);
  expect(await getSpaceConnector(ws.spaceId, 'telegram')).toMatchObject({
    access_token: secret,
    custom_fields: { default_chat_id: '@fixture_channel' },
  });
  expect(await getSpaceConnector(other.spaceId, 'telegram')).toBeNull();

  post.mockResolvedValueOnce({ data: { ok: true, result: { message_id: 501, chat: { id: -1001234567890 } } } });
  const result = await executeTool('telegram_send_message', { text: 'Connector flow' }, ws.userId, { spaceId: ws.spaceId });
  expect(result).toMatchObject({ ok: true, message_id: 501 });
  expect(post).toHaveBeenCalledWith(`https://api.telegram.org/bot${secret}/sendMessage`, {
    chat_id: '@fixture_channel', text: 'Connector flow',
  }, expect.objectContaining({ timeout: 10_000 }));
  expect(JSON.stringify(result)).not.toContain(secret);

  expect(await executeTool('telegram_send_message', { text: 'Wrong space' }, other.userId, { spaceId: other.spaceId }))
    .toMatchObject({ error: 'connector_missing' });
  expect((await request(server).patch(`${base}/${id}`).send({ enabled: false })).status).toBe(200);
  expect(await executeTool('telegram_send_message', { text: 'Disabled' }, ws.userId, { spaceId: ws.spaceId }))
    .toMatchObject({ error: 'connector_missing' });
  expect(post).toHaveBeenCalledTimes(1);
});
