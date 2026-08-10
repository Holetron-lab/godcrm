// ADR-0016 Phase 1 §4 — GET /documents/snapshot integration tests.
//
// Focus: path-traversal protection (the security-critical bit) plus a
// happy-path read of an actual snapshot file under
// /root/production/business-crm/docs/.snapshots/. We mount the router
// directly without auth — the real app gates this behind `authenticate`
// in server.js — so we can exercise the path logic in isolation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';

import snapshotsRouter from '../snapshots.js';

const SNAPSHOTS_BASE = '/root/production/business-crm/docs/.snapshots';

function startApp() {
  const app = express();
  // Mount under /api/v3 like the real router does
  app.use('/api/v3', snapshotsRouter);
  return new Promise((resolve) => {
    const server = createServer(app).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function stopApp({ server }) {
  await new Promise((r) => server.close(r));
}

describe('GET /api/v3/documents/snapshot (ADR-0016)', () => {
  let ctx;
  let fixtureRel;

  beforeAll(async () => {
    ctx = await startApp();

    // Create a tiny fixture inside SNAPSHOTS_BASE so the happy path has
    // something deterministic to read.
    const dir = path.join(SNAPSHOTS_BASE, '.test-fileguard');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'fixture.md');
    await fs.writeFile(file, '# fixture\n', 'utf8');
    fixtureRel = path.relative(SNAPSHOTS_BASE, file);
  });

  afterAll(async () => {
    try {
      await fs.rm(path.join(SNAPSHOTS_BASE, '.test-fileguard'), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    await stopApp(ctx);
  });

  it('400 when `path` query param is missing', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v3/documents/snapshot`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_PATH');
  });

  it('400 on path traversal (../../etc/passwd)', async () => {
    const url = `${ctx.baseUrl}/api/v3/documents/snapshot?path=${encodeURIComponent('../../etc/passwd')}`;
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('PATH_TRAVERSAL');
  });

  it('400 on absolute-path traversal (/etc/passwd)', async () => {
    // path.resolve(BASE, '/etc/passwd') === '/etc/passwd' → outside BASE
    const url = `${ctx.baseUrl}/api/v3/documents/snapshot?path=${encodeURIComponent('/etc/passwd')}`;
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('PATH_TRAVERSAL');
  });

  it('404 when the file does not exist (but path is inside the base)', async () => {
    const url = `${ctx.baseUrl}/api/v3/documents/snapshot?path=${encodeURIComponent('does-not-exist/nope.md')}`;
    const res = await fetch(url);
    expect(res.status).toBe(404);
  });

  it('200 + markdown content-type for a valid snapshot path', async () => {
    const url = `${ctx.baseUrl}/api/v3/documents/snapshot?path=${encodeURIComponent(fixtureRel)}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    const text = await res.text();
    expect(text).toContain('# fixture');
  });
});
