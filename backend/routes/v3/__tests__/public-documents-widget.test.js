/**
 * ADR-0060 P6/B — Public Documents Widget endpoints.
 *
 * Covers the four widget-scoped routes that back the read-only
 * DocumentsWidget mirror on the public surface:
 *   - GET /s/:slug/widgets/:widgetId/documents          (list)
 *   - GET /s/:slug/widgets/:widgetId/documents/columns  (registry columns)
 *   - GET /s/:slug/widgets/:widgetId/documents/:docSlug (single doc)
 *   - GET /s/:slug/widgets/:widgetId/documents/:docSlug/atoms (per-doc atoms)
 *
 * Hits localhost `godcrm_test` via ADR-0009 isolation (booted by
 * backend/test/setup.js → vitest.config.ts).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import publicRoutes from '../public.js';
import { __resetPublicAccessForTests } from '../../../middleware/publicAccess.js';
import {
  dbRun,
  destroyAdapter,
  resetAdapter
} from '../../../database/connection.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3/public', publicRoutes);

async function createTestUser() {
  const email = `t-pub-docs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const r = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [email, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return r.lastInsertRowid;
}

async function createExternalSpace(ownerId, slug) {
  const r = await dbRun(
    `INSERT INTO spaces (owner_id, name, type, visibility, public_slug)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerId, 'Pub Docs Test', 'business', 'external', slug]
  );
  return r.lastInsertRowid;
}

async function createProject(ownerId, spaceId, isPublic = true) {
  const r = await dbRun(
    `INSERT INTO projects (owner_id, space_id, name, type, is_public)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerId, spaceId, 'Proj', 'business', isPublic]
  );
  return r.lastInsertRowid;
}

async function createTable(projectId, isPublic = true, name = 't') {
  const r = await dbRun(
    `INSERT INTO universal_tables (project_id, name, display_name, is_public)
     VALUES (?, ?, ?, ?)`,
    [projectId, name, name, isPublic]
  );
  return r.lastInsertRowid;
}

async function createColumn(tableId, columnName, type = 'text', configObj = {}, orderIndex = 0) {
  const r = await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tableId, columnName, columnName, type, JSON.stringify(configObj), orderIndex, 1]
  );
  return r.lastInsertRowid;
}

async function createRow(tableId, data) {
  const baseId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by)
     VALUES (?, ?, ?, ?)`,
    [tableId, baseId, JSON.stringify(data), 1]
  );
  return r.lastInsertRowid;
}

async function createDashboard(projectId, isPublic = true) {
  const r = await dbRun(
    `INSERT INTO dashboards (project_id, name, is_public)
     VALUES (?, ?, ?)`,
    [projectId, 'Dash', isPublic]
  );
  return r.lastInsertRowid;
}

async function createWidget(dashboardId, {
  presetName = 'documents',
  title = 'Docs Widget',
  config = {},
  isPublic = true,
  isTemplate = false,
  ownerId = 1
} = {}) {
  const r = await dbRun(
    `INSERT INTO widgets
       (dashboard_id, widget_type, preset_name, title, config, position,
        is_public, is_template, owner_kind, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dashboardId, 'preset', presetName, title,
      JSON.stringify(config),
      JSON.stringify({ x: 0, y: 0, w: 6, h: 4 }),
      isPublic, isTemplate, 'user', ownerId
    ]
  );
  return r.lastInsertRowid;
}

/**
 * Build a fully wired documents-widget fixture: external space + public
 * project + public dashboard + documents widget + registry table with N
 * registry rows, each backed by its own per-doc atoms table containing M
 * atoms.
 */
