// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { embedFrameHeaders } from '../embedFrameHeaders.js';

function appWithMiddleware() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'");
    next();
  });
  app.use(embedFrameHeaders);
  app.get('/embed/chat', (_req, res) => res.json({ ok: true }));
  app.get('/other', (_req, res) => res.json({ ok: true }));
  return app;
}

afterEach(() => vi.unstubAllEnvs());

describe('ADR-210 /embed/chat framing carve-out', () => {
  it('is disabled by default and preserves existing headers', async () => {
    vi.stubEnv('EMBED_TICKET_AUTH_ENABLED', 'false');
    const response = await request(appWithMiddleware()).get('/embed/chat').expect(200);
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).not.toContain('frame-ancestors');
  });

  it('allows only the Level admin parent on the exact embed route when enabled', async () => {
    vi.stubEnv('EMBED_TICKET_AUTH_ENABLED', 'true');
    const response = await request(appWithMiddleware()).get('/embed/chat').expect(200);
    expect(response.headers['x-frame-options']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain(
      'frame-ancestors https://admin.sixtynine.ru',
    );
  });

  it('does not change any other route', async () => {
    vi.stubEnv('EMBED_TICKET_AUTH_ENABLED', 'true');
    const response = await request(appWithMiddleware()).get('/other').expect(200);
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).not.toContain('frame-ancestors');
  });
});
