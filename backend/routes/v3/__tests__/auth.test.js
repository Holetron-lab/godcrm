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