async function buildDocsWidgetFixture(userId, slug, {
  docs = [],          // [{ slug, name, atoms: [{type, level, order, content_en}] }]
  registryIsPublic = true,
  projectIsPublic = true,
} = {}) {
  const spaceId = await createExternalSpace(userId, slug);
  const projectId = await createProject(userId, spaceId, projectIsPublic);
  const registryTableId = await createTable(projectId, registryIsPublic, '_registry');
  const dashboardId = await createDashboard(projectId, true);
  const widgetId = await createWidget(dashboardId, {
    presetName: 'documents',
    config: { registry_table_id: registryTableId, project_id: projectId },
  });

  const created = [];
  for (let i = 0; i < docs.length; i += 1) {
    const d = docs[i];
    const atomsTableId = await createTable(projectId, true, `_atoms_${i}`);
    // Atoms columns are not strictly required for the route to read raw
    // table_rows.data, but we seed them so column-shape parity exists.
    await createColumn(atomsTableId, 'order', 'number');
    await createColumn(atomsTableId, 'level', 'select');
    await createColumn(atomsTableId, 'type', 'select');
    await createColumn(atomsTableId, 'content_en', 'text');

    const registryRowId = await createRow(registryTableId, {
      name: d.name,
      slug: d.slug,
      description: d.description || '',
      icon: d.icon || '📘',
      category: d.category || null,
      status: d.status || 'published',
      order_index: i,
      table_id: atomsTableId,
      // Authoring-only metadata that must NOT leak into the public response:
      status_id: 99999,
      verified: true,
      plan_verification: { jti: 'secret-jti', verified: true },
      agent_run_id: 12345,
      agent_id: 'agent-x',
      created_by: 1,
      updated_by: 2,
      // Bonus garbage that isn't on the allow-list:
      _internal_cursor: 'abc',
    });

    const atomIds = [];
    for (const atom of d.atoms || []) {
      const atomId = await createRow(atomsTableId, {
        order: atom.order,
        level: atom.level || 'text',
        type: atom.type || 'reference',
        content_en: atom.content_en,
        // Authoring metadata in atom that must NOT leak:
        created_by: 1,
        updated_by: 2,
        last_edited_at: '2026-05-14T00:00:00Z',
        last_edited_by: 1,
        agent_run_id: 99,
      });
      atomIds.push(atomId);
    }
    created.push({
      registryRowId, atomsTableId, atomIds, slug: d.slug, name: d.name,
    });
  }

  return {
    spaceId, projectId, dashboardId, widgetId, registryTableId,
    docs: created,
  };
}

