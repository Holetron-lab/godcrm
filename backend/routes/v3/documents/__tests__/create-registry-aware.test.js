// #3 fix — POST /projects/:projectId/documents must be registry-aware.
//
// A documents widget bound to a CUSTOM registry (e.g. the public space's
// _registry, whose folder_path doesn't match the project default) passes
// `registry_table_id` explicitly. The create handler must then:
//   1. resolve THAT registry row directly (not project_id + folder_path LIKE),
//   2. authorize against the registry's OWNER project, not the URL :projectId,
//   3. insert the document_content table under that owner project + folder.
//
// We mock _helpers.js so no live DB is needed — the assertions target the
// branch logic that is the actual bug fix (read/write registry asymmetry).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

const URL_PROJECT_ID = '11';        // project in the URL
const REGISTRY_OWNER_PROJECT = 999; // project that actually owns the custom registry
const CUSTOM_REGISTRY_ID = 2365;    // public-space _registry
const REGISTRY_FOLDER = 'databases/public-docs/';

const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  requireEditorAccess: vi.fn(),
  createTableColumns: vi.fn(),
}));

vi.mock('../_helpers.js', () => ({
  dbAll: vi.fn(async () => []),
  dbGet: mocks.dbGet,
  dbRun: mocks.dbRun,
  isPostgres: () => true,
  safeJsonParse: (s, d) => { try { return JSON.parse(s); } catch { return d; } },
  generateBaseId: () => 'base_test',
  apiLogger: { info: () => {}, warn: () => {}, error: () => {} },
  success: (res, data) => res.status(200).json({ success: true, data }),
  created: (res, data) => res.status(201).json({ success: true, data }),
  error: (res, code, message, status = 500, extra) =>
    res.status(status).json({ error: { code, message, ...extra } }),
  badRequest: (res, message) => res.status(400).json({ error: { code: 'BAD_REQUEST', message } }),
  notFound: (res, message) => res.status(404).json({ error: { code: 'NOT_FOUND', message } }),
  requireEditorAccess: mocks.requireEditorAccess,
  slugify: (s) => String(s).toLowerCase().replace(/\s+/g, '-'),
  createTableColumns: mocks.createTableColumns,
  REGISTRY_COLUMNS: [], ATOMS_COLUMNS: [], DOCUMENT_TABLE_COLUMNS: [],
}));

const { default: crudRouter } = await import('../crud.js');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); }); // stand-in for authenticate
  app.use('/api/v3', crudRouter);
  return new Promise((resolve) => {
    const server = createServer(app).listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe('POST /projects/:projectId/documents — registry-aware create (#3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEditorAccess.mockResolvedValue(true);
    mocks.createTableColumns.mockResolvedValue(undefined);
    // dbRun: registry-row insert → id 5001; doc_content table insert → id 7001; updates → noop
    mocks.dbRun.mockImplementation(async (sql) => {
      if (/INSERT INTO table_rows/i.test(sql)) return { lastInsertRowid: 5001 };
      if (/INSERT INTO universal_tables/i.test(sql)) return { lastInsertRowid: 7001 };
      return {};
    });
  });

  it('resolves the explicit registry and authorizes against its owner project', async () => {
    mocks.dbGet.mockImplementation(async (sql) => {
      // explicit registry lookup by id
      if (/project_id, folder_path FROM universal_tables WHERE id = \? AND name = '_registry'/i.test(sql))
        return { id: CUSTOM_REGISTRY_ID, project_id: REGISTRY_OWNER_PROJECT, folder_path: REGISTRY_FOLDER };
      if (/name = '_atoms'/i.test(sql)) return { id: 4242 };
      return null; // no existing slug, no status col, no bdd widget
    });

    const ctx = await startApp();
    try {
      const res = await fetch(`${ctx.baseUrl}/api/v3/projects/${URL_PROJECT_ID}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Public Door', registry_table_id: CUSTOM_REGISTRY_ID }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.document_id).toBe(5001);

      // authorized against the registry owner (999), NOT the URL project (11)
      expect(mocks.requireEditorAccess).toHaveBeenCalledTimes(1);
      const authProjectArg = mocks.requireEditorAccess.mock.calls[0][2];
      expect(authProjectArg).toBe(REGISTRY_OWNER_PROJECT);
      expect(String(authProjectArg)).not.toBe(URL_PROJECT_ID);

      // the registry row + doc_content table were inserted under the owner project + its folder
      const docTableInsert = mocks.dbRun.mock.calls.find(([sql]) => /document_content/i.test(sql));
      expect(docTableInsert).toBeDefined();
      const params = docTableInsert[1];
      expect(params[0]).toBe(REGISTRY_OWNER_PROJECT);     // project_id
      expect(params).toContain(REGISTRY_FOLDER);          // folder_path from registry row
    } finally {
      await new Promise((r) => ctx.server.close(r));
    }
  });

  it('400s when registry_table_id does not resolve to a registry', async () => {
    mocks.dbGet.mockResolvedValue(null); // nothing resolves
    const ctx = await startApp();
    try {
      const res = await fetch(`${ctx.baseUrl}/api/v3/projects/${URL_PROJECT_ID}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Orphan', registry_table_id: 123456 }),
      });
      expect(res.status).toBe(400);
      expect(mocks.requireEditorAccess).not.toHaveBeenCalled(); // rejected before auth/writes
    } finally {
      await new Promise((r) => ctx.server.close(r));
    }
  });

  it('falls back to project_id + folder_path resolution when registry_table_id is absent', async () => {
    mocks.dbGet.mockImplementation(async (sql) => {
      if (/name = '_registry'/i.test(sql)) return { id: 111 };
      if (/name = '_atoms'/i.test(sql)) return { id: 222 };
      return null;
    });
    const ctx = await startApp();
    try {
      const res = await fetch(`${ctx.baseUrl}/api/v3/projects/${URL_PROJECT_ID}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Legacy Doc' }),
      });
      expect(res.status).toBe(201);
      // legacy path authorizes against the URL project
      expect(mocks.requireEditorAccess.mock.calls[0][2]).toBe(URL_PROJECT_ID);
    } finally {
      await new Promise((r) => ctx.server.close(r));
    }
  });
});
