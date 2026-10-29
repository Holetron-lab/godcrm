// @vitest-environment node
// QA-21021-02: real services/HTTP and PostgreSQL, with no cascade FKs.
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import widgetsRoutes from '../widgets.js';
import projectsRoutes from '../projects.js';
import batchRoutes from '../batch.js';
import registerSpaceCrud from '../spaces/crud.js';
import { createProject } from '../../../services/ProjectService.js';
import { createWidget } from '../../../services/WidgetService.js';
import { dbGet, dbRun, withTransactionAsync, resetAdapter, destroyAdapter } from '../../../database/connection.js';

const schema = `qa_dashboard_delete_${randomUUID().replaceAll('-', '')}`;
const tables = ['spaces', 'projects', 'dashboards', 'widgets', 'modules', 'universal_tables', 'users'];
const app = express();
let user;
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use(widgetsRoutes);
app.use(batchRoutes);
app.use('/projects', projectsRoutes);
const spaces = express.Router();
registerSpaceCrud(spaces);
app.use('/spaces', spaces);

beforeAll(async () => {
  await resetAdapter();
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  await dbRun(`CREATE SCHEMA ${schema}`);
  const url = new URL(`postgresql://${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/godcrm_test`);
  url.username = process.env.POSTGRES_USER;
  url.password = process.env.POSTGRES_PASSWORD;
  url.searchParams.set('options', `-c search_path=${schema}`);
  await resetAdapter({ connectionString: url.toString() });
  for (const table of tables) {
    await dbRun(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
    // Own sequences too: never consume IDs from the restored public schema.
    await dbRun(`CREATE SEQUENCE ${table}_qa_id_seq START 100`);
    await dbRun(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${table}_qa_id_seq')`);
  }
});

afterAll(async () => {
  await dbRun(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await destroyAdapter();
});

beforeEach(async () => {
  user = { id: 101, role: 'user' };
  await dbRun(`TRUNCATE ${tables.join(', ')}`);
  await dbRun("INSERT INTO spaces (id, owner_id, name, type) VALUES (1, 101, 'manual-qa-neighbor', 'personal')");
  await dbRun("INSERT INTO dashboards (id, space_id, name) VALUES (3, 1, 'manual-qa-neighbor')");
});

test('real space creation -> empty default dashboard and space deleted atomically; neighbor survives', async () => {
  const created = await request(app).post('/spaces').send({ name: 'manual-qa-lifecycle', type: 'personal' }).expect(201);
  const { space, default_dashboard: dashboard } = created.body.data;
  expect(dashboard.space_id).toBe(space.id);
  await request(app).delete(`/spaces/${space.id}`).expect(200);
  expect(await dbGet('SELECT id FROM dashboards WHERE id = ?', [dashboard.id])).toBeNull();
  expect(await dbGet('SELECT id FROM spaces WHERE id = ?', [space.id])).toBeNull();
  expect(await dbGet('SELECT id FROM dashboards WHERE id = 3')).toEqual({ id: 3 });
});

test('real project service creates a removable default dashboard; parent guard still protects its table', async () => {
  const project = await createProject({ space_id: 1, owner_id: 101, name: 'manual-qa-project' });
  const dashboard = await dbGet('SELECT id FROM dashboards WHERE project_id = ?', [project.id]);
  await request(app).delete(`/projects/${project.id}`).expect(409);
  user = { id: 999, role: 'user' };
  await request(app).delete(`/dashboards/${dashboard.id}`).expect(403);
  user = { id: 101, role: 'user' };
  await request(app).delete(`/dashboards/${dashboard.id}`).expect(200);
  await request(app).delete(`/projects/${project.id}`).expect(409);
  expect(await dbGet('SELECT id FROM universal_tables WHERE project_id = ?', [project.id])).not.toBeNull();
});

test('GET space recreates the default dashboard without blocking empty space deletion', async () => {
  await request(app).delete('/dashboards/3').expect(200);
  const res = await request(app).get('/spaces/1').expect(200);
  const recreated = res.body.data.dashboard;
  expect(recreated.id).not.toBe(3);
  await request(app).delete('/spaces/1').expect(200);
  expect(await dbGet('SELECT id FROM dashboards WHERE id = ?', [recreated.id])).toBeNull();
});

test.each([
  [3, 'document', 999], // legacy link, even when owner differs
  [null, 'dashboard', 3], // detached module / polymorphic owner link
  [3, 'dashboard', 3]
])('refuses a dependency (%s, %s, %s) without losing data', async (dashboardId, kind, ownerId) => {
  await dbRun("INSERT INTO widgets (id, dashboard_id, owner_kind, owner_id, widget_type, title) VALUES (4, ?, ?, ?, 'preset', 'manual-qa-child')", [dashboardId, kind, ownerId]);
  const res = await request(app).delete('/dashboards/3').expect(409);
  expect(res.body.error.code).toBe('DASHBOARD_NOT_EMPTY');
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
  expect(await dbGet('SELECT id FROM widgets WHERE id=4')).toEqual({ id: 4 });
});

test.each(['admin', 'owner'])('system %s may delete an empty dashboard', async (role) => {
  user = { id: 999, role };
  await request(app).delete('/dashboards/3').expect(200);
});

test('non-owner is refused and missing dashboard returns 404', async () => {
  user = { id: 999, role: 'user' };
  await request(app).delete('/dashboards/3').expect(403);
  await request(app).delete('/dashboards/999').expect(404);
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
});

test.each(['0', '-1', '3oops', '1.5', '2147483648', '9007199254740992'])('rejects invalid ID %s', async (id) => {
  await request(app).delete(`/dashboards/${id}`).expect(400);
});

test('user dashboard requires its own user or an administrator', async () => {
  await dbRun("INSERT INTO users (id, email, password_hash, name, encryption_key_encrypted) VALUES (101, 'manual-qa@manual-test.local', 'test', 'QA', 'test')");
  await dbRun("INSERT INTO dashboards (id, user_id, name) VALUES (5, 101, 'manual-qa-user')");
  user = { id: 999, role: 'user' };
  await request(app).delete('/dashboards/5').expect(403);
  user = { id: 101, role: 'user' };
  await request(app).delete('/dashboards/5').expect(200);
  expect(await dbGet('SELECT id FROM users WHERE id=101')).toEqual({ id: 101 });
});

test('ambiguous and missing parents fail closed', async () => {
  await dbRun('UPDATE dashboards SET project_id=999 WHERE id=3');
  expect((await request(app).delete('/dashboards/3').expect(409)).body.error.code).toBe('DASHBOARD_PARENT_INVALID');
  await dbRun('UPDATE dashboards SET space_id=NULL WHERE id=3');
  await request(app).delete('/dashboards/3').expect(404);
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
});

test('concurrent parent ownership change is observed before authorization', async () => {
  let removal;
  await withTransactionAsync(async trx => {
    const { pid } = await trx.get('SELECT pg_backend_pid() AS pid');
    await trx.run('UPDATE spaces SET owner_id=999 WHERE id=1');
    removal = request(app).delete('/dashboards/3').then(res => res);
    await expect.poll(async () => Number((await dbGet(
      'SELECT count(*) AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid]
    )).n), { timeout: 1000 }).toBeGreaterThan(0);
  });
  expect((await removal).status).toBe(403);
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
});

test('requires an authenticated actor', async () => {
  user = undefined;
  await request(app).delete('/dashboards/3').expect(401);
});

test.each(['dashboards/3', 'spaces/1'])('an uncommitted widget addition blocks %s DELETE, then returns 409', async target => {
  await dbRun('UPDATE dashboards SET is_default=1 WHERE id=3');
  let release;
  let ready;
  const written = new Promise(resolve => { ready = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const writer = withTransactionAsync(async trx => {
    await createWidget({ dashboard_id: 3, widget_type: 'preset', preset_name: 'table_view', title: 'manual-qa-concurrent' }, { trx });
    ready((await trx.get('SELECT pg_backend_pid() AS pid')).pid);
    await hold;
  });
  const pid = await written;
  const removal = request(app).delete(`/${target}`).then(res => res);
  try {
    await expect.poll(async () => Number((await dbGet(
      'SELECT count(*) AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid]
    )).n), { timeout: 1000 }).toBeGreaterThan(0);
  } finally {
    release();
    await writer;
  }
  expect((await removal).status).toBe(409);
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
  expect(await dbGet('SELECT id FROM widgets WHERE dashboard_id=3')).not.toBeNull();
});

test('widget creation waits for an uncommitted dashboard deletion and rejects after commit', async () => {
  let creation;
  await withTransactionAsync(async trx => {
    const { pid } = await trx.get('SELECT pg_backend_pid() AS pid');
    await trx.run('DELETE FROM dashboards WHERE id=3');
    creation = createWidget({ dashboard_id: 3, widget_type: 'preset', preset_name: 'table_view', title: 'manual-qa-too-late' })
      .then(value => ({ value }), error => ({ error }));
    await expect.poll(async () => Number((await dbGet(
      'SELECT count(*) AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid]
    )).n), { timeout: 1000 }).toBeGreaterThan(0);
  });
  expect((await creation).error?.message).toBe('Dashboard not found');
  expect(await dbGet('SELECT id FROM widgets WHERE dashboard_id=3')).toBeNull();
});

test.each(['move', 'duplicate'])('batch %s waits for the target dashboard lock and preserves both links', async operation => {
  await dbRun("INSERT INTO projects (id, space_id, owner_id, name, type) VALUES (2, 1, 101, 'manual-qa-target', 'project')");
  await dbRun("INSERT INTO dashboards (id, project_id, name, is_default) VALUES (5, 2, 'manual-qa-target', 1)");
  const source = await createWidget({ dashboard_id: 3, widget_type: 'preset', preset_name: 'table_view', title: 'manual-qa-source' });
  let operationResult;
  await withTransactionAsync(async trx => {
    const { pid } = await trx.get('SELECT pg_backend_pid() AS pid');
    await trx.get('SELECT id FROM dashboards WHERE id=5 FOR UPDATE');
    operationResult = request(app).post('/spaces/1/batch').send({ operation, items: [{ type: 'widget', id: source.id }], target: { project_id: 2 } }).then(res => res);
    await expect.poll(async () => Number((await dbGet(
      'SELECT count(*) AS n FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))', [pid]
    )).n), { timeout: 1000 }).toBeGreaterThan(0);
  });
  const res = await operationResult;
  expect(res.status).toBe(200);
  expect(res.body.data.failed).toEqual([]);
  const id = operation === 'move' ? source.id : res.body.data.success[0].newId;
  expect(await dbGet('SELECT dashboard_id, owner_kind, owner_id FROM widgets WHERE id=?', [id]))
    .toEqual({ dashboard_id: 5, owner_kind: 'dashboard', owner_id: 5 });
  await request(app).delete('/dashboards/5').expect(409);
});

test.each(['project', 'custom dashboard', 'ambiguous dashboard'])(
  'space deletion retains %s and rolls back default dashboard cleanup', async dependency => {
    await dbRun('UPDATE dashboards SET is_default=1 WHERE id=3');
    if (dependency === 'project') {
      await dbRun("INSERT INTO projects (id, space_id, owner_id, name, type) VALUES (2, 1, 101, 'manual-qa-child', 'project')");
    } else {
      await dbRun("INSERT INTO dashboards (id, space_id, name, is_default, user_id) VALUES (5, 1, 'manual-qa-child', ?, ?)",
        dependency === 'custom dashboard' ? [0, null] : [1, 101]);
    }
    expect((await request(app).delete('/spaces/1').expect(409)).body.error.code).toBe('SPACE_NOT_EMPTY');
    expect(await dbGet('SELECT id FROM spaces WHERE id=1')).toEqual({ id: 1 });
    expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
    expect(await dbGet(dependency === 'project' ? 'SELECT id FROM projects WHERE id=2' : 'SELECT id FROM dashboards WHERE id=5')).not.toBeNull();
  }
);

test.each([[3, 'document', 999], [null, 'dashboard', 3], [3, 'dashboard', 3]])(
  'space deletion protects default dashboard widget (%s, %s, %s)', async (dashboardId, kind, ownerId) => {
    await dbRun('UPDATE dashboards SET is_default=1 WHERE id=3');
    await dbRun("INSERT INTO dashboards (id, space_id, name, is_default) VALUES (5, 1, 'manual-qa-empty-default', 1)");
    await dbRun("INSERT INTO widgets (id, dashboard_id, owner_kind, owner_id, widget_type, title) VALUES (4, ?, ?, ?, 'preset', 'manual-qa-child')", [dashboardId, kind, ownerId]);
    expect((await request(app).delete('/spaces/1').expect(409)).body.error.code).toBe('SPACE_NOT_EMPTY');
    expect(await dbGet('SELECT id FROM spaces WHERE id=1')).toEqual({ id: 1 });
    expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
    expect(await dbGet('SELECT id FROM dashboards WHERE id=5')).toEqual({ id: 5 });
    expect(await dbGet('SELECT id FROM widgets WHERE id=4')).toEqual({ id: 4 });
  }
);

test('non-owner cannot delete a space or its empty default dashboard', async () => {
  await dbRun('UPDATE dashboards SET is_default=1 WHERE id=3');
  user = { id: 999, role: 'user' };
  await request(app).delete('/spaces/1').expect(403);
  expect(await dbGet('SELECT id FROM spaces WHERE id=1')).toEqual({ id: 1 });
  expect(await dbGet('SELECT id FROM dashboards WHERE id=3')).toEqual({ id: 3 });
});
