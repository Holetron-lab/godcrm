// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
vi.mock('../../../services/oidc/penpotProvisioning.js', async (original) => ({
  ...await original(), changePenpotClient: vi.fn(),
}));
vi.mock('../../../database/connection.js', () => ({ dbGet: vi.fn(), dbRun: vi.fn().mockResolvedValue({}), withTransactionAsync: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(),
  child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) } }));
import { dbGet } from '../../../database/connection.js';
import { changePenpotClient } from '../../../services/oidc/penpotProvisioning.js';
import { apiLogger } from '../../../utils/logger.js';
import router from '../penpot.js';
const app = express();
app.use(express.json(), cookieParser(), router);
const call = () => request(app).post('/admin/penpot');
const auth = (id = 1) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;
const rotate = { action: 'rotate', request_id: '32a606ed-4489-4567-b124-a98956e388bd', expected_revision: 'a'.repeat(64) };
beforeEach(() => vi.clearAllMocks());
test('anonymous and invalid/expired JWT rejected', async () => {
  for (const token of [null, 'Bearer invalid', `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -1 })}`]) {
    const req = call(); if (token) req.set('Authorization', token);
    await req.send({ data: rotate }).expect(401);
  }
  expect(changePenpotClient).not.toHaveBeenCalled();
});
test('API key attributed to owner is not a legitimate owner session', async () => {
  dbGet.mockResolvedValue({ id: 42, user_id: 1, role: 'owner', is_active: true, allowed_spaces: '[11]' });
  await call().set('Authorization', 'Bearer sk-test').send({ data: rotate }).expect(401);
  expect(changePenpotClient).not.toHaveBeenCalled();
});
test.each([{ action: 'inspect' }, rotate, { ...rotate, action: 'disable' }, { ...rotate, action: 'enable' }])('accepts strict action %j', async (data) => {
  changePenpotClient.mockResolvedValue({ client_id: 'penpot' });
  const response = await call().set('Authorization', auth()).send({ data }).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(changePenpotClient).toHaveBeenCalledWith({ ...data, actor: 1 });
});
test.each([{ data: { ...rotate, actor: 1 } }, { data: { ...rotate, client_id: 'forgejo' } },
  { data: { action: 'rotate' } }, { data: { ...rotate, request_id: 'oops' } },
  { data: { ...rotate, expected_revision: 'oops' } }, { data: { action: 'inspect', secret: 'injected' } }, rotate])(
  'rejects unrecognized and malformed payload %j', async (body) => {
    await call().set('Authorization', auth()).send(body).expect(400);
    expect(changePenpotClient).not.toHaveBeenCalled();
  });
test.each([['OWNER_REQUIRED', 403], ['CLIENT_NOT_FOUND', 404], ['REVISION_CONFLICT', 409],
  ['WRONG_MASTER', 409], ['SCHEMA_MISMATCH', 409]])('safe denial %s', async (code, status) => {
  changePenpotClient.mockRejectedValue(new Error(code));
  await call().set('Authorization', auth(2)).send({ data: rotate }).expect(status);
  expect(changePenpotClient).toHaveBeenCalledWith({ ...rotate, actor: 2 });
});
test('unexpected error is absent from response and logs', async () => {
  changePenpotClient.mockRejectedValue(new Error('SECRET-CONTENTS-DO-NOT-LOG'));
  const response = await call().set('Authorization', auth()).send({ data: rotate }).expect(500);
  expect(response.body).toEqual({ error: 'PENPOT_OPERATION_FAILED' });
  expect(JSON.stringify(apiLogger.error.mock.calls)).not.toContain('SECRET-CONTENTS');
});

test.each(['cookie', 'query'])('refuses owner %s token without a Bearer session', async (mode) => {
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const req = call();
  if (mode === 'cookie') req.set('Cookie', `access_token=${token}`);
  else req.query({ token });
  await req.send({ data: rotate }).expect(401);
  expect(changePenpotClient).not.toHaveBeenCalled();
});
