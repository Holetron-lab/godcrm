// @vitest-environment node
/**
 * ADR-0040 — Secrets API access gate.
 *
 * The gate resolves the caller's role FROM THE SPACE (owner_id + the space's
 * access_control users table via checkUserAccessViaTableV2), never from the
 * global users.role. Owner and space-admin pass; everyone else gets 403 and
 * no vault / table call is made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbGet = vi.fn();
const mockDbAll = vi.fn();
const mockTableAccess = vi.fn();
const mockEnsureTable = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...a) => mockDbGet(...a),
  dbAll: (...a) => mockDbAll(...a),
  dbRun: vi.fn(),
  safeJsonParse: (raw, fallback = null) => {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));
vi.mock('../../../services/space/access.js', () => ({
  checkUserAccessViaTableV2: (...a) => mockTableAccess(...a),
}));
vi.mock('../../../services/secrets/SecretsVault.js', () => ({
  default: { putSecret: vi.fn(), revealSecret: vi.fn(), deleteSecret: vi.fn() },
}));
vi.mock('../../../services/secrets/secretsSystemTable.js', () => ({
  validateKey: (k) => ({ ok: true, value: k }),
}));
vi.mock('../../../services/SystemTablesCreator.js', () => ({
  ensureSecretsSystemTableForSpace: (...a) => mockEnsureTable(...a),
}));
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const { default: router } = await import('../secrets.js');

const OWNER_ID = 1;
const MEMBER_ID = 42;
const SPACE_ID = 11;
const ACCESS_CONTROL = {
  enabled: true,
  users_table_id: 1782,
  role_column_id: '13257',
  role_mappings: [
    { columnValue: 'admin', accessLevel: 'admin' },
    { columnValue: 'editor', accessLevel: 'editor' },
  ],
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.get('x-test-user');
    if (id) req.user = { id: Number(id), email: 'test@example.com', role: req.get('x-test-role') || 'user' };
    next();
  });
  app.use('/api/v3/secrets', router);
  return app;
}

function spaceRow(access_control = ACCESS_CONTROL) {
  return { id: SPACE_ID, owner_id: OWNER_ID, access_control };
}

describe('secrets API — role comes from the space', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
    mockDbAll.mockResolvedValue([]);
    mockEnsureTable.mockResolvedValue(777);
  });

  it('owner passes without consulting the users table', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow());
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(OWNER_ID));
    expect(res.status).toBe(200);
    expect(mockTableAccess).not.toHaveBeenCalled();
  });

  it('space admin (role from access_control users table) passes', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow());
    mockTableAccess.mockResolvedValueOnce({ allowed: true, accessLevel: 'admin' });
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID));
    expect(res.status).toBe(200);
    expect(mockTableAccess).toHaveBeenCalledWith(MEMBER_ID, ACCESS_CONTROL);
    expect(mockEnsureTable).toHaveBeenCalledWith(SPACE_ID);
  });

  it('parses access_control stored as a JSON string', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow(JSON.stringify(ACCESS_CONTROL)));
    mockTableAccess.mockResolvedValueOnce({ allowed: true, accessLevel: 'admin' });
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID));
    expect(res.status).toBe(200);
    expect(mockTableAccess).toHaveBeenCalledWith(MEMBER_ID, ACCESS_CONTROL);
  });

  it('space editor is refused and nothing is touched', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow());
    mockTableAccess.mockResolvedValueOnce({ allowed: true, accessLevel: 'editor' });
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID));
    expect(res.status).toBe(403);
    expect(mockEnsureTable).not.toHaveBeenCalled();
  });

  it('global users.role=admin is NOT enough when the space says otherwise', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow());
    mockTableAccess.mockResolvedValueOnce({ allowed: false, accessLevel: null });
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID))
      .set('x-test-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('non-owner on a space without access_control is refused', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow(null));
    const res = await request(app)
      .get(`/api/v3/secrets?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID));
    expect(res.status).toBe(403);
    expect(mockTableAccess).not.toHaveBeenCalled();
  });

  it('the same gate guards mutating routes (reveal)', async () => {
    mockDbGet.mockResolvedValueOnce(spaceRow());
    mockTableAccess.mockResolvedValueOnce({ allowed: true, accessLevel: 'viewer' });
    const res = await request(app)
      .post(`/api/v3/secrets/some_key/reveal?space_id=${SPACE_ID}`)
      .set('x-test-user', String(MEMBER_ID));
    expect(res.status).toBe(403);
  });
});