describe('Public Documents Widget Routes (v3) - ADR-0060 P6/B', () => {
  let userId;
  let slug;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    // Same schema-evolution shims as public.test.js (idempotent across runs).
    for (const col of [
      'visibility TEXT',
      'public_slug TEXT',
      'public_password_hash TEXT'
    ]) {
      try { await dbRun(`ALTER TABLE spaces ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of [
      'is_public BOOLEAN NOT NULL DEFAULT FALSE',
      'order_index INTEGER DEFAULT 0'
    ]) {
      try { await dbRun(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of ['is_public BOOLEAN NOT NULL DEFAULT FALSE']) {
      try { await dbRun(`ALTER TABLE universal_tables ADD COLUMN ${col}`); } catch { /* exists */ }
      try { await dbRun(`ALTER TABLE dashboards ADD COLUMN ${col}`); } catch { /* exists */ }
      try { await dbRun(`ALTER TABLE widgets ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    // Additional shims for P6/B: is_template (widgets), table_type
    // (universal_tables — the legacy /s/:slug/docs endpoint queries it),
    // owner_kind / owner_id (widgets — required by createWidget INSERT;
    // present in PROD but missing on a fresh godcrm_test schema).
    try { await dbRun(`ALTER TABLE widgets ADD COLUMN is_template BOOLEAN NOT NULL DEFAULT FALSE`); } catch { /* exists */ }
    try { await dbRun(`ALTER TABLE universal_tables ADD COLUMN table_type TEXT`); } catch { /* exists */ }
    try { await dbRun(`ALTER TABLE widgets ADD COLUMN owner_kind TEXT`); } catch { /* exists */ }
    try { await dbRun(`ALTER TABLE widgets ADD COLUMN owner_id INTEGER`); } catch { /* exists */ }
    // AC15 fixture also inserts projects with type='system_data', which
    // requires the `type` column. Already present in PROD; shim defensively.
    try { await dbRun(`ALTER TABLE projects ADD COLUMN type TEXT`); } catch { /* exists */ }
    // ut.deleted_at is referenced by loadPublicTable + loadPublicDocumentsWidget
    // queries; present on PROD but missing on this DEV's godcrm test schema.
    try { await dbRun(`ALTER TABLE universal_tables ADD COLUMN deleted_at TIMESTAMP NULL`); } catch { /* exists */ }

    userId = await createTestUser();
    slug = `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    __resetPublicAccessForTests();
    try { await dbRun(`DELETE FROM widgets WHERE is_template = true`); } catch { /* ignore */ }
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  describe('GET /s/:slug/widgets/:widgetId/documents — list', () => {
    test('happy path: returns registry rows in order_index order with envelope {rows,total}', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [
          { slug: 'a-intro', name: 'A — Intro', atoms: [] },
          { slug: 'b-deep', name: 'B — Deep Dive', atoms: [] },
          { slug: 'c-faq', name: 'C — FAQ', atoms: [] },
        ],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toHaveLength(3);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.registry_table_id).toBe(fixture.registryTableId);
      expect(res.body.data.rows.map(r => r.data.slug)).toEqual(['a-intro', 'b-deep', 'c-faq']);
    });

    test('AC-B7: scrubs created_by / agent_* / plan_verification / status_id from row data', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 's', name: 'N', atoms: [] }],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents`)
        .expect(200);

      const data = res.body.data.rows[0].data;
      // Allow-list contents
      expect(data.name).toBe('N');
      expect(data.slug).toBe('s');
      // Authoring metadata MUST NOT appear
      expect(data).not.toHaveProperty('created_by');
      expect(data).not.toHaveProperty('updated_by');
      expect(data).not.toHaveProperty('agent_run_id');
      expect(data).not.toHaveProperty('agent_id');
      expect(data).not.toHaveProperty('plan_verification');
      expect(data).not.toHaveProperty('status_id');
      expect(data).not.toHaveProperty('verified');
      expect(data).not.toHaveProperty('_internal_cursor');
    });

    test('AC-B6: 404 when project is private even though widget is public', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 'x', name: 'X', atoms: [] }],
        projectIsPublic: false,
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents`)
        .expect(404);
    });

    test('AC-B7: 404 when widget preset is NOT documents (e.g. table_view)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const registryTableId = await createTable(projectId, true, '_registry');
      const dashboardId = await createDashboard(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { registry_table_id: registryTableId, table_id: registryTableId },
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/documents`)
        .expect(404);
    });

    test('AC-B9: 404 on bad widgetId (non-existent)', async () => {
      await createExternalSpace(userId, slug);
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/99999999/documents`)
        .expect(404);
    });

    test('AC-B8: 404 when widget belongs to a different public space (cross-space leak guard)', async () => {
      // Build the requesting space empty (but public).
      await createExternalSpace(userId, slug);

      // Build a separate space with its own documents widget — confirm it
      // cannot be reached via the first slug.
      const otherSlug = `pd-oth-${Date.now().toString(36)}`;
      const other = await buildDocsWidgetFixture(userId, otherSlug, {
        docs: [{ slug: 'a', name: 'A', atoms: [] }],
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${other.widgetId}/documents`)
        .expect(404);
    });
  });

  describe('GET /s/:slug/widgets/:widgetId/documents/:docSlug — single', () => {
    test('happy path: envelope {row}, data scrubbed', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [
          { slug: 'a', name: 'Doc A', atoms: [] },
          { slug: 'b', name: 'Doc B', atoms: [] },
        ],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/b`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.row).toBeDefined();
      expect(res.body.data.row.data.slug).toBe('b');
      expect(res.body.data.row.data.name).toBe('Doc B');
      // Scrub assertions
      expect(res.body.data.row.data).not.toHaveProperty('created_by');
      expect(res.body.data.row.data).not.toHaveProperty('plan_verification');
    });

    test('AC-B8: 404 on unknown slug', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 'a', name: 'A', atoms: [] }],
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/notreal`)
        .expect(404);
    });
  });

  describe('GET /s/:slug/widgets/:widgetId/documents/:docSlug/atoms — atoms', () => {
    test('happy path: returns atoms ordered by `order` ASC, envelope {rows,total}', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{
          slug: 'doc-1',
          name: 'D',
          atoms: [
            { order: 30, level: 'h2', content_en: 'Third' },
            { order: 10, level: 'h1', content_en: 'First' },
            { order: 20, level: 'text', content_en: 'Second' },
          ],
        }],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/doc-1/atoms`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toHaveLength(3);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.rows.map(r => r.data.content_en)).toEqual([
        'First', 'Second', 'Third',
      ]);
      expect(res.body.data.table_id).toBe(fixture.docs[0].atomsTableId);
    });

    test('AC-B8: scrubs created_by / updated_by / last_edited_at / agent_run_id from atom data', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{
          slug: 'doc-1', name: 'D',
          atoms: [{ order: 10, content_en: 'Hello' }],
        }],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/doc-1/atoms`)
        .expect(200);

      const atom = res.body.data.rows[0].data;
      expect(atom.content_en).toBe('Hello');
      expect(atom).not.toHaveProperty('created_by');
      expect(atom).not.toHaveProperty('updated_by');
      expect(atom).not.toHaveProperty('last_edited_at');
      expect(atom).not.toHaveProperty('last_edited_by');
      expect(atom).not.toHaveProperty('agent_run_id');
    });

    test('AC-B8: 404 on unknown slug', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 'a', name: 'A', atoms: [] }],
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/zzz/atoms`)
        .expect(404);
    });

    test('atoms-table is_public=FALSE still serves (relaxed gate via loadPublicAtomsTable)', async () => {
      // Repro for prod bug: registry list 200 OK but atoms 404 because
      // per-doc atoms tables are seeded with is_public=FALSE by the widget
      // creator and never flipped. Parent widget+registry are public, so
      // atoms must serve regardless of the atoms-table-level is_public flag.
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{
          slug: 'doc-1', name: 'D',
          atoms: [{ order: 10, content_en: 'leaf' }],
        }],
      });

      // Flip the atoms table to is_public=FALSE — the bug.
      await dbRun(
        `UPDATE universal_tables SET is_public = ? WHERE id = ?`,
        [false, fixture.docs[0].atomsTableId]
      );

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/doc-1/atoms`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toHaveLength(1);
      expect(res.body.data.rows[0].data.content_en).toBe('leaf');
      expect(res.body.data.table_id).toBe(fixture.docs[0].atomsTableId);
    });
  });

  describe('GET /s/:slug/widgets/:widgetId/documents/columns — registry columns', () => {
    test('happy path: returns columns array under data (mirrors authenticated shape)', async () => {
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 'a', name: 'A', atoms: [] }],
      });
      // Add explicit registry columns so the response is non-trivial.
      await createColumn(fixture.registryTableId, 'name', 'text', { is_public: true }, 0);
      await createColumn(fixture.registryTableId, 'slug', 'text', { is_public: true }, 1);
      await createColumn(fixture.registryTableId, 'secret', 'text', { is_public: false }, 2);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/columns`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      // is_public=false column is dropped, the other two survive.
      const names = res.body.data.map(c => c.name);
      expect(names).toContain('name');
      expect(names).toContain('slug');
      expect(names).not.toContain('secret');
    });

    test('the /columns segment wins over /:docSlug when both are registered', async () => {
      // Belt-and-braces: even if someone creates a doc with slug='columns',
      // the columns route must still resolve (registered first).
      const fixture = await buildDocsWidgetFixture(userId, slug, {
        docs: [{ slug: 'columns', name: 'Trick', atoms: [] }],
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${fixture.widgetId}/documents/columns`)
        .expect(200);

      // It's the columns route — response shape is the columns array,
      // not the single-doc {row} envelope.
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('Regression — ADR-105 /s/:slug/docs endpoints still work', () => {
    test('AC-B9: /s/:slug/docs still 200 for a space without a documents_registry table', async () => {
      await createExternalSpace(userId, slug);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/docs`)
        .expect(200);

      // No documents_registry → empty list + not_initialized flag
      expect(res.body.success).toBe(true);
      expect(res.body.data.documents).toEqual([]);
      expect(res.body.data.not_initialized).toBe(true);
    });
  });

  // ============================================================
  // AC15 / AC16 (ADR-0060 §6) — System Data hard-ban regression
  //
  // The per-space "System Data" project (type='system_data') holds
  // sensitive aggregates (Variables, Storage Providers, etc per ADR-0024).
  // The hard-ban check runs BEFORE the is_public gate, so even an owner
  // accidentally flipping `is_public=true` cannot leak.
  //
  // Fixture: seed a project with type='system_data', is_public=TRUE
  // (the exact mis-configuration we're defending against) and confirm
  // every public endpoint that walks through it returns 404.
  // ============================================================
  describe('AC15 — System Data project hard-ban (ADR-0060 §6)', () => {
    /**
     * Build a space whose System Data project (type='system_data', is_public=TRUE)
     * carries the full chain: project → table → dashboard → widget (table_view)
     * → documents widget. Each is independently public so the ONLY thing keeping
     * the data off the public surface is the type='system_data' gate.
     */
    async function buildSystemDataFixture() {
      const spaceId = await createExternalSpace(userId, slug);
      // Build the canonical mis-configuration: every gate FLIPPED OPEN
      // except the system_data type discriminator.
      const r = await dbRun(
        `INSERT INTO projects (owner_id, space_id, name, type, is_public)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, spaceId, 'System Data', 'system_data', true]
      );
      const projectId = r.lastInsertRowid;

      const tableId = await createTable(projectId, true, 'Variables');
      const dashboardId = await createDashboard(projectId, true);
      // A table-view widget rooted in the system project — most direct leak path.
      const tableWidgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: tableId, registry_table_id: tableId },
      });
      // A documents widget rooted in the system project — separate code path.
      const docsRegistryId = await createTable(projectId, true, '_registry');
      const docsWidgetId = await createWidget(dashboardId, {
        presetName: 'documents',
        config: { registry_table_id: docsRegistryId, project_id: projectId },
      });
      // Seed at least one registry row so the docs endpoints would have
      // SOMETHING to leak if the gate failed.
      await createRow(docsRegistryId, {
        name: 'Leak-bait',
        slug: 'leak-bait',
        order_index: 0,
        table_id: tableId,
      });

      return {
        spaceId, projectId, tableId,
        dashboardId, tableWidgetId,
        docsRegistryId, docsWidgetId,
      };
    }

    test('/s/:slug — System Data project is filtered out of the projects list', async () => {
      const f = await buildSystemDataFixture();
      // Add ONE more non-system project so the response isn't empty for
      // unrelated reasons.
      const regularProjectId = await createProject(userId, f.spaceId, true);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const ids = res.body.data.projects.map(p => p.id);
      expect(ids).not.toContain(f.projectId);
      expect(ids).toContain(regularProjectId);
      // Belt-and-braces: no project named "System Data" leaks.
      expect(res.body.data.projects.find(p => p.name === 'System Data')).toBeUndefined();
    });

    test('AC16 (sidebar): /s/:slug/tree omits the System Data project entirely', async () => {
      const f = await buildSystemDataFixture();
      const regularProjectId = await createProject(userId, f.spaceId, true);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tree`)
        .expect(200);

      const ids = res.body.data.projects.map(p => p.id);
      expect(ids).not.toContain(f.projectId);
      expect(ids).toContain(regularProjectId);
      // The dashboards / widgets that lived UNDER System Data must also be
      // absent (they were never grouped because the project was filtered).
      const allWidgetIds = res.body.data.projects.flatMap(p => p.widgets.map(w => w.id));
      expect(allWidgetIds).not.toContain(f.tableWidgetId);
      expect(allWidgetIds).not.toContain(f.docsWidgetId);
    });

    test('/s/:slug/projects/:id → 404 even with is_public=TRUE', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/projects/${f.projectId}`)
        .expect(404);
    });

    test('/s/:slug/dashboards/:id → 404 (transitive via system_data project)', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/dashboards/${f.dashboardId}`)
        .expect(404);
    });

    test('/s/:slug/widgets/:id → 404 (transitive via system_data project)', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${f.tableWidgetId}`)
        .expect(404);
    });

    test('/s/:slug/widgets/:id/data → 404 (transitive via system_data project)', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${f.tableWidgetId}/data`)
        .expect(404);
    });

    test('/s/:slug/tables/:id → 404 for tables inside system_data project', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${f.tableId}`)
        .expect(404);
      await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${f.tableId}/rows`)
        .expect(404);
    });

    test('/s/:slug/widgets/:id/documents → 404 for documents widget under system_data', async () => {
      const f = await buildSystemDataFixture();
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${f.docsWidgetId}/documents`)
        .expect(404);
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${f.docsWidgetId}/documents/leak-bait`)
        .expect(404);
      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${f.docsWidgetId}/documents/columns`)
        .expect(404);
    });

    test('legacy type="system" also matches the ban (covers prod row id=65)', async () => {
      // One legacy row in prod uses type='system' instead of 'system_data'.
      // The helper deliberately matches both so legacy data is also banned.
      const spaceId = await createExternalSpace(userId, `${slug}-legacy`);
      const r = await dbRun(
        `INSERT INTO projects (owner_id, space_id, name, type, is_public)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, spaceId, 'System Data', 'system', true]
      );
      await request(app)
        .get(`/api/v3/public/s/${slug}-legacy/projects/${r.lastInsertRowid}`)
        .expect(404);
    });

    test('name-only fallback bans projects renamed without a type set', async () => {
      // Defense-in-depth: if someone creates a project named "System Data"
      // with type=NULL or a non-system type, the name match should still ban.
      const spaceId = await createExternalSpace(userId, `${slug}-nameonly`);
      const r = await dbRun(
        `INSERT INTO projects (owner_id, space_id, name, type, is_public)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, spaceId, 'System Data', 'business', true]
      );
      await request(app)
        .get(`/api/v3/public/s/${slug}-nameonly/projects/${r.lastInsertRowid}`)
        .expect(404);
    });
  });
});
