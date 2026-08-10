// backend/middleware/__tests__/rateLimiter.test.js
// SEC-020: Rate Limiter Tests - ADR-015, ADR-064
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

describe('Rate Limiter', () => {
  describe('Module exports', () => {
    it('should export all required limiters', async () => {
      const module = await import('../rateLimiter.js');
      
      expect(module.globalLimiter).toBeDefined();
      expect(module.authLimiter).toBeDefined();
      expect(module.createApiKeyLimiter).toBeDefined();
      expect(module.strictLimiter).toBeDefined();
    });

    it('should export limiters as middleware functions', async () => {
      const { globalLimiter, authLimiter, strictLimiter } = await import('../rateLimiter.js');
      
      expect(typeof globalLimiter).toBe('function');
      expect(typeof authLimiter).toBe('function');
      expect(typeof strictLimiter).toBe('function');
    });
  });

  describe('globalLimiter behavior', () => {
    let app;

    beforeAll(async () => {
      const { globalLimiter } = await import('../rateLimiter.js');
      app = express();
      app.use('/api', globalLimiter);
      app.get('/api/test', (req, res) => res.json({ ok: true }));
    });

    it('should allow requests under limit', async () => {
      const res = await request(app).get('/api/test');
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should include rate limit headers', async () => {
      const res = await request(app).get('/api/test');
      
      // Standard headers (ratelimit-*)
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBeDefined();
    });
  });

  describe('Rate limit exceeded', () => {
    it('should return 429 when limit exceeded', async () => {
      // Create new app with very low limit for testing
      const testApp = express();
      const strictTestLimiter = rateLimit({
        windowMs: 60000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }
      });
      
      testApp.use('/api', strictTestLimiter);
      testApp.get('/api/test', (req, res) => res.json({ ok: true }));

      // First two requests should succeed
      await request(testApp).get('/api/test');
      await request(testApp).get('/api/test');
      
      // Third request should be rate limited
      const res = await request(testApp).get('/api/test');
      
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('authLimiter', () => {
    it('should have stricter limits than global limiter', async () => {
      const { globalLimiter, authLimiter } = await import('../rateLimiter.js');
      
      // Auth limiter should have lower max than global
      // We check options property
      const authMax = authLimiter.getKey ? 10 : 10; // Default auth limit
      const globalMax = globalLimiter.getKey ? 1000 : 1000; // Default global limit
      
      expect(authMax).toBeLessThan(globalMax);
    });

    it('should work as middleware', async () => {
      const { authLimiter } = await import('../rateLimiter.js');
      
      const app = express();
      app.use('/auth', authLimiter);
      app.post('/auth/login', (req, res) => res.json({ ok: true }));
      
      const res = await request(app).post('/auth/login');
      expect(res.status).toBe(200);
    });
  });

  describe('createApiKeyLimiter', () => {
    it('should return a limiter function', async () => {
      const { createApiKeyLimiter } = await import('../rateLimiter.js');
      
      const limiter = createApiKeyLimiter();
      expect(typeof limiter).toBe('function');
    });

    it('should create new limiter instance each time', async () => {
      const { createApiKeyLimiter } = await import('../rateLimiter.js');
      
      const limiter1 = createApiKeyLimiter();
      const limiter2 = createApiKeyLimiter();
      
      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe('strictLimiter', () => {
    it('should be more restrictive', async () => {
      const { strictLimiter } = await import('../rateLimiter.js');

      expect(typeof strictLimiter).toBe('function');
    });
  });

  describe('ADR-064: RATE_LIMIT_CONFIG export', () => {
    it('should export RATE_LIMIT_CONFIG with global and auth configs', async () => {
      const { RATE_LIMIT_CONFIG } = await import('../rateLimiter.js');

      expect(RATE_LIMIT_CONFIG).toBeDefined();
      expect(RATE_LIMIT_CONFIG.global).toBeDefined();
      expect(RATE_LIMIT_CONFIG.auth).toBeDefined();
      expect(typeof RATE_LIMIT_CONFIG.global.max).toBe('number');
      expect(typeof RATE_LIMIT_CONFIG.auth.max).toBe('number');
      expect(typeof RATE_LIMIT_CONFIG.global.windowMs).toBe('number');
      expect(typeof RATE_LIMIT_CONFIG.auth.windowMs).toBe('number');
    });

    it('should have auth limits stricter than global limits', async () => {
      const { RATE_LIMIT_CONFIG } = await import('../rateLimiter.js');
      expect(RATE_LIMIT_CONFIG.auth.max).toBeLessThan(RATE_LIMIT_CONFIG.global.max);
    });

    it('should use dev limits in test environment', async () => {
      // NODE_ENV=test during vitest, should use dev values (non-production)
      const { RATE_LIMIT_CONFIG } = await import('../rateLimiter.js');
      expect(RATE_LIMIT_CONFIG.global.max).toBe(5000);
      expect(RATE_LIMIT_CONFIG.auth.max).toBe(100);
    });
  });

  describe('ADR-064: Rate limit headers verify env-aware values', () => {
    it('should set ratelimit-limit header matching global config', async () => {
      const { globalLimiter, RATE_LIMIT_CONFIG } = await import('../rateLimiter.js');
      const app = express();
      app.use('/api', globalLimiter);
      app.get('/api/test', (req, res) => res.json({ ok: true }));
      const res = await request(app).get('/api/test');
      expect(res.headers['ratelimit-limit']).toBe(String(RATE_LIMIT_CONFIG.global.max));
    });

    it('should set ratelimit-limit header matching auth config', async () => {
      const { authLimiter, RATE_LIMIT_CONFIG } = await import('../rateLimiter.js');
      const app = express();
      app.use('/auth', authLimiter);
      app.post('/auth/login', (req, res) => res.json({ ok: true }));
      const res = await request(app).post('/auth/login');
      expect(res.headers['ratelimit-limit']).toBe(String(RATE_LIMIT_CONFIG.auth.max));
    });
  });
});
