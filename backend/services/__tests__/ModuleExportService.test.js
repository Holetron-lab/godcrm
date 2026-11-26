import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbAll, dbGet, dbRun, destroyAdapter, getAdapter, resetAdapter, safeJsonParse } from '../../database/connection.js';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';
import { generateBaseId } from '../../utils/baseId.js';
import { installModule, validateBlueprint } from '../ModuleInstaller.js';
import { exportProjectBlueprint, exportSpaceBlueprint } from '../ModuleExportService.js';
import secretsVault from '../secrets/SecretsVault.js';

const workspaces = [];
let source;

async function workspace(label) {
  const ws = await createEphemeralWorkspace({ label, table: false });
  workspaces.push(ws);
  return ws;
}

async function createTable(projectId, name, columns) {
  const result = await dbRun(
    'INSERT INTO universal_tables (project_id, name, display_name) VALUES (?, ?, ?)',
    [projectId, name, name],
  );
  const tableId = result.lastInsertRowid;
  for (const [index, column] of columns.entries()) {
    await dbRun(
      `INSERT INTO table_columns
        (table_id, column_name, display_name, type, order_index, is_required, is_visible, config)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [tableId, column.column_name, column.display_name || column.column_name,
        column.type, index + 1, column.required ? 1 : 0,
        column.config ? JSON.stringify(column.config) : null],
    );
  }
  return tableId;
}

async function addRow(tableId, data) {
  const result = await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [tableId, generateBaseId(), JSON.stringify(data)]);
  return result.lastInsertRowid;
}

async function addWidget({ dashboardId = null, spaceId, preset, title, config }) {
  const result = await dbRun(
    `INSERT INTO widgets
      (dashboard_id, owner_kind, owner_id, widget_type, preset_name, title, config, position, order_index, created_by)
     VALUES (?, ?, ?, 'preset', ?, ?, ?, '{}', 0, ?)`,
    [dashboardId, dashboardId ? 'dashboard' : 'space', dashboardId || spaceId,
      preset, title, JSON.stringify(config), source.userId],
  );
  return result.lastInsertRowid;
}

async function cleanup(ws) {
  await dbRun('DELETE FROM module_installs WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM modules WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
  await dbRun("DELETE FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId]);
  await dbRun(`DELETE FROM widgets WHERE dashboard_id IN (
    SELECT d.id FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id
    WHERE d.space_id = ? OR p.space_id = ?
  )`, [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ? OR project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM table_columns WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM projects WHERE space_id = ? AND id <> ?', [ws.spaceId, ws.projectId]);
  await dbRun('DELETE FROM _secrets WHERE space_id = ?', [ws.spaceId]);
  await ws.cleanup();
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  vi.stubEnv('SECRETS_MASTER_KEY', 'b'.repeat(64));
  await secretsVault.init({ adapter: await getAdapter(), allowEnvFallback: false });
});

beforeEach(async () => {
  source = await workspace('module-export-source');
  await dbRun("UPDATE projects SET name = 'Library' WHERE id = ?", [source.projectId]);
  await dbRun("UPDATE dashboards SET name = 'Library Overview' WHERE id = ?", [source.dashboardId]);
});

afterEach(async () => {
  for (const ws of workspaces.splice(0).reverse()) await cleanup(ws);
});

afterAll(async () => {
  await secretsVault.shutdown();
  vi.unstubAllEnvs();
  await destroyAdapter();
});

describe('ADR-207 W5 blueprint fingerprint', () => {
  it('exports every supported surface, scrubs PII/secrets and installs the same tree with relation seed', async () => {
    const authorsId = await createTable(source.projectId, 'authors', [
      { column_name: 'slug', type: 'text', required: true },
      { column_name: 'name', type: 'text' },
      { column_name: 'api_token', type: 'text' },
    ]);
    const booksId = await createTable(source.projectId, 'books', [
      { column_name: 'slug', type: 'text', required: true },
      { column_name: 'author', type: 'relation', config: { relation: { tableId: authorsId } } },
      { column_name: 'status', type: 'select', config: { options: [{ value: 'open', label: 'Open' }] } },
    ]);
    const authorRowId = await addRow(authorsId, { slug: 'author-1', name: 'Author One', api_token: 'row-secret-value' });
    await addRow(booksId, { slug: 'book-1', author: authorRowId, status: 'open' });

    const analytics = await dbRun(
      "INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, 'Analytics', 'business')",
      [source.userId, source.spaceId],
    );
    await createTable(analytics.lastInsertRowid, 'metrics', [{ column_name: 'value', type: 'number' }]);

    const appId = await addWidget({
      spaceId: source.spaceId,
      preset: 'table_view',
      title: 'Library',
      config: { table_id: booksId, group_by: 'status', api_token: 'config-secret-value' },
    });
    await dbRun(
      "INSERT INTO modules (widget_id, space_id, sidebar_order, sidebar_icon, access_level, is_pinned) VALUES (?, ?, 3, 'Books', 'member', true)",
      [appId, source.spaceId],
    );
    await addWidget({
      dashboardId: source.dashboardId,
      spaceId: source.spaceId,
      preset: 'number_widget',
      title: 'Books count',
      config: { table_id: booksId, column: 'slug', filter: { column: 'status', in: ['open'] } },
    });
    await addWidget({
      dashboardId: source.dashboardId,
      spaceId: source.spaceId,
      preset: 'quick_links',
      title: 'Open library',
      config: { app_widget_id: appId },
    });
    await dbRun(
      `INSERT INTO space_connectors
        (space_id, type_slug, kind, display_name, status, encrypted_payload, custom_definition, created_by)
       VALUES (?, 'custom_mcp', 'mcp', 'Mail', 'active', ?::jsonb, ?::jsonb, ?)`,
      [source.spaceId, JSON.stringify({ v: 1, ct: 'encrypted-secret-value' }),
        JSON.stringify({ url: 'https://mail.example.com/mcp', allowed_tools: ['send'] }), source.userId],
    );

    const blueprint = await exportSpaceBlueprint(source.spaceId, {
      key: 'library_fingerprint',
      title: 'Library fingerprint',
      seedTableIds: [authorsId, booksId],
    });

    expect(() => validateBlueprint(blueprint)).not.toThrow();
    expect(blueprint.projects.map((project) => project.key)).toEqual(['main', 'analytics']);
    expect(blueprint.tables.map((table) => table.key)).toEqual(['authors', 'books', 'metrics']);
    expect(blueprint.tables[1].columns.find((column) => column.column_name === 'author')).toMatchObject({
      type: 'relation', target: 'authors', config: { relation: {} },
    });
    expect(blueprint.apps[0]).toMatchObject({
      preset: 'table_view', table: 'books', config: { table_id: { $table: 'books' }, group_by: 'status' },
    });
    expect(blueprint.dashboards[0].tiles.map((tile) => tile.key)).toEqual(['books_count', 'open_library']);
    expect(blueprint.dashboards[0].tiles[1]).toMatchObject({ app: 'library', config: { app_widget_id: { $app: 'library' } } });
    expect(blueprint.sidebar).toEqual([{ widget: 'library', icon: 'Books', order: 3, access_level: 'member', is_pinned: true }]);
    expect(blueprint.services).toEqual([{
      key: 'mail', type_slug: 'custom_mcp', url: 'https://mail.example.com/mcp', allowed_tools: ['send'], secrets: ['BEARER_TOKEN'],
    }]);
    expect(blueprint.seed).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'authors', key: ['slug'] }),
      expect.objectContaining({ table: 'books', key: ['slug'] }),
    ]));
    expect(blueprint.seed.find((group) => group.table === 'books').rows[0].author).toBe('author-1');
    expect(blueprint.seed.find((group) => group.table === 'authors').rows[0]).not.toHaveProperty('api_token');
    expect(JSON.stringify(blueprint)).not.toMatch(/row-secret-value|config-secret-value|encrypted-secret-value/);
    expect(blueprint).toMatchSnapshot();

    const target = await workspace('module-export-target');
    await secretsVault.putSecret('BEARER_TOKEN', 'module-export-safe-test-value', { actor: target.userId, spaceId: target.spaceId });
    const applied = await installModule({
      blueprint,
      spaceId: target.spaceId,
      projectId: target.projectId,
      userId: target.userId,
      bindings: { secrets: { BEARER_TOKEN: 'vault:BEARER_TOKEN' } },
    });
    expect(applied.status).toBe('installed');
    expect(applied.plan.conflicts).toEqual([]);

    const projects = await dbAll('SELECT name FROM projects WHERE space_id = ? ORDER BY id', [target.spaceId]);
    expect(projects.map((project) => project.name)).toEqual([expect.any(String), 'Analytics']);
    const tables = await dbAll(
      'SELECT name FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?) ORDER BY name',
      [target.spaceId],
    );
    expect(tables.map((table) => table.name)).toEqual(['authors', 'books', 'metrics']);
    const columns = await dbAll(
      'SELECT column_name FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [applied.mapping.books.table_id],
    );
    expect(columns.map((column) => column.column_name)).toEqual(['slug', 'author', 'status']);
    const author = await dbGet('SELECT id, data FROM table_rows WHERE table_id = ?', [applied.mapping.authors.table_id]);
    const book = await dbGet('SELECT data FROM table_rows WHERE table_id = ?', [applied.mapping.books.table_id]);
    expect(safeJsonParse(author.data)).toEqual({ slug: 'author-1', name: 'Author One' });
    expect(safeJsonParse(book.data)).toEqual({ slug: 'book-1', author: author.id, status: 'open' });
    expect(await dbAll("SELECT id FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [target.spaceId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM widgets WHERE dashboard_id IN (SELECT id FROM dashboards WHERE project_id = ?)', [target.projectId])).toHaveLength(2);
    expect(await dbAll('SELECT id FROM modules WHERE space_id = ?', [target.spaceId])).toHaveLength(1);
    const linkedApp = await dbGet("SELECT config FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [target.spaceId]);
    expect(safeJsonParse(linkedApp.config).table_id).toBe(applied.mapping.books.table_id);
  });

  it('exports an excluded table as requires, omits seed by default and reconnects relation targets', async () => {
    const authorsId = await createTable(source.projectId, 'authors', [{ column_name: 'slug', type: 'text', required: true }]);
    const booksId = await createTable(source.projectId, 'books', [
      { column_name: 'slug', type: 'text', required: true },
      { column_name: 'author', type: 'relation', config: { relation: { tableId: authorsId } } },
    ]);
    await addRow(authorsId, { slug: 'do-not-seed' });
    await addWidget({
      spaceId: source.spaceId,
      preset: 'table_view',
      title: 'Required books',
      config: { table_id: booksId },
    });

    const blueprint = await exportProjectBlueprint(source.projectId, {
      key: 'requires_fingerprint',
      requiredTableIds: [booksId],
    });

    expect(blueprint.tables.map((table) => table.key)).toEqual(['authors']);
    expect(blueprint.requires.tables).toEqual([expect.objectContaining({
      key: 'books',
      columns: expect.arrayContaining([
        expect.objectContaining({ column_name: 'slug', required: true }),
        expect.objectContaining({ column_name: 'author', type: 'relation', target: 'authors' }),
      ]),
    })]);
    expect(blueprint.seed).toEqual([]);
    expect(blueprint.apps[0].table).toBe('books');

    const target = await workspace('module-export-requires-target');
    const targetBooksId = await createTable(target.projectId, 'existing_books', [
      { column_name: 'slug', type: 'text', required: true },
    ]);
    const applied = await installModule({
      blueprint,
      spaceId: target.spaceId,
      projectId: target.projectId,
      userId: target.userId,
      bindings: { tables: { books: {
        action: 'connect', table_id: targetBooksId,
        columns: [{ module_column: 'slug', target: 'slug' }, { module_column: 'author', target: '__new' }],
      } } },
    });
    expect(applied.status).toBe('installed');
    expect(applied.plan.conflicts).toEqual([]);
    const relation = await dbGet("SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'author'", [targetBooksId]);
    expect(safeJsonParse(relation.config).relation.tableId).toBe(applied.mapping.authors.table_id);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id IN (?, ?)', [applied.mapping.authors.table_id, targetBooksId])).toEqual([]);
  });

  it('uses a non-sensitive fallback natural key and strips its sensitive sibling values', async () => {
    const tableId = await createTable(source.projectId, 'credentials', [
      { column_name: 'code', type: 'text' },
      { column_name: 'api_token', type: 'text' },
    ]);
    await addRow(tableId, { code: 'usable-key', api_token: 'never-export-this' });

    const blueprint = await exportProjectBlueprint(source.projectId, {
      key: 'fallback_seed_key', seedTableIds: [tableId],
    });

    expect(blueprint.seed).toEqual([{ table: 'credentials', key: ['code'], rows: [{ code: 'usable-key' }] }]);
    expect(JSON.stringify(blueprint)).not.toContain('never-export-this');
  });

  it('keeps project export scoped to its own tables and surfaces', async () => {
    const itemsId = await createTable(source.projectId, 'items', [{ column_name: 'name', type: 'text' }]);
    const otherProject = await dbRun(
      "INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, 'Other project', 'business')",
      [source.userId, source.spaceId],
    );
    const otherTableId = await createTable(otherProject.lastInsertRowid, 'other_items', [{ column_name: 'name', type: 'text' }]);
    const otherDashboard = await dbRun(
      "INSERT INTO dashboards (project_id, name, is_default) VALUES (?, 'Other board', 1)",
      [otherProject.lastInsertRowid],
    );
    await addWidget({ spaceId: source.spaceId, preset: 'table_view', title: 'Main app', config: { table_id: itemsId } });
    await addWidget({ spaceId: source.spaceId, preset: 'table_view', title: 'Other app', config: { table_id: otherTableId } });
    await addWidget({
      dashboardId: otherDashboard.lastInsertRowid,
      spaceId: source.spaceId,
      preset: 'number_widget',
      title: 'Other tile',
      config: { table_id: otherTableId, aggregate: 'count' },
    });

    const blueprint = await exportProjectBlueprint(source.projectId, { key: 'project_scope' });

    expect(blueprint.projects).toHaveLength(1);
    expect(blueprint.tables.map((table) => table.key)).toEqual(['items']);
    expect(blueprint.apps.map((app) => app.title)).toEqual(['Main app']);
    expect(blueprint.dashboards).toHaveLength(1);
    expect(blueprint.dashboards[0].project).toBe('main');
    expect(blueprint.dashboards[0].tiles).toEqual([]);
    expect(JSON.stringify(blueprint)).not.toContain('other_items');
  });
});
