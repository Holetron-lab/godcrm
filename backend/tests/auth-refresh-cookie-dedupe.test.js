// POST /api/v3/auth/refresh with duplicate `godcrm_refresh` cookies (chat 3660).
//
// A browser that logged in on dev.godcrm.ai (COOKIE_DOMAIN=.godcrm.ai, its own
// JWT_SECRET) sends a Domain=.godcrm.ai cookie next to the host-only one from
// app.godcrm.ai. cookie-parser keeps only the first value, so when the foreign
// cookie comes first /auth/refresh answered "invalid signature" and the SPA
// logged the user out. The route must try every value and evict the
// parent-domain copies on a host-only box.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { dbGet } from '../database/connection.js';
import { createEphemeralWorkspace } from './helpers/workspace-fixture.js';

const FOREIGN_SECRET = 'not-this-box-secret';
let app;
let fx;
let JWT_SECRET;
let helpers;
const savedCookieDomain = process.env.COOKIE_DOMAIN;

const ownToken = (userId) => jwt.sign({ id: userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '1h' });
const foreignToken = (userId) => jwt.sign({ id: userId, type: 'refresh' }, FOREIGN_SECRET, { expiresIn: '1h' });

const setCookies = (res) => res.headers['set-cookie'] || [];
const domainClears = (res) =>
  setCookies(res).filter((c) => /Domain=\.godcrm\.ai/i.test(c) && /Expires=Thu, 01 Jan 1970/.test(c));

describe('POST /auth/refresh — duplicate cookies from another *.godcrm.ai box', () => {
  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    // This box must behave like Ring 0: host-only cookies.
    delete process.env.COOKIE_DOMAIN;
    helpers = await import('../routes/v3/auth/authShared.js');
    JWT_SECRET = helpers.JWT_SECRET;
    const { default: authRouter } = await import('../routes/v3/auth/index.js');
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v3/auth', authRouter);
    fx = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'refresh-dedupe' });
  });

  afterAll(async () => {
    if (savedCookieDomain !== undefined) process.env.COOKIE_DOMAIN = savedCookieDomain;
    await fx?.cleanup();
  });

  test('foreign cookie first, own cookie second → 200 and parent-domain copies evicted', async () => {
    const res = await request(app)
      .post('/api/v3/auth/refresh')
      .set('Host', 'app.godcrm.ai')
      .set('Cookie', `godcrm_refresh=${foreignToken(fx.userId)}; godcrm_refresh=${ownToken(fx.userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(fx.userId);
    expect(res.body.data.accessToken).toBeTruthy();
    const clears = domainClears(res);
    expect(clears.some((c) => c.startsWith('godcrm_refresh=;'))).toBe(true);
    expect(clears.some((c) => c.startsWith('access_token=;'))).toBe(true);
    // Fresh host-only cookies are still issued alongside the evictions.
    const hostOnly = setCookies(res).filter((c) => c.startsWith('godcrm_refresh=ey') && !/Domain=/i.test(c));
    expect(hostOnly).toHaveLength(1);
  });

  test('own cookie first, foreign second → 200 (previous behaviour kept), still evicts', async () => {
    const res = await request(app)
      .post('/api/v3/auth/refresh')
      .set('Host', 'app.godcrm.ai')
      .set('Cookie', `godcrm_refresh=${ownToken(fx.userId)}; godcrm_refresh=${foreignToken(fx.userId)}`);
    expect(res.status).toBe(200);
    expect(domainClears(res).length).toBe(2);
  });

  test('single valid cookie → 200 and no parent-domain eviction', async () => {
    const res = await request(app)
      .post('/api/v3/auth/refresh')
      .set('Host', 'app.godcrm.ai')
      .set('Cookie', `godcrm_refresh=${ownToken(fx.userId)}`);
    expect(res.status).toBe(200);
    expect(domainClears(res)).toHaveLength(0);
  });

  test('only a foreign cookie → 401 INVALID_REFRESH_TOKEN and parent-domain copies evicted', async () => {
    const res = await request(app)
      .post('/api/v3/auth/refresh')
      .set('Host', 'app.godcrm.ai')
      .set('Cookie', `godcrm_refresh=${foreignToken(fx.userId)}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_REFRESH_TOKEN');
    expect(domainClears(res)).toHaveLength(2);
  });

  test('no cookie at all → 401 NO_REFRESH_TOKEN', async () => {
    const res = await request(app).post('/api/v3/auth/refresh').set('Host', 'app.godcrm.ai');
    expect(res.status).toBe(401);
    expect(res.body.error?.code ?? res.body.code).toBe('NO_REFRESH_TOKEN');
  });

  test('body refreshToken still works as a fallback', async () => {
    const res = await request(app)
      .post('/api/v3/auth/refresh')
      .set('Host', 'app.godcrm.ai')
      .send({ refreshToken: ownToken(fx.userId) });
    expect(res.status).toBe(200);
  });

  test('logout evicts the parent-domain copies as well', async () => {
    const res = await request(app).post('/api/v3/auth/logout').set('Host', 'app.godcrm.ai');
    expect(res.status).toBe(200);
    expect(domainClears(res)).toHaveLength(2);
  });

  test('getCookieValues returns every value in header order, unquoted and decoded', () => {
    const req = { headers: { cookie: 'a=1; godcrm_refresh="x%2Fy"; b=2;godcrm_refresh=z ; godcrm_refresh=' } };
    expect(helpers.getCookieValues(req, 'godcrm_refresh')).toEqual(['x/y', 'z']);
    expect(helpers.getCookieValues({ headers: {} }, 'godcrm_refresh')).toEqual([]);
  });

  test('getForeignCookieDomain: parent domain on host-only boxes, null when this box issues domain cookies', () => {
    expect(helpers.getForeignCookieDomain({ hostname: 'app.godcrm.ai' })).toBe('.godcrm.ai');
    expect(helpers.getForeignCookieDomain({ hostname: 'godcrm.ai' })).toBe('.godcrm.ai');
    expect(helpers.getForeignCookieDomain({ hostname: 'localhost' })).toBeNull();
    expect(helpers.getForeignCookieDomain({ hostname: '127.0.0.1' })).toBeNull();
    process.env.COOKIE_DOMAIN = '.godcrm.ai';
    try {
      expect(helpers.getForeignCookieDomain({ hostname: 'dev.godcrm.ai' })).toBeNull();
    } finally {
      delete process.env.COOKIE_DOMAIN;
    }
  });
});
