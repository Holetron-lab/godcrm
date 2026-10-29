// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { createPublicKey } from 'node:crypto';

vi.mock('fs', async (original) => {
  const fs = await original();
  const { generateKeyPairSync } = await import('node:crypto');
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { ...fs, default: { ...fs.default, readFileSync: (path, ...args) => {
    if (String(path).endsWith('oidc-private.pem')) return keys.privateKey;
    if (String(path).endsWith('oidc-public.pem')) return keys.publicKey;
    return fs.readFileSync(path, ...args);
  } } };
});

vi.mock('../../../database/connection.js', async (original) => ({
  ...await original(), dbGet: vi.fn(),
}));
vi.mock('../../../services/secrets/getSecret.js', () => ({ getSecret: vi.fn() }));
vi.hoisted(() => vi.stubEnv('OIDC_ISSUER', 'https://id.godcrm.ai'));
afterAll(() => vi.unstubAllEnvs());
import { dbGet } from '../../../database/connection.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import router from '../index.js';

const callback = 'https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback';
const client = {
  client_id: 'forgejo', secret_ref: 'oidc_forgejo_client_secret', client_secret: null,
  token_endpoint_auth_method: 'client_secret_post', is_active: 1,
  redirect_uris: JSON.stringify([callback]),
};
const app = express();
app.use(express.json(), express.urlencoded({ extended: false }), cookieParser());
app.use('/.well-known', router);
app.use('/oauth', router);
const authorize = (query = {}) => request(app).get('/oauth/authorize')
  .set('Authorization', `Bearer ${jwt.sign({ id: 7 }, process.env.JWT_SECRET)}`)
  .query({ client_id: 'forgejo', redirect_uri: callback, response_type: 'code',
    scope: 'openid profile email', state: 'state:/git/explore/repos', nonce: 'NONCE+123', ...query });
const exchange = (code, body = {}) => request(app).post('/oauth/token').type('form')
  .send({ grant_type: 'authorization_code', client_id: 'forgejo',
    client_secret: 'vault-secret', code, redirect_uri: callback, ...body });

beforeEach(() => {
  vi.clearAllMocks();
  getSecret.mockResolvedValue('vault-secret');
  dbGet.mockImplementation(async (sql) => sql.includes('oidc_clients') ? { ...client }
    : { id: 7, name: 'Forgejo User', email: 'forgejo@example.test', email_verified: true });
});

test('confidential form exchange preserves state, nonce and issuer; code is single-use', async () => {
  const auth = await authorize().expect(302);
  const redirect = new URL(auth.headers.location);
  expect(redirect.origin + redirect.pathname).toBe(callback);
  expect(redirect.searchParams.get('state')).toBe('state:/git/explore/repos');
  const code = redirect.searchParams.get('code');
  const tokens = await exchange(code).expect(200);
  const jwks = await request(app).get('/oauth/jwks').expect(200);
  const key = createPublicKey({ key: jwks.body.keys[0], format: 'jwk' });
  expect(jwt.verify(tokens.body.id_token, key, { algorithms: ['RS256'],
    issuer: 'https://id.godcrm.ai', audience: 'forgejo' })).toMatchObject({
    iss: 'https://id.godcrm.ai', aud: 'forgejo', sub: '7', nonce: 'NONCE+123',
  });
  await exchange(code).expect(400);
});

test('legacy client without nonce still receives a valid token without nonce', async () => {
  const auth = await authorize({ nonce: undefined }).expect(302);
  const tokens = await exchange(new URL(auth.headers.location).searchParams.get('code')).expect(200);
  expect(jwt.decode(tokens.body.id_token)).not.toHaveProperty('nonce');
});

test.each(['', 'wrong'])('rejects absent/wrong confidential secret (%s)', async (secret) => {
  const auth = await authorize().expect(302);
  await exchange(new URL(auth.headers.location).searchParams.get('code'), { client_secret: secret }).expect(401);
});

test('missing vault secret fails closed', async () => {
  getSecret.mockResolvedValue(null);
  await exchange('unused').expect(401);
});

test('rejects unregistered callback and non-identical callback at exchange', async () => {
  await authorize({ redirect_uri: callback + '/other' }).expect(400);
  const auth = await authorize().expect(302);
  await exchange(new URL(auth.headers.location).searchParams.get('code'), {
    redirect_uri: callback.replace('/callback', '//callback'),
  }).expect(400);
});

test('rejects structured nonce input', async () => {
  await authorize({ nonce: ['a', 'b'] }).expect(400);
});

test('disabled client cannot authorize or exchange an already-issued code', async () => {
  const auth = await authorize().expect(302);
  dbGet.mockResolvedValue({ ...client, is_active: 0 });
  await authorize().expect(400);
  await exchange(new URL(auth.headers.location).searchParams.get('code')).expect(401);
});


test('discovery advertises the configured id host for every endpoint', async () => {
  const { body } = await request(app).get('/.well-known/openid-configuration').expect(200);
  expect(body.issuer).toBe('https://id.godcrm.ai');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri']) {
    expect(new URL(body[field]).origin).toBe(body.issuer);
  }
});

test.each(['forgejo', 'penpot'])('fresh and returning id-host sessions preserve %s authorization parameters', async (clientId) => {
  const redirectUri = clientId === 'forgejo' ? callback : 'https://design.godcrm.ai/api/auth/oidc/callback';
  dbGet.mockImplementation(async (sql) => sql.includes('oidc_clients')
    ? { ...client, client_id: clientId, redirect_uris: JSON.stringify([redirectUri]) }
    : { id: 7, name: 'Test User', email: 'oidc@example.test', email_verified: true });
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid profile email', state: 'state+with&delimiters=%25', nonce: 'nonce+with&delimiters=%25' });
  const pending = `/oauth/authorize?${query}`;
  const response = await request(app).get(pending).set('Host', 'id.godcrm.ai').expect(302);
  const login = new URL(response.headers.location, 'https://id.godcrm.ai');
  expect(login.origin + login.pathname).toBe('https://id.godcrm.ai/auth/login');
  expect(login.searchParams.get('redirect')).toBe(pending);
  // An authenticated browser returns with its id-host cookie, not an app-host Bearer token.
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await request(app).get(login.searchParams.get('redirect')).set('Host', 'id.godcrm.ai')
      .set('Cookie', `${process.env.REFRESH_COOKIE_NAME || 'godcrm_refresh'}=${jwt.sign({ id: 7 }, process.env.JWT_SECRET)}`).expect(302);
    const target = new URL(auth.headers.location);
    expect(target.origin + target.pathname).toBe(redirectUri);
    expect(target.searchParams.get('state')).toBe(query.get('state'));
    const tokens = await exchange(target.searchParams.get('code'), { client_id: clientId, redirect_uri: redirectUri }).expect(200);
    expect(jwt.decode(tokens.body.id_token)).toMatchObject({ iss: 'https://id.godcrm.ai', sub: '7', aud: clientId, nonce: query.get('nonce') });
  }
});
