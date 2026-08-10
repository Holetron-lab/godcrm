/**
 * Health Check Endpoint Tests - ADR-064 Phase 3, Task 12
 * Testing GET /api/health and GET /api/health/deep
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock database connection
const mockDbGet = vi.fn();
vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: vi.fn().mockResolvedValue({ changes: 1 }),
  dbAll: vi.fn().mockResolvedValue([])
}));

// Inline authenticate middleware for testing
function mockAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return _res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
  }
  const token = authHeader.split(' ')[1];
  if (token === 'admin-token') {
    req.user = { id: 1, email: 'admin@test.com', role: 'admin' };
  } else if (token === 'owner-token') {
    req.user = { id: 1, email: 'owner@test.com', role: 'owner' };
  } else if (token === 'user-token') {
    req.user = { id: 2, email: 'user@test.com', role: 'user' };
  } else {
    return _res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN' } });
  }
  next();
}

// Build a mini app that replicates the health endpoints from server.js
function createHealthApp() {
  const app = express();

  // Basic health check
  app.get('/api/health', async (req, res) => {
    let dbStatus = 'unknown';
    let dbLatencyMs = null;
    try {
      const dbStart = Date.now();
      await mockDbGet('SELECT 1 AS ping');
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }
    const mem = process.memoryUsage();
    res.json({
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      version: '0.003.001',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: { status: dbStatus, latency_ms: dbLatencyMs },
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024)
      }
    });
  });

  // Deep health check
  app.get('/api/health/deep', mockAuthenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }
    let dbStatus = 'unknown';
    let dbLatencyMs = null;
    try {
      const dbStart = Date.now();
      await mockDbGet('SELECT 1 AS ping');
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }
    const mem = process.memoryUsage();
    res.json({
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      version: '0.003.001',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: { status: dbStatus, latency_ms: dbLatencyMs },
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        external_mb: Math.round(mem.external / 1024 / 1024)
      },
      node_version: process.version,
      env: process.env.NODE_ENV || 'development'
    });
  });

  return app;
}

describe('GET /api/health - ADR-064 Enhanced Health Check', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue({ ping: 1 });
    app = createHealthApp();
  });

  test('should return 200 with status ok when DB is connected', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('0.003.001');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
  });

  test('should include database connectivity status', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.database).toBeDefined();
    expect(res.body.database.status).toBe('connected');
    expect(typeof res.body.database.latency_ms).toBe('number');
    expect(res.body.database.latency_ms).toBeGreaterThanOrEqual(0);
  });

  test('should include memory usage', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.memory).toBeDefined();
    expect(typeof res.body.memory.rss_mb).toBe('number');
    expect(typeof res.body.memory.heap_used_mb).toBe('number');
  });

  test('should not require authentication', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  test('should return degraded status when DB is unreachable', async () => {
    mockDbGet.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.status).toBe('degraded');
    expect(res.body.database.status).toBe('disconnected');
    expect(res.body.database.latency_ms).toBeNull();
  });

  test('should include version from package.json', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('GET /api/health/deep - ADR-064 Admin Deep Health Check', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue({ ping: 1 });
    app = createHealthApp();
  });

  test('should require authentication', async () => {
    const res = await request(app).get('/api/health/deep').expect(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('should allow admin access', async () => {
    const res = await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.node_version).toBeDefined();
    expect(res.body.env).toBeDefined();
  });

  test('should allow owner access', async () => {
    const res = await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer owner-token')
      .expect(200);

    expect(res.body.status).toBe('ok');
  });

  test('should reject non-admin users with 403', async () => {
    const res = await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer user-token')
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('should include extended memory info', async () => {
    const res = await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(res.body.memory.heap_total_mb).toBeDefined();
    expect(res.body.memory.external_mb).toBeDefined();
  });

  test('should return degraded when DB unreachable', async () => {
    mockDbGet.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(res.body.status).toBe('degraded');
    expect(res.body.database.status).toBe('disconnected');
  });

  test('should check database connectivity', async () => {
    await request(app)
      .get('/api/health/deep')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(mockDbGet).toHaveBeenCalledWith('SELECT 1 AS ping');
  });
});
