// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
vi.mock('../../../services/oidc/forgejoProvisioning.js', () => ({ changeForgejoClient: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({ dbGet: vi.fn(), dbRun: vi.fn().mockResolvedValue({}) }));
import { dbGet } from '../../../database/connection.js';
import { changeForgejoClient } from '../../../services/oidc/forgejoProvisioning.js';
import router from '../forgejo.js';
const app = express();
app.use(express.json(), router);
const call = () => request(app).post('/admin/forgejo');
const auth = () => `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET)}`;
beforeEach(() => vi.clearAllMocks());

test('anonymous caller cannot register', async () => {
  await call().send({ data: { action: 'provision' } }).expect(401);
  expect(changeForgejoClient).not.toHaveBeenCalled();
});
test('scoped API keys cannot gain owner provisioning privileges', async () => {
  dbGet.mockResolvedValue({ id: 42, user_id: 1, role: 'owner', is_active: true, allowed_spaces: '[999]' });
  await call().set('Authorization', 'Bearer sk-not-a-session')
    .send({ data: { action: 'provision' } }).expect(401);
  expect(changeForgejoClient).not.toHaveBeenCalled();
});
test('owner identity comes from authenticated token, never payload', async () => {
  changeForgejoClient.mockResolvedValue({ client_id: 'forgejo' });
  await call().set('Authorization', auth()).send({ data: { action: 'provision' } }).expect(200);
  expect(changeForgejoClient).toHaveBeenCalledWith({ action: 'provision', actor: 1 });
  await call().set('Authorization', auth()).send({ data: { action: 'provision', actor: 1 } }).expect(400);
});
test.each(['OWNER_REQUIRED', 'WRONG_MASTER', 'CLIENT_CONFLICT'])('returns safe denial for %s', async (message) => {
  changeForgejoClient.mockRejectedValue(new Error(message));
  const response = await call().set('Authorization', auth()).send({ data: { action: 'disable' } });
  expect(response.status).toBe(message === 'OWNER_REQUIRED' ? 403 : 409);
  expect(response.body.error).toBe(message);
});
test('unexpected database/vault errors do not leak details', async () => {
  changeForgejoClient.mockRejectedValue(new Error('sensitive database contents'));
  const response = await call().set('Authorization', auth()).send({ data: { action: 'enable' } }).expect(500);
  expect(JSON.stringify(response.body)).not.toContain('sensitive');
});
