/**
 * Auth API Routes Tests (v3) - ADR-064 Phase 2, Task 6
 * Testing REST API endpoints for authentication
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import authRoutes from '../auth.js';
import { dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { __setRuntimeFetcher, __resetRuntimeFetcher, invalidateRegistrationCache } from '../../../services/registrationPolicy.js';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'godcrm_refresh';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3/auth', authRoutes);

async function createTestUser(email = null, password = 'TestPass123!', role = 'user') {
  const uniqueEmail = email || `test-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, role) VALUES (?, ?, ?, ?, ?, ?)',
    [uniqueEmail, passwordHash, 'Test User', 'encrypted_key', 1, role]
  );
  return { id: result.lastInsertRowid, email: uniqueEmail, password, role };
}

describe('Auth API Routes (v3) - ADR-064', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';
    await resetAdapter();
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // POST /api/v3/auth/register
  // ============================================================
  describe('POST /api/v3/auth/register', () => {
    test('should register a new user with valid data', async () => {
      const email = `register-${Date.now()}@hltrn.cc`;
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email, password: 'ValidPass123!', name: 'New User' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.accessToken).toBeDefined();
    });

    test('should reject duplicate email', async () => {
      const user = await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: user.email, password: 'AnotherPass123!', name: 'Dup' })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('USER_EXISTS');
    });

    test('should reject missing email', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ password: 'ValidPass123!', name: 'NoEmail' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing password', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `nopass-${Date.now()}@hltrn.cc`, name: 'NoPass' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    test('should reject weak password', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `weak-${Date.now()}@hltrn.cc`, password: 'short', name: 'Weak' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
    });

    // ADR-183 Block A — viewer default for community sign-ups
    test('community sign-up lands as viewer', async () => {
      // Seed a prior user so the community registrant is not the first-user/owner.
      await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `community-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Street', community: true })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('viewer');
    });

    test('regular sign-up stays a normal user (not viewer, not levelled down)', async () => {
      await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `regular-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Normal' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('user');
    });

    // ADR-183 Block F4 (enforce) — signup_mode gates the anonymous front door.
    // Runtime policy is driven via the test seam (no DB); the 60s cache is evicted
    // after each swap. GERATRON's "выключить регистрацию в настройках" = closed/invite.
    describe('signup_mode enforcement (Block F4)', () => {
      const setMode = (mode) => {
        __setRuntimeFetcher(async () => ({ signup_mode: mode }));
        invalidateRegistrationCache();
      };
      afterEach(() => {
        __resetRuntimeFetcher();
        invalidateRegistrationCache();
      });

      test('closed: anonymous self-registration is rejected (403) and no user is created', async () => {
        await createTestUser();               // ensure the registrant is NOT the first-user/owner
        setMode('closed');
        const email = `closed-${Date.now()}@hltrn.cc`;
        const res = await request(app)
          .post('/api/v3/auth/register')
          .send({ email, password: 'ValidPass123!', name: 'Blocked' })
          .expect(403);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('REGISTRATION_NOT_ALLOWED');
        const row = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        expect(row).toBeFalsy();              // gate rejects BEFORE the INSERT
      });

      test('invite: a sign-up carrying NO inviter code is rejected (403)', async () => {
        await createTestUser();
        setMode('invite');
        const res = await request(app)
          .post('/api/v3/auth/register')
          .send({ email: `inv-none-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'NoCode' })
          .expect(403);

        expect(res.body.error.code).toBe('REGISTRATION_NOT_ALLOWED');
      });

      test('invite: a sign-up carrying a VALID inviter code passes (201) and sets referred_by', async () => {
        // Mint an inviter while the door is open, then close it to invite-only.
        __setRuntimeFetcher(async () => null);   // → env preset 'standard' = open
        invalidateRegistrationCache();
        const inviterRes = await request(app)
          .post('/api/v3/auth/register')
          .send({ email: `inviter-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Inviter' })
          .expect(201);
        const code = inviterRes.body.data.user.referral_code;

        setMode('invite');
        const email = `invited-${Date.now()}@hltrn.cc`;
        const res = await request(app)
          .post('/api/v3/auth/register')
          .send({ email, password: 'ValidPass123!', name: 'Invited', referral_code: code })
          .expect(201);

        expect(res.body.success).toBe(true);
        const invitee = await dbGet('SELECT referred_by FROM users WHERE email = ?', [email]);
        const inviter = await dbGet('SELECT id FROM users WHERE referral_code = ?', [code]);
        expect(Number(invitee.referred_by)).toBe(Number(inviter.id));
      });
    });

    // ADR-183 Block C + ADR-183-A — referral graph & NAMED codes.
    // ADR-183-A D1/D2: canonical shape is `<name-slug>-<suffix>`, all lowercase.
    const NAMED_CODE = /^[a-z0-9-]{1,20}-[a-z2-9]{8}$/;

    // AC#1 — mint format + same-name suffix uniqueness.
    test('each new user gets a unique named referral_code (<slug>-<suffix>)', async () => {
      const mk = () => request(app)
        .post('/api/v3/auth/register')
        .send({ email: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@hltrn.cc`, password: 'ValidPass123!', name: 'Ref' })
        .expect(201);

      const a = await mk();
      const b = await mk();
      expect(a.body.data.user.referral_code).toMatch(NAMED_CODE);
      expect(b.body.data.user.referral_code).toMatch(NAMED_CODE);
      // Prefix reflects the name; the suffix keeps two same-name users distinct.
      expect(a.body.data.user.referral_code.startsWith('ref-')).toBe(true);
      expect(b.body.data.user.referral_code.startsWith('ref-')).toBe(true);
      expect(a.body.data.user.referral_code).not.toBe(b.body.data.user.referral_code);
    });

    // AC#1 — Cyrillic name transliterates via the reused slugify() map.
    test('Cyrillic name transliterates into the prefix (Пётр → pyotr-…)', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `cyr-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Пётр' })
        .expect(201);
      expect(res.body.data.user.referral_code).toMatch(/^pyotr-[a-z2-9]{8}$/);
    });

    // AC#1 — name with no transliterable chars falls back to `user`.
    test('unslugifiable name falls back to user-… prefix', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `nemo-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: '日本語' })
        .expect(201);
      expect(res.body.data.user.referral_code).toMatch(/^user-[a-z2-9]{8}$/);
    });

    test('inbound referral_code sets referred_by; graph resolves both directions', async () => {
      const inviterRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `inviter-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Inviter' })
        .expect(201);
      const inviterId = inviterRes.body.data.user.id;
      const inviterCode = inviterRes.body.data.user.referral_code;

      const inviteeRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `invitee-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Invitee', referral_code: inviterCode })
        .expect(201);
      const inviteeId = inviteeRes.body.data.user.id;

      // forward: whom did the inviter refer → the invitee
      const referred = await dbGet('SELECT referred_by FROM users WHERE id = ?', [inviteeId]);
      expect(Number(referred.referred_by)).toBe(Number(inviterId));

      // reverse: who vouches for the invitee → the inviter
      const back = await dbGet('SELECT id FROM users WHERE referred_by = ?', [inviterId]);
      expect(Number(back.id)).toBe(Number(inviteeId));
    });

    // AC#3 / D4 — inbound matching is case-insensitive against the lowercase code.
    test('uppercase / whitespace inbound code still resolves (case-insensitive)', async () => {
      const inviterRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `inv2-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Inv2' })
        .expect(201);
      const inviterId = inviterRes.body.data.user.id;
      const code = inviterRes.body.data.user.referral_code;

      const inviteeRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `inv2ee-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Inv2ee', referral_code: `  ${code.toUpperCase()}  ` })
        .expect(201);

      const referred = await dbGet('SELECT referred_by FROM users WHERE id = ?', [inviteeRes.body.data.user.id]);
      expect(Number(referred.referred_by)).toBe(Number(inviterId));
    });

    // AC#3 — unknown / blank code never hard-fails registration.
    test('unknown referral_code is ignored (referred_by null, sign-up still succeeds)', async () => {
      const res = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `noref-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'NoRef', referral_code: 'ZZZZZZZZ' })
        .expect(201);

      expect(res.body.success).toBe(true);
      const row = await dbGet('SELECT referred_by FROM users WHERE id = ?', [res.body.data.user.id]);
      expect(row.referred_by == null).toBe(true);
    });

    // AC#2 / D3 — self-service regeneration: prefix frozen, suffix rerolled, incoming
    // edge (referred_by — who invited them) untouched. Only the outgoing code changes.
    test('POST /referral-code/regenerate keeps prefix, rerolls suffix, preserves referred_by', async () => {
      const inviterRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `regen-inv-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'RegenInviter' })
        .expect(201);
      const inviterId = inviterRes.body.data.user.id;

      const inviteeRes = await request(app)
        .post('/api/v3/auth/register')
        .send({ email: `regen-ee-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'Иван', referral_code: inviterRes.body.data.user.referral_code })
        .expect(201);
      const inviteeId = inviteeRes.body.data.user.id;
      const oldCode = inviteeRes.body.data.user.referral_code;   // ivan-xxxxxxxx
      const token = inviteeRes.body.data.accessToken;

      const regen = await request(app)
        .post('/api/v3/auth/referral-code/regenerate')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const newCode = regen.body.data.referral_code;

      expect(newCode).toMatch(/^ivan-[a-z2-9]{8}$/);
      // Same frozen prefix (everything before the LAST '-'), fresh full code.
      expect(newCode.slice(0, newCode.lastIndexOf('-'))).toBe(oldCode.slice(0, oldCode.lastIndexOf('-')));
      expect(newCode).not.toBe(oldCode);

      const row = await dbGet('SELECT referral_code, referred_by FROM users WHERE id = ?', [inviteeId]);
      expect(row.referral_code).toBe(newCode);                  // outgoing code changed…
      expect(Number(row.referred_by)).toBe(Number(inviterId));  // …incoming edge untouched.
    });

    test('regenerate requires auth (401 without token)', async () => {
      await request(app)
        .post('/api/v3/auth/referral-code/regenerate')
        .expect(401);
    });

    // AC#5 / D6 — promo_enabled=false skips applyPromoUnlock SERVER-SIDE (defence-in-depth).
    test('promo_enabled=false → Tier-B promo unlock is skipped server-side', async () => {
      await dbRun(
        `INSERT INTO _app_settings (key, value) VALUES ('promo_enabled', 'false'::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
      try {
        const res = await request(app)
          .post('/api/v3/auth/register')
          .send({ email: `promo-off-${Date.now()}@hltrn.cc`, password: 'ValidPass123!', name: 'PromoOff', promo_code: 'MASTERMIND' })
          .expect(201);
        // Let any fire-and-forget settle; with the gate closed the unlock never runs.
        await new Promise((r) => setTimeout(r, 150));
        const row = await dbGet('SELECT agent_config FROM users WHERE id = ?', [res.body.data.user.id]);
        const cfg = row.agent_config
          ? (typeof row.agent_config === 'string' ? JSON.parse(row.agent_config) : row.agent_config)
          : {};
        expect(cfg.unlocked_agent_slugs == null).toBe(true);
      } finally {
        await dbRun(`DELETE FROM _app_settings WHERE key = 'promo_enabled'`);
      }
    });
  });

  // ============================================================
  // POST /api/v3/auth/login
  // ============================================================
  describe('POST /api/v3/auth/login', () => {
    test('should login with valid credentials', async () => {
      const user = await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(user.email);
      expect(res.body.data.accessToken).toBeDefined();
    });

    test('should set refresh token cookie on login', async () => {
      const user = await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = cookies.find(c => c.includes(REFRESH_COOKIE_NAME));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
    });

    test('should reject wrong password', async () => {
      const user = await createTestUser();
      const res = await request(app)
        .post('/api/v3/auth/login')
        .send({ email: user.email, password: 'WrongPass123!' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject non-existent email', async () => {
      const res = await request(app)
        .post('/api/v3/auth/login')
        .send({ email: 'nonexistent@hltrn.cc', password: 'SomePass123!' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/v3/auth/login')
        .send({ email: 'test@hltrn.cc' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/auth/refresh
  // ============================================================
  describe('POST /api/v3/auth/refresh', () => {
    test('should refresh with valid refresh token in cookie', async () => {
      const user = await createTestUser();
      const refreshToken = jwt.sign(
        { id: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      const res = await request(app)
        .post('/api/v3/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
    });

    test('should reject expired refresh token', async () => {
      const user = await createTestUser();
      const refreshToken = jwt.sign(
        { id: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '0s' }
      );
      await new Promise(resolve => setTimeout(resolve, 100));

      const res = await request(app)
        .post('/api/v3/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`)
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    test('should reject missing refresh token', async () => {
      const res = await request(app)
        .post('/api/v3/auth/refresh')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NO_REFRESH_TOKEN');
    });
  });

  // ============================================================
  // GET /api/v3/auth/me
  // ============================================================
  describe('GET /api/v3/auth/me', () => {
    test('should return current user with valid token', async () => {
      const user = await createTestUser();
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '30m' }
      );

      const res = await request(app)
        .get('/api/v3/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.email).toBe(user.email);
    });

    test('should reject without token', async () => {
      const res = await request(app)
        .get('/api/v3/auth/me')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    test('should reject with invalid token', async () => {
      const res = await request(app)
        .get('/api/v3/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/auth/logout
  // ============================================================
  describe('POST /api/v3/auth/logout', () => {
    test('should logout successfully', async () => {
      const res = await request(app)
        .post('/api/v3/auth/logout')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('logged_out');
    });
  });
});
