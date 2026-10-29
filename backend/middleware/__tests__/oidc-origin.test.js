// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { createCorsOriginHandler } from '../corsConfig.js';
import { getRefreshCookieOptions } from '../../routes/v3/auth/authShared.js';

afterEach(() => vi.unstubAllEnvs());

test('activated id origin serves module assets and credentialed preflight, while outsiders fail closed', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CORS_ORIGINS', 'https://app.godcrm.ai,https://id.godcrm.ai');
  vi.stubEnv('COOKIE_DOMAIN', '');
  const app = express();
  app.use(cors({ origin: createCorsOriginHandler(), credentials: true }));
  app.get('/assets/login.js', (_req, res) => res.type('application/javascript').send('export {};'));
  app.use((err, _req, res, _next) => res.status(403).json({ error: err.message }));
  const asset = await request(app).get('/assets/login.js').set('Origin', 'https://id.godcrm.ai').expect(200);
  expect(asset.headers['access-control-allow-origin']).toBe('https://id.godcrm.ai');
  expect(asset.headers['access-control-allow-credentials']).toBe('true');
  const preflight = await request(app).options('/api/v3/auth/login')
    .set('Origin', 'https://id.godcrm.ai').set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type').expect(204);
  expect(preflight.headers['access-control-allow-origin']).toBe('https://id.godcrm.ai');
  expect(preflight.headers['access-control-allow-headers']).toBe('content-type');
  await request(app).get('/assets/login.js').set('Origin', 'https://id.godcrm.ai.evil.test').expect(403);
  expect(getRefreshCookieOptions()).toMatchObject({ domain: undefined, secure: true, httpOnly: true, path: '/' });
});
