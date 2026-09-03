/**
 * ADR-188 F5 — GET /api/v3/public/config (unauthenticated public slice).
 *
 * The login page must decide whether to show the "Sign up" link BEFORE auth,
 * so it needs the effective signup policy without a token. This route is the
 * public, non-sensitive projection of `getEffectiveRegistrationPolicy()`:
 * only `{ signup_mode, referral_enabled }` — never roles / auto_join / landing.
 *
 * No DB (ADR-0009): the `_app_settings` read is swapped via __setRuntimeFetcher
 * so these run against no combat master. The router-level abuse-guard +
 * rate-limit still run (real chain), matching /registration-config.
 */
import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import publicRoutes from '../public.js';
import {
  __setRuntimeFetcher,
  __resetRuntimeFetcher,
  invalidateRegistrationCache,
} from '../../../services/registrationPolicy.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3/public', publicRoutes);

afterEach(() => {
  __resetRuntimeFetcher();
  invalidateRegistrationCache();
});
beforeEach(() => invalidateRegistrationCache());

describe('ADR-188 F5 — GET /api/v3/public/config', () => {
  test('no auth required — returns 200 with the public contract shape', async () => {
    __setRuntimeFetcher(async () => ({ signup_mode: 'open' }));
    invalidateRegistrationCache();

    const res = await request(app).get('/api/v3/public/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ signup_mode: 'open', referral_enabled: true });
  });

  test('projects runtime signup_mode; referral_enabled true for invite', async () => {
    __setRuntimeFetcher(async () => ({ signup_mode: 'invite' }));
    invalidateRegistrationCache();

    const res = await request(app).get('/api/v3/public/config');

    expect(res.status).toBe(200);
    expect(res.body.data.signup_mode).toBe('invite');
    // invite = "only users with a valid referral/invite code can register" → referral IS the door
    expect(res.body.data.referral_enabled).toBe(true);
  });

  test('closed signup → referral_enabled false (no self-registration door)', async () => {
    __setRuntimeFetcher(async () => ({ signup_mode: 'closed' }));
    invalidateRegistrationCache();

    const res = await request(app).get('/api/v3/public/config');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ signup_mode: 'closed', referral_enabled: false });
  });

  test('never leaks sensitive policy fields (roles / auto_join / landing)', async () => {
    __setRuntimeFetcher(async () => ({ signup_mode: 'open', default_role: 'user' }));
    invalidateRegistrationCache();

    const res = await request(app).get('/api/v3/public/config');

    expect(Object.keys(res.body.data).sort()).toEqual(['referral_enabled', 'signup_mode']);
    expect(res.body.data).not.toHaveProperty('default_role');
    expect(res.body.data).not.toHaveProperty('auto_join');
    expect(res.body.data).not.toHaveProperty('landing_space');
  });
});
