/**
 * OIDC Provider Tests - ADR-063: WorkAdventure Integration
 * Testing OIDC endpoints for WorkAdventure authentication
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
// Import routes (will be created)
import oauthRoutes from '../index.js';

// Create test app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/oauth', oauthRoutes);
app.use('/.well-known', oauthRoutes); // For OIDC discovery

// Test JWT secret
const TEST_JWT_SECRET = 'test-jwt-secret-for-oidc';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.OIDC_ISSUER = 'https://crm.hltrn.cc';

// Helper functions
async function createTestUser() {
  const uniqueEmail = `test-oidc-${Date.now()}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, avatar, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'https://example.com/avatar.png', 'encrypted_key', 1]
  );
  return { id: result.lastInsertRowid, email: uniqueEmail };
}

async function createOidcClient() {
  // Clean up existing client to avoid unique constraint violation
  await dbRun('DELETE FROM oidc_clients WHERE client_id = $1', ['workadventure']);
  const result = await dbRun(
    `INSERT INTO oidc_clients (client_id, client_secret, redirect_uris, name)
     VALUES (?, ?, ?, ?)`,
    ['workadventure', 'wa-secret-123', JSON.stringify(['https://play.workadventure.localhost/oauth/callback']), 'WorkAdventure']
  );
  return result.lastInsertRowid;
}

describe('OIDC Provider - ADR-063', () => {
  let testUser;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    testUser = await createTestUser();
    await createOidcClient();
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /.well-known/openid-configuration
  // ============================================================
  describe('GET /.well-known/openid-configuration', () => {
    test('should return OIDC discovery document', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200);

      expect(response.body.issuer).toBe('https://crm.hltrn.cc');
      expect(response.body.authorization_endpoint).toContain('/oauth/authorize');
      expect(response.body.token_endpoint).toContain('/oauth/token');
      expect(response.body.userinfo_endpoint).toContain('/oauth/userinfo');
      expect(response.body.response_types_supported).toContain('code');
      expect(response.body.grant_types_supported).toContain('authorization_code');
      expect(response.body.subject_types_supported).toContain('public');
      expect(response.body.id_token_signing_alg_values_supported).toContain('RS256');
    });
  });

  // ============================================================
  // GET /oauth/authorize
  // ============================================================
  describe('GET /oauth/authorize', () => {
    test('should redirect to login when not authenticated', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'workadventure',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          response_type: 'code',
          scope: 'openid profile email',
          state: 'random-state-123'
        })
        .expect(302);

      expect(response.headers.location).toContain('/login');
      expect(response.headers.location).toContain('redirect=');
    });

    test('should return error for invalid client_id', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'invalid-client',
          redirect_uri: 'https://example.com/callback',
          response_type: 'code',
          scope: 'openid'
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_client');
    });

    test('should return error for invalid redirect_uri', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'workadventure',
          redirect_uri: 'https://malicious.com/callback',
          response_type: 'code',
          scope: 'openid'
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_redirect_uri');
    });

    test('should return authorization code when authenticated', async () => {
      // Create a valid session token
      const sessionToken = jwt.sign(
        { id: testUser.id, email: testUser.email },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/oauth/authorize')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          client_id: 'workadventure',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          response_type: 'code',
          scope: 'openid profile email',
          state: 'random-state-123'
        })
        .expect(302);

      expect(response.headers.location).toContain('https://play.workadventure.localhost/oauth/callback');
      expect(response.headers.location).toContain('code=');
      expect(response.headers.location).toContain('state=random-state-123');
    });
  });

  // ============================================================
  // POST /oauth/token
  // ============================================================
  describe('POST /oauth/token', () => {
    test('should exchange authorization code for tokens', async () => {
      // First, get an authorization code
      const sessionToken = jwt.sign(
        { id: testUser.id, email: testUser.email },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const authResponse = await request(app)
        .get('/oauth/authorize')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          client_id: 'workadventure',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          response_type: 'code',
          scope: 'openid profile email',
          state: 'test-state'
        });

      // Extract code from redirect URL
      const redirectUrl = new URL(authResponse.headers.location);
      const code = redirectUrl.searchParams.get('code');

      // Exchange code for tokens
      const tokenResponse = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          client_id: 'workadventure',
          client_secret: 'wa-secret-123'
        })
        .expect(200);

      expect(tokenResponse.body.access_token).toBeDefined();
      expect(tokenResponse.body.token_type).toBe('Bearer');
      expect(tokenResponse.body.expires_in).toBeGreaterThan(0);
      expect(tokenResponse.body.id_token).toBeDefined();
    });

    test('should return error for invalid code', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: 'invalid-code',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          client_id: 'workadventure',
          client_secret: 'wa-secret-123'
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_grant');
    });

    test('should return error for invalid client credentials', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: 'some-code',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          client_id: 'workadventure',
          client_secret: 'wrong-secret'
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_client');
    });

    test('should return error for unsupported grant_type', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'password',
          username: 'test@example.com',
          password: 'password123'
        })
        .expect(400);

      expect(response.body.error).toBe('unsupported_grant_type');
    });
  });

  // ============================================================
  // GET /oauth/userinfo
  // ============================================================
  describe('GET /oauth/userinfo', () => {
    test('should return user info with valid access token', async () => {
      // Get tokens first
      const sessionToken = jwt.sign(
        { id: testUser.id, email: testUser.email },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
      );

      const authResponse = await request(app)
        .get('/oauth/authorize')
        .set('Authorization', `Bearer ${sessionToken}`)
        .query({
          client_id: 'workadventure',
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          response_type: 'code',
          scope: 'openid profile email'
        });

      const redirectUrl = new URL(authResponse.headers.location);
      const code = redirectUrl.searchParams.get('code');

      const tokenResponse = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: 'https://play.workadventure.localhost/oauth/callback',
          client_id: 'workadventure',
          client_secret: 'wa-secret-123'
        });

      // Get userinfo
      const userinfoResponse = await request(app)
        .get('/oauth/userinfo')
        .set('Authorization', `Bearer ${tokenResponse.body.access_token}`)
        .expect(200);

      expect(userinfoResponse.body.sub).toBe(String(testUser.id));
      expect(userinfoResponse.body.email).toBe(testUser.email);
      expect(userinfoResponse.body.name).toBe('Test User');
      expect(userinfoResponse.body.picture).toBeDefined();
    });

    test('should return 401 without access token', async () => {
      const response = await request(app)
        .get('/oauth/userinfo')
        .expect(401);

      expect(response.body.error).toBe('invalid_token');
    });

    test('should return 401 with invalid access token', async () => {
      const response = await request(app)
        .get('/oauth/userinfo')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('invalid_token');
    });
  });
});
