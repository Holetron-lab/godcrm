// backend/middleware/__tests__/corsConfig.test.js
// ADR-064 Phase 1 Task 4: Strict CORS in Production
// Tests for CORS origin validation logic
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CORS Configuration (ADR-064)', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
    // Reset modules cache so each test gets fresh config
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('createCorsOriginHandler', () => {
    describe('Production mode without CORS_ORIGINS', () => {
      it('should reject requests with an error when CORS_ORIGINS is not set', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://evil.com', callback);

        expect(callback).toHaveBeenCalledWith(expect.any(Error));
        expect(callback.mock.calls[0][0].message).toMatch(/CORS not configured/);
      });

      it('should reject even requests with no origin in production without config', async () => {
        // In production without CORS_ORIGINS, the error should fire before origin check
        process.env.NODE_ENV = 'production';
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler(undefined, callback);

        // The production-no-config error takes precedence
        expect(callback).toHaveBeenCalledWith(expect.any(Error));
        expect(callback.mock.calls[0][0].message).toMatch(/CORS not configured/);
      });

      it('should reject when CORS_ORIGINS is empty string in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = '';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://evil.com', callback);

        expect(callback).toHaveBeenCalledWith(expect.any(Error));
        expect(callback.mock.calls[0][0].message).toMatch(/CORS not configured/);
      });
    });

    describe('Production mode with CORS_ORIGINS configured', () => {
      it('should allow whitelisted origins', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'https://crm.hltrn.cc,https://devcrm.hltrn.cc';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://crm.hltrn.cc', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should block non-whitelisted origins', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'https://crm.hltrn.cc';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://evil.com', callback);

        expect(callback).toHaveBeenCalledWith(expect.any(Error));
        expect(callback.mock.calls[0][0].message).toMatch(/Not allowed by CORS/);
      });

      it('should allow requests with no origin (server-to-server, curl)', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'https://crm.hltrn.cc';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler(undefined, callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should allow null origin (server-to-server)', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'https://crm.hltrn.cc';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler(null, callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });
    });

    describe('Development mode without CORS_ORIGINS', () => {
      it('should allow all origins when CORS_ORIGINS is not set', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('http://localhost:5173', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should allow any arbitrary origin in dev without config', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://anything.example.com', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should allow requests with no origin in dev', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler(undefined, callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });
    });

    describe('Development mode with CORS_ORIGINS configured', () => {
      it('should allow whitelisted origins', async () => {
        process.env.NODE_ENV = 'development';
        process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5001';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('http://localhost:5173', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should block non-whitelisted origins even in dev when configured', async () => {
        process.env.NODE_ENV = 'development';
        process.env.CORS_ORIGINS = 'http://localhost:5173';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://evil.com', callback);

        expect(callback).toHaveBeenCalledWith(expect.any(Error));
        expect(callback.mock.calls[0][0].message).toMatch(/Not allowed by CORS/);
      });

      it('should allow requests with no origin in dev even when configured', async () => {
        process.env.NODE_ENV = 'development';
        process.env.CORS_ORIGINS = 'http://localhost:5173';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler(undefined, callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });
    });

    describe('CORS_ORIGINS parsing', () => {
      it('should trim whitespace from origins', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = '  https://crm.hltrn.cc , https://devcrm.hltrn.cc  ';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('https://crm.hltrn.cc', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });

      it('should filter empty entries from comma-separated list', async () => {
        process.env.NODE_ENV = 'production';
        process.env.CORS_ORIGINS = 'https://crm.hltrn.cc,,,,https://devcrm.hltrn.cc';

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback1 = vi.fn();
        handler('https://crm.hltrn.cc', callback1);
        expect(callback1).toHaveBeenCalledWith(null, true);

        const callback2 = vi.fn();
        handler('https://devcrm.hltrn.cc', callback2);
        expect(callback2).toHaveBeenCalledWith(null, true);
      });
    });

    describe('Default NODE_ENV (undefined)', () => {
      it('should behave like development when NODE_ENV is not set', async () => {
        delete process.env.NODE_ENV;
        delete process.env.CORS_ORIGINS;

        const { createCorsOriginHandler } = await import('../corsConfig.js');
        const handler = createCorsOriginHandler();

        const callback = vi.fn();
        handler('http://localhost:5173', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
      });
    });
  });
});
