/**
 * WorkAdventure Admin API Tests - ADR-063
 * Testing Admin API endpoints for room access control
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../../database/connection.js';
// Import routes (will be created)
import waRoutes from '../index.js';

// Create test app
const app = express();
app.use(express.json());

// Mock authenticate middleware for testing
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
      req.user = decoded;
    } catch (e) {
      // Invalid token - continue without user
    }
  }
  next();
});

app.use('/api/v3/wa', waRoutes);

// Test JWT secret
const TEST_JWT_SECRET = 'test-jwt-secret-for-wa';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// Helper functions
async function createTestUser(role = 'user') {
  const uniqueEmail = `test-wa-${Date.now()}-${Math.random().toString(36).substring(7)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, role, avatar, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', role, 'https://example.com/avatar.png', 'encrypted_key', 1]
  );
  return { id: result.lastInsertRowid, email: uniqueEmail, role };
}

async function createTestSpace(ownerId) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, 'Test Space', 'business']
  );
  return result.lastInsertRowid;
}

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('WorkAdventure Admin API - ADR-063', () => {
  let testUser;
  let adminUser;
  let spaceId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    testUser = await createTestUser('user');
    adminUser = await createTestUser('admin');
    spaceId = await createTestSpace(adminUser.id);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/wa/map
  // ============================================================
  describe('GET /api/v3/wa/map', () => {
    test('should return map URL for authenticated user', async () => {
      const token = createToken(testUser);

      const response = await request(app)
        .get('/api/v3/wa/map')
        .set('Authorization', `Bearer ${token}`)
        .query({ 
          playUri: 'https://play.workadventure.localhost/@/crm/office/main',
          userIdentifier: testUser.email
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.mapUrl).toBeDefined();
      expect(response.body.data.mapUrl).toContain('.json');
    });

    test('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v3/wa/map')
        .query({ 
          playUri: 'https://play.workadventure.localhost/@/crm/office/main'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should return default map for unknown room', async () => {
      const token = createToken(testUser);

      const response = await request(app)
        .get('/api/v3/wa/map')
        .set('Authorization', `Bearer ${token}`)
        .query({ 
          playUri: 'https://play.workadventure.localhost/@/crm/unknown/room'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.mapUrl).toBeDefined();
    });
  });

  // ============================================================
  // GET /api/v3/wa/room/access
  // ============================================================
  describe('GET /api/v3/wa/room/access', () => {
    test('should grant access to public room', async () => {
      const token = createToken(testUser);

      const response = await request(app)
        .get('/api/v3/wa/room/access')
        .set('Authorization', `Bearer ${token}`)
        .query({
          playUri: 'https://play.workadventure.localhost/@/crm/public/lobby',
          userIdentifier: testUser.email
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.access).toBe(true);
      expect(response.body.data.tags).toBeDefined();
    });

    test('should deny access to restricted room for regular user', async () => {
      const token = createToken(testUser);

      const response = await request(app)
        .get('/api/v3/wa/room/access')
        .set('Authorization', `Bearer ${token}`)
        .query({
          playUri: 'https://play.workadventure.localhost/@/crm/admin/control-room',
          userIdentifier: testUser.email
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.access).toBe(false);
      expect(response.body.data.reason).toBeDefined();
    });

    test('should grant access to admin room for admin user', async () => {
      const token = createToken(adminUser);

      const response = await request(app)
        .get('/api/v3/wa/room/access')
        .set('Authorization', `Bearer ${token}`)
        .query({
          playUri: 'https://play.workadventure.localhost/@/crm/admin/control-room',
          userIdentifier: adminUser.email
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.access).toBe(true);
    });

    test('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/v3/wa/room/access')
        .query({
          playUri: 'https://play.workadventure.localhost/@/crm/public/lobby'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // GET /api/v3/wa/member
  // ============================================================
  describe('GET /api/v3/wa/member', () => {
    test('should return member info with tags', async () => {
      const token = createToken(testUser);

      const response = await request(app)
        .get('/api/v3/wa/member')
        .set('Authorization', `Bearer ${token}`)
        .query({
          userIdentifier: testUser.email,
          playUri: 'https://play.workadventure.localhost/@/crm/office/main'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe(testUser.email);
      expect(response.body.data.tags).toBeDefined();
      expect(Array.isArray(response.body.data.tags)).toBe(true);
      expect(response.body.data.textures).toBeDefined();
    });

    test('should return admin tag for admin user', async () => {
      const token = createToken(adminUser);

      const response = await request(app)
        .get('/api/v3/wa/member')
        .set('Authorization', `Bearer ${token}`)
        .query({
          userIdentifier: adminUser.email,
          playUri: 'https://play.workadventure.localhost/@/crm/office/main'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tags).toContain('admin');
    });

    test('should return 404 for unknown user', async () => {
      const token = createToken(adminUser);

      const response = await request(app)
        .get('/api/v3/wa/member')
        .set('Authorization', `Bearer ${token}`)
        .query({
          userIdentifier: 'unknown@example.com',
          playUri: 'https://play.workadventure.localhost/@/crm/office/main'
        })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/wa/webhook
  // ============================================================
  describe('POST /api/v3/wa/webhook', () => {
    test('should handle user join event', async () => {
      const response = await request(app)
        .post('/api/v3/wa/webhook')
        .set('X-WA-Webhook-Secret', process.env.WA_WEBHOOK_SECRET || 'test-webhook-secret')
        .send({
          event: 'user.join',
          data: {
            userIdentifier: testUser.email,
            roomId: '@/crm/office/main',
            timestamp: new Date().toISOString()
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processed).toBe(true);

      // Verify presence was recorded
      const presence = await dbGet(
        'SELECT * FROM wa_presence WHERE user_id = ? AND room_id = ?',
        [testUser.id, '@/crm/office/main']
      );
      expect(presence).toBeDefined();
      expect(presence.status).toBe('online');
    });

    test('should handle user leave event', async () => {
      // First, create a presence record
      await dbRun(
        'INSERT INTO wa_presence (user_id, room_id, status, joined_at) VALUES (?, ?, ?, ?)',
        [testUser.id, '@/crm/office/main', 'online', new Date().toISOString()]
      );

      const response = await request(app)
        .post('/api/v3/wa/webhook')
        .set('X-WA-Webhook-Secret', process.env.WA_WEBHOOK_SECRET || 'test-webhook-secret')
        .send({
          event: 'user.leave',
          data: {
            userIdentifier: testUser.email,
            roomId: '@/crm/office/main',
            timestamp: new Date().toISOString()
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify presence was updated
      const presence = await dbGet(
        'SELECT * FROM wa_presence WHERE user_id = ? AND room_id = ?',
        [testUser.id, '@/crm/office/main']
      );
      expect(presence.left_at).toBeDefined();
    });

    test('should reject webhook without secret', async () => {
      const response = await request(app)
        .post('/api/v3/wa/webhook')
        .send({
          event: 'user.join',
          data: {
            userIdentifier: testUser.email,
            roomId: '@/crm/office/main'
          }
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should reject webhook with invalid secret', async () => {
      const response = await request(app)
        .post('/api/v3/wa/webhook')
        .set('X-WA-Webhook-Secret', 'wrong-secret')
        .send({
          event: 'user.join',
          data: {
            userIdentifier: testUser.email,
            roomId: '@/crm/office/main'
          }
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('should handle unknown event gracefully', async () => {
      const response = await request(app)
        .post('/api/v3/wa/webhook')
        .set('X-WA-Webhook-Secret', process.env.WA_WEBHOOK_SECRET || 'test-webhook-secret')
        .send({
          event: 'unknown.event',
          data: {}
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processed).toBe(false);
      expect(response.body.data.reason).toBe('unknown_event');
    });
  });

  // ============================================================
  // GET /api/v3/wa/presence
  // ============================================================
  describe('GET /api/v3/wa/presence', () => {
    test('should return online users in a room', async () => {
      const token = createToken(adminUser);

      // Create presence records
      await dbRun(
        'INSERT INTO wa_presence (user_id, room_id, status, joined_at) VALUES (?, ?, ?, ?)',
        [testUser.id, '@/crm/office/main', 'online', new Date().toISOString()]
      );

      const response = await request(app)
        .get('/api/v3/wa/presence')
        .set('Authorization', `Bearer ${token}`)
        .query({ roomId: '@/crm/office/main' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.users).toBeDefined();
      expect(response.body.data.users.length).toBeGreaterThan(0);
    });

    test('should return all online users without room filter', async () => {
      const token = createToken(adminUser);

      // Clean existing presence records to ensure test isolation
      await dbRun('DELETE FROM wa_presence');

      // Create presence records in different rooms
      await dbRun(
        'INSERT INTO wa_presence (user_id, room_id, status, joined_at) VALUES (?, ?, ?, ?)',
        [testUser.id, '@/crm/office/main', 'online', new Date().toISOString()]
      );
      await dbRun(
        'INSERT INTO wa_presence (user_id, room_id, status, joined_at) VALUES (?, ?, ?, ?)',
        [adminUser.id, '@/crm/office/meeting', 'online', new Date().toISOString()]
      );

      const response = await request(app)
        .get('/api/v3/wa/presence')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.users.length).toBe(2);
    });
  });
});
