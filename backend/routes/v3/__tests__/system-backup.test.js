/**
 * System Backup Endpoint Tests - ADR-064 Phase 1, Task 2
 * Testing shell injection fix in POST /api/v3/system/backups/create
 *
 * Verifies:
 * 1. execFile is used instead of exec (no shell injection)
 * 2. Non-admin/owner users get 403
 * 3. filePath is validated to prevent directory traversal
 * 4. pg_dump failure is handled gracefully
 * 5. PGPASSWORD is passed via env, not command string
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';

// ============================================================
// Mock child_process BEFORE importing system.js
// ============================================================

const mockExecFile = vi.fn((_cmd, _args, _opts, cb) => {
  if (cb) cb(null, '', '');
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile },
    execFile: mockExecFile
  };
});

// Mock database
vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn().mockResolvedValue(null),
  dbRun: vi.fn().mockResolvedValue({ changes: 1 }),
  dbAll: vi.fn().mockResolvedValue([])
}));

// Mock services
vi.mock('../../../services/SMTPService.js', () => ({
  default: {
    validate: vi.fn(),
    generateVerificationCode: vi.fn(() => '123456'),
    sendTestEmail: vi.fn(async () => ({ success: true }))
  }
}));

vi.mock('../../../services/AgentToolsService.js', () => ({
  AGENT_TOOLS: []
}));

vi.mock('swagger-jsdoc', () => ({
  default: vi.fn(() => ({
    openapi: '3.0.3',
    info: { version: '0.003.001' },
    paths: {},
    tags: []
  }))
}));

vi.mock('../../../swagger.config.js', () => ({
  swaggerOptions: {}
}));

// Mock node:fs for backup file operations
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const mockExistsSync = vi.fn((p) => {
    if (typeof p === 'string' && p.includes('/backups/')) return true;
    if (typeof p === 'string' && p.includes('QUICK-START')) return false;
    return false;
  });
  const mockMkdirSync = vi.fn();
  const mockStatSync = vi.fn(() => ({
    size: 1024 * 1024 * 5, // 5MB
    mtime: new Date('2026-01-31T10:00:00Z')
  }));
  const mockReaddirSync = vi.fn(() => []);

  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
      statSync: mockStatSync,
      readdirSync: mockReaddirSync,
      readFileSync: actual.readFileSync
    },
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
    readdirSync: mockReaddirSync,
    readFileSync: actual.readFileSync
  };
});

// Now import the system router (will use mocked modules)
const { default: systemRouter } = await import('../system.js');

// ============================================================
// Test Setup
// ============================================================

function createApp(userOverride) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = userOverride || { id: 1, email: 'admin@test.com', role: 'admin' };
    next();
  });

  app.use('/api/v3/system', systemRouter);
  return app;
}

describe('POST /api/v3/system/backups/create - ADR-064 Shell Injection Fix', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      if (cb) cb(null, '', '');
    });

    process.env.PGDATABASE = 'godcrm_test';
    process.env.PGUSER = 'testuser';
    process.env.PGHOST = 'localhost';
    process.env.POSTGRES_PASSWORD = 'test_password';

    app = createApp();
  });

  afterEach(() => {
    delete process.env.PGDATABASE;
    delete process.env.PGUSER;
    delete process.env.PGHOST;
    delete process.env.POSTGRES_PASSWORD;
  });

  test('should create backup using execFile (no shell) instead of exec', async () => {
    const response = await request(app)
      .post('/api/v3/system/backups/create')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.filename).toMatch(/^godcrm_manual-.*\.sql$/);
    expect(response.body.data.size_mb).toBeDefined();
    expect(response.body.data.created_at).toBeDefined();

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];

    // First arg: binary name (not shell command string)
    expect(callArgs[0]).toBe('pg_dump');

    // Second arg: array of arguments (not a single string)
    expect(Array.isArray(callArgs[1])).toBe(true);
    expect(callArgs[1]).toContain('-h');
    expect(callArgs[1]).toContain('localhost');
    expect(callArgs[1]).toContain('-U');
    expect(callArgs[1]).toContain('testuser');
    expect(callArgs[1]).toContain('-d');
    expect(callArgs[1]).toContain('godcrm_test');
    expect(callArgs[1]).toContain('-f');
    expect(callArgs[1]).toContain('--compress=6');
  });

  test('should pass PGPASSWORD via env option, not in command string', async () => {
    await request(app)
      .post('/api/v3/system/backups/create')
      .expect(200);

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];

    // Third arg: options with env
    const options = callArgs[2];
    expect(options).toBeDefined();
    expect(typeof options).toBe('object');
    expect(options.env).toBeDefined();
    expect(options.env.PGPASSWORD).toBe('test_password');

    // PGPASSWORD must NOT appear in args or command name
    const argsString = JSON.stringify(callArgs[1]);
    expect(argsString).not.toContain('PGPASSWORD');
    expect(callArgs[0]).not.toContain('PGPASSWORD');
  });

  test('should reject non-admin users with 403', async () => {
    const regularUserApp = createApp({ id: 2, email: 'user@test.com', role: 'user' });

    const response = await request(regularUserApp)
      .post('/api/v3/system/backups/create')
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('should allow owner role to create backup', async () => {
    const ownerApp = createApp({ id: 1, email: 'owner@test.com', role: 'owner' });

    const response = await request(ownerApp)
      .post('/api/v3/system/backups/create')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.filename).toBeDefined();
  });

  test('should generate safe filePath within BACKUP_DIR only', async () => {
    await request(app)
      .post('/api/v3/system/backups/create')
      .expect(200);

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];
    const argsArray = callArgs[1];

    const fIndex = argsArray.indexOf('-f');
    expect(fIndex).toBeGreaterThan(-1);

    const filePath = argsArray[fIndex + 1];

    expect(filePath).not.toContain('..');
    expect(filePath).toMatch(/^\/home\/dev2\/backups\/daily\/godcrm_manual-.*\.sql$/);
    expect(filePath).toBe(path.normalize(filePath));
  });

  test('should handle pg_dump failure gracefully', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      if (cb) cb(new Error('pg_dump: connection to server failed'), '', '');
    });

    const response = await request(app)
      .post('/api/v3/system/backups/create');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBeDefined();
  });

  test('should not interpolate env vars with special chars into shell', async () => {
    process.env.PGDATABASE = 'godcrm; rm -rf /';
    process.env.PGUSER = 'user$(whoami)';
    process.env.PGHOST = 'host`id`';

    await request(app)
      .post('/api/v3/system/backups/create')
      .expect(200);

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];

    expect(callArgs[0]).toBe('pg_dump');

    // With execFile, raw values passed as-is (no shell interpretation)
    expect(callArgs[1]).toContain('godcrm; rm -rf /');
    expect(callArgs[1]).toContain('user$(whoami)');
    expect(callArgs[1]).toContain('host`id`');
  });
});

describe('GET /api/v3/system/backups/:filename/download - Path Traversal', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  test('should reject filenames containing double dots', async () => {
    const response = await request(app)
      .get('/api/v3/system/backups/..%2F..%2Fetc%2Fpasswd/download');

    expect(response.status).not.toBe(200);
  });

  test('should reject non-admin users for download', async () => {
    const regularUserApp = createApp({ id: 2, email: 'user@test.com', role: 'user' });

    const response = await request(regularUserApp)
      .get('/api/v3/system/backups/test.sql/download')
      .expect(403);

    expect(response.body.success).toBe(false);
  });
});
