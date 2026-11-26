// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

vi.mock('../../../services/oidc/levelProvisioning.js', async (original) => ({
  ...await original(), changeLevelClient: vi.fn(),
}));
vi.mock('../../../database/connection.js', () => ({ dbGet: vi.fn(), dbRun: vi.fn().mockResolvedValue({}), withTransactionAsync: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(),
  child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) } }));

import { dbGet } from '../../../database/connection.js';
import { changeLevelClient } from '../../../services/oidc/levelProvisioning.js';
import { apiLogger } from '../../../utils/logger.js';
import router from '../level.js';

const app = express();
app.use(express.json(), cookieParser(), router);
const call = () => request(app).post('/admin/level');
const auth = (id = 1) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;
const provision = { action: 'provision', request_id: '32a606ed-4489-4567-b124-a98956e388bd', expected_revision: 'a'.repeat(64) };

beforeEach(() => vi.clearAllMocks());

test('anonymous, expired and API-key credentials are rejected', async () => {
  for (const token of [null, 'Bearer invalid', `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -1 })}`]) {
    const req = call(); if (token) req.set('Authorization', token);
    await req.send({ data: provision }).expect(401);
  }
  dbGet.mockResolvedValue({ id: 42, user_id: 1, role: 'owner', is_active: true, allowed_spaces: '[11]' });
  await call().set('Authorization', 'Bearer sk-test').send({ data: provision }).expect(401);
  expect(changeLevelClient).not.toHaveBeenCalled();
});

test.each([{ action: 'inspect' }, provision, { ...provision, dry_run: true },
  { ...provision, action: 'rotate' }, { ...provision, action: 'disable' }, { ...provision, action: 'enable' }])(
  'accepts strict owner action %j', async (data) => {
    changeLevelClient.mockResolvedValue({ client_id: 'level' });
    const response = await call().set('Authorization', auth()).send({ data }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(changeLevelClient).toHaveBeenCalledWith({ ...data, actor: 1 });
  });

test.each([{ data: { ...provision, actor: 1 } }, { data: { ...provision, client_id: 'penpot' } },
  { data: { action: 'provision' } }, { data: { ...provision, request_id: 'oops' } },
  { data: { ...provision, expected_revision: 'oops' } }, { data: { action: 'inspect', secret: 'injected' } }, provision])(
  'rejects malformed payload %j', async (body) => {
    await call().set('Authorization', auth()).send(body).expect(400);
    expect(changeLevelClient).not.toHaveBeenCalled();
  });

test.each([['OWNER_REQUIRED', 403], ['CLIENT_NOT_FOUND', 404], ['CLIENT_CONFLICT', 409], ['REVISION_CONFLICT', 409],
  ['WRONG_MASTER', 409], ['SECRET_UNAVAILABLE', 409]])('maps safe denial %s', async (code, status) => {
  changeLevelClient.mockRejectedValue(new Error(code));
  await call().set('Authorization', auth(2)).send({ data: provision }).expect(status);
  expect(changeLevelClient).toHaveBeenCalledWith({ ...provision, actor: 2 });
});

test('unexpected error and secrets are absent from response and logs', async () => {
  changeLevelClient.mockRejectedValue(new Error('SECRET-CONTENTS-DO-NOT-LOG'));
  const response = await call().set('Authorization', auth()).send({ data: provision }).expect(500);
  expect(response.body).toEqual({ error: 'LEVEL_OPERATION_FAILED' });
  expect(JSON.stringify(apiLogger.error.mock.calls)).not.toContain('SECRET-CONTENTS');
});

test.each(['cookie', 'query'])('refuses owner %s token without a Bearer session', async (mode) => {
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const req = call();
  if (mode === 'cookie') req.set('Cookie', `access_token=${token}`);
  else req.query({ token });
  await req.send({ data: provision }).expect(401);
  expect(changeLevelClient).not.toHaveBeenCalled();
});
