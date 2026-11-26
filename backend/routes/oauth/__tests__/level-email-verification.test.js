// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const { verifyLevelPilotEmail } = vi.hoisted(() => ({ verifyLevelPilotEmail: vi.fn() }));
vi.mock('../../../services/oidc/levelEmailVerification.js', () => ({ verifyLevelPilotEmail }));
vi.mock('../../../services/oidc/levelProvisioning.js', async (original) => ({
  ...await original(), changeLevelClient: vi.fn(),
}));
vi.mock('../../../database/connection.js', () => ({ dbGet: vi.fn(), dbRun: vi.fn().mockResolvedValue({}), withTransactionAsync: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({ apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(),
  child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) } }));

import { apiLogger } from '../../../utils/logger.js';
import router from '../level.js';

const app = express();
app.use(express.json(), cookieParser(), router);
const payload = { user_id: 6, request_id: '32a606ed-4489-4567-b124-a98956e388bd' };
const call = () => request(app).post('/admin/level/email-verification');
const auth = (id = 1) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;

beforeEach(() => vi.clearAllMocks());

test('anonymous, expired and non-JWT credentials are rejected', async () => {
  for (const token of [null, 'Bearer invalid', `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -1 })}`]) {
    const req = call(); if (token) req.set('Authorization', token);
    await req.send({ data: payload }).expect(401);
  }
  await call().set('Authorization', 'Bearer sk-test').send({ data: payload }).expect(401);
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  await call().set('Cookie', `access_token=${token}`).send({ data: payload }).expect(401);
  await call().query({ token }).send({ data: payload }).expect(401);
  expect(verifyLevelPilotEmail).not.toHaveBeenCalled();
});

test('owner success derives actor from JWT and returns no email', async () => {
  verifyLevelPilotEmail.mockResolvedValue({ user_id: 6, email_verified: true, changed: true, replayed: false });
  const response = await call().set('Authorization', auth()).send({ data: payload }).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({ success: true, data: { user_id: 6, email_verified: true, changed: true, replayed: false } });
  expect(verifyLevelPilotEmail).toHaveBeenCalledWith({ ...payload, actor: 1 });
});

test('same-request replay is a safe success', async () => {
  verifyLevelPilotEmail.mockResolvedValue({ user_id: 6, email_verified: true, changed: false, replayed: true });
  const response = await call().set('Authorization', auth()).send({ data: payload }).expect(200);
  expect(response.body.data).toMatchObject({ changed: false, replayed: true, email_verified: true });
});

test.each([
  { data: { ...payload, user_id: 7 } },
  { data: { ...payload, actor: 1 } },
  { data: { ...payload, email: 'injected@example.test' } },
  { data: { user_id: 6 } },
  { data: { ...payload, request_id: 'oops' } },
  payload,
])('rejects malformed or non-pilot payload %j', async (body) => {
  await call().set('Authorization', auth()).send(body).expect(400);
  expect(verifyLevelPilotEmail).not.toHaveBeenCalled();
});

test.each([['OWNER_REQUIRED', 403], ['TARGET_NOT_FOUND', 404], ['TARGET_NOT_ELIGIBLE', 409],
  ['WRONG_MASTER', 409], ['WRONG_DATABASE', 409]])('maps safe denial %s', async (code, status) => {
  verifyLevelPilotEmail.mockRejectedValue(new Error(code));
  await call().set('Authorization', auth(2)).send({ data: payload }).expect(status);
  expect(verifyLevelPilotEmail).toHaveBeenCalledWith({ ...payload, actor: 2 });
});

test('unexpected error and personal data are absent from response and logs', async () => {
  verifyLevelPilotEmail.mockRejectedValue(new Error('private-email@example.test'));
  const response = await call().set('Authorization', auth()).send({ data: payload }).expect(500);
  expect(response.body).toEqual({ error: 'EMAIL_VERIFICATION_FAILED' });
  expect(JSON.stringify(apiLogger.error.mock.calls)).not.toContain('private-email@example.test');
});
