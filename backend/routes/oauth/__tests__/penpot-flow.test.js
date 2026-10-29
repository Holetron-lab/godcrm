// @vitest-environment node
import { beforeEach, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
vi.mock('../../../database/connection.js', async (original) => ({ ...await original(), dbGet: vi.fn() }));
vi.mock('../../../services/secrets/getSecret.js', () => ({ getSecret: vi.fn() }));
import { dbGet } from '../../../database/connection.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import router from '../index.js';
const callback = 'https://design.godcrm.ai/api/auth/oidc/callback';
const app = express();
app.use(express.json(), express.urlencoded({ extended: false }), router);
const authorize = (redirect_uri = callback) => request(app).get('/authorize')
  .set('Authorization', `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET)}`)
  .query({ client_id: 'penpot', redirect_uri, response_type: 'code', scope: 'openid email profile' });
const exchange = (code, body = {}) => request(app).post('/token').type('form')
  .send({ grant_type: 'authorization_code', client_id: 'penpot', code,
    client_secret: 'new-vault-test-secret', redirect_uri: callback, ...body });
beforeEach(() => {
  getSecret.mockResolvedValue('new-vault-test-secret');
  dbGet.mockImplementation(async (sql) => sql.includes('oidc_clients') ? {
    client_id: 'penpot', client_secret: null, secret_ref: 'oidc_penpot_test',
    token_endpoint_auth_method: 'client_secret_post', is_active: 1, redirect_uris: JSON.stringify([callback]),
  } : { id: 1, name: 'Test', email: 'penpot@example.test' });
});
test('token endpoint rejects the old secret and accepts the new one', async () => {
  const response = await authorize().expect(302);
  const code = new URL(response.headers.location).searchParams.get('code');
  await exchange(code, { client_secret: 'old-exposed-test-secret' }).expect(401);
  await exchange(code).expect(200);
});
test('missing vault never re-enables legacy fallback', async () => {
  getSecret.mockResolvedValue(null);
  await exchange('unused', { client_secret: 'old-exposed-test-secret' }).expect(401);
});
test('requires the exact callback both at authorize and exchange', async () => {
  const variant = callback.replace('/callback', '//callback');
  await authorize(variant).expect(400);
  const response = await authorize().expect(302);
  await exchange(new URL(response.headers.location).searchParams.get('code'), { redirect_uri: variant }).expect(400);
});
